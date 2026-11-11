-- Five-role visibility and member portal integration. Existing identities and log history stay intact.
BEGIN;
ALTER TABLE public.portal_log_sessions DROP CONSTRAINT portal_log_sessions_actor_role_check;
ALTER TABLE public.portal_log_sessions ADD CONSTRAINT portal_log_sessions_actor_role_check CHECK(actor_role IN ('super_admin','admin','member','crecom_member','bod_member'));

CREATE OR REPLACE FUNCTION public.portal_log_viewer_role() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NULL;END IF;
 IF public.document_member_active() THEN RETURN 'member';END IF;
 access:=public.portal_session_access();
 IF (access->>'allowed')::boolean AND NOT coalesce((access->>'setupRequired')::boolean,false) AND access->>'role' IN ('super_admin','admin','crecom_member','bod_member') THEN RETURN access->>'role';END IF;
 RETURN NULL;
END;
$$;
CREATE FUNCTION public.portal_log_row_visible(p_actor uuid,p_role text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE public.portal_log_viewer_role()
  WHEN 'super_admin' THEN true
  WHEN 'admin' THEN p_role IN ('admin','member','crecom_member','bod_member')
  WHEN 'member' THEN p_actor=auth.uid()
  WHEN 'crecom_member' THEN p_actor=auth.uid()
  WHEN 'bod_member' THEN p_actor=auth.uid()
  ELSE false END
$$;
REVOKE ALL ON FUNCTION public.portal_log_row_visible(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_log_row_visible(uuid,text) TO authenticated,service_role;
DROP POLICY active_log_session_read ON public.portal_log_sessions;
DROP POLICY active_log_entry_read ON public.portal_active_log_entries;
CREATE POLICY active_log_session_read ON public.portal_log_sessions FOR SELECT TO authenticated USING(public.portal_log_row_visible(actor_id,actor_role));
CREATE POLICY active_log_entry_read ON public.portal_active_log_entries FOR SELECT TO authenticated USING(public.portal_log_row_visible(actor_id,actor_role));

CREATE FUNCTION public.portal_display_account_id(p_id text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN btrim(p_id) ~* '^(CSUCC-)?[0-9]{4}-[0-9]{4,}$' THEN 'CSUCC-'||regexp_replace(btrim(p_id),'^CSUCC-','','i') ELSE nullif(btrim(p_id),'') END
$$;
REVOKE ALL ON FUNCTION public.portal_display_account_id(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_display_account_id(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.manage_portal_log_session(p_actor_id uuid,p_auth_session_id uuid,p_operation text,p_browser text DEFAULT NULL,p_os text DEFAULT NULL,p_ip text DEFAULT NULL,p_idle_seconds integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.portal_log_sessions%ROWTYPE;u auth.users%ROWTYPE;role_value text;number_value text;name_value text;at_time timestamptz:=clock_timestamp();idle_at timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_auth_session_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'A current verified session is required.' USING ERRCODE='42501';END IF;
 IF p_operation NOT IN ('start','touch','logout','revoke') OR p_idle_seconds<0 THEN RAISE EXCEPTION 'Invalid session operation.';END IF;
 SELECT * INTO u FROM auth.users WHERE id=p_actor_id;
 SELECT * INTO s FROM public.portal_log_sessions WHERE auth_session_id=p_auth_session_id AND actor_id=p_actor_id FOR UPDATE;
 IF p_operation IN ('logout','revoke') THEN
  IF s.id IS NOT NULL AND s.ended_at IS NULL THEN
   UPDATE public.portal_log_sessions SET ended_at=greatest(started_at,least(at_time,expires_at)),end_reason=CASE WHEN expires_at<=at_time THEN 'idle_timeout' ELSE p_operation END WHERE id=s.id RETURNING * INTO s;
   IF p_operation='logout' AND s.expires_at>at_time THEN
    INSERT INTO public.portal_active_log_entries(source_key,session_id,actor_id,account_number,actor_name,actor_role,action_label,description,browser,os,ip_address)
     VALUES('logout:'||s.id,s.id,s.actor_id,s.account_number,s.actor_name,s.actor_role,'Logout',s.actor_name||' signed out of the COOP portal.',s.browser,s.os,s.ip_address) ON CONFLICT(source_key) DO NOTHING;
   END IF;
  END IF;
  RETURN jsonb_build_object('id',s.id,'serverTime',at_time,'expiresAt',at_time,'ended',true);
 END IF;
 role_value:=CASE WHEN u.raw_app_meta_data->>'role'='coop_admin' THEN 'admin' ELSE u.raw_app_meta_data->>'role' END;
 IF role_value IS NULL OR role_value NOT IN ('super_admin','admin','member','crecom_member','bod_member') OR coalesce(u.raw_app_meta_data->>'account_status','active')<>'active' OR u.banned_until>at_time THEN RAISE EXCEPTION 'Active portal membership is required.' USING ERRCODE='42501';END IF;
 IF role_value='member' AND NOT EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=p_actor_id AND m.status='active' AND m.must_change_password=false) THEN RAISE EXCEPTION 'Active member access is required.' USING ERRCODE='42501';END IF;
 IF s.id IS NOT NULL AND (s.ended_at IS NOT NULL OR s.expires_at<=at_time) THEN
  UPDATE public.portal_log_sessions SET ended_at=coalesce(ended_at,expires_at),end_reason=coalesce(end_reason,'idle_timeout') WHERE id=s.id;
  RETURN jsonb_build_object('expired',true,'serverTime',at_time);
 END IF;
 IF s.id IS NOT NULL AND s.actor_role IS DISTINCT FROM role_value THEN
  UPDATE public.portal_log_sessions SET ended_at=at_time,end_reason='role_changed' WHERE id=s.id;
  RETURN jsonb_build_object('expired',true,'serverTime',at_time);
 END IF;
 IF s.id IS NULL THEN
  IF p_operation<>'start' THEN RAISE EXCEPTION 'Start an admitted portal session first.' USING ERRCODE='42501';END IF;
  SELECT member_id INTO number_value FROM public.members WHERE user_id=p_actor_id ORDER BY created_at LIMIT 1;
  name_value:=left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'last_name')),''),u.email,'Account'),160);
  INSERT INTO public.portal_log_sessions(auth_session_id,actor_id,account_number,actor_name,actor_role,browser,os,ip_address,expires_at)
   VALUES(p_auth_session_id,p_actor_id,number_value,name_value,role_value,left(p_browser,80),left(p_os,80),left(p_ip,64),at_time+interval '15 minutes')
   ON CONFLICT(auth_session_id) DO NOTHING;
  SELECT * INTO s FROM public.portal_log_sessions WHERE auth_session_id=p_auth_session_id AND actor_id=p_actor_id FOR UPDATE;
 END IF;
 -- Reloads and background checks do not renew idle time; only reported interaction does.
 IF p_operation='touch' THEN
  idle_at:=greatest(s.last_activity_at,at_time-make_interval(secs=>least(p_idle_seconds,86400)));
  IF idle_at+interval '15 minutes'<=at_time THEN
   UPDATE public.portal_log_sessions SET ended_at=expires_at,end_reason='idle_timeout' WHERE id=s.id;
   RETURN jsonb_build_object('expired',true,'serverTime',at_time);
  END IF;
  UPDATE public.portal_log_sessions SET last_activity_at=idle_at,expires_at=idle_at+interval '15 minutes' WHERE id=s.id RETURNING * INTO s;
 END IF;
 RETURN jsonb_build_object('id',s.id,'serverTime',at_time,'expiresAt',s.expires_at);
END;
$$;

-- Member apps use their own JWT, never a service key or a caller-provided actor.
CREATE FUNCTION public.member_log_session(p_operation text DEFAULT 'start',p_idle_seconds integer DEFAULT 0,p_device_os text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text:=auth.jwt()->>'session_id';headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;ua text;browser text;os text;
BEGIN
 IF NOT public.document_member_active() OR sid IS NULL OR sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_operation NOT IN ('start','touch','logout') THEN RAISE EXCEPTION 'An active member session is required.' USING ERRCODE='42501';END IF;
 ua:=headers->>'user-agent';
 browser:=CASE WHEN ua LIKE '%Edg/%' THEN 'Edge' WHEN ua LIKE '%Firefox/%' THEN 'Firefox' WHEN ua LIKE '%Chrome/%' THEN 'Chrome' WHEN ua LIKE '%Safari/%' THEN 'Safari' ELSE NULL END;
 os:=CASE WHEN ua LIKE '%Android%' THEN 'Android' WHEN ua ~ '(iPhone|iPad)' THEN 'iOS' WHEN ua LIKE '%Windows%' THEN 'Windows' WHEN ua ~ '(Macintosh|Mac OS)' THEN 'macOS' WHEN ua LIKE '%Linux%' THEN 'Linux' WHEN p_device_os IN ('Android','iOS','macOS','Windows','Linux') THEN p_device_os ELSE NULL END;
 RETURN public.manage_portal_log_session(auth.uid(),sid::uuid,p_operation,browser,os,NULL,least(greatest(p_idle_seconds,0),86400));
END;
$$;
REVOKE ALL ON FUNCTION public.member_log_session(text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.member_log_session(text,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_close_revoked_log_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb:=to_jsonb(OLD);new_row jsonb:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;actor uuid;at_time timestamptz:=clock_timestamp();must_close boolean:=false;
BEGIN
 IF TG_TABLE_SCHEMA='auth' AND TG_TABLE_NAME='sessions' THEN
  UPDATE public.portal_log_sessions SET ended_at=greatest(started_at,least(at_time,expires_at)),end_reason='revoke' WHERE auth_session_id=(old_row->>'id')::uuid AND actor_id=(old_row->>'user_id')::uuid AND ended_at IS NULL;
  RETURN OLD;
 ELSIF TG_TABLE_SCHEMA='auth' THEN
  actor:=(old_row->>'id')::uuid;
  must_close:=TG_OP='DELETE' OR coalesce(new_row->'raw_app_meta_data'->>'account_status','active')<>'active'
   OR coalesce(new_row->'raw_app_meta_data'->>'role','') NOT IN ('super_admin','admin','coop_admin','member','crecom_member','bod_member')
   OR old_row->'raw_app_meta_data'->>'role' IS DISTINCT FROM new_row->'raw_app_meta_data'->>'role'
   OR nullif(new_row->>'banned_until','')::timestamptz>at_time;
 ELSIF TG_TABLE_NAME='members' THEN
  actor:=(old_row->>'user_id')::uuid;must_close:=TG_OP='DELETE' OR (lower(coalesce(new_row->>'status',''))<>'active' OR new_row->>'must_change_password'='true') OR old_row->>'user_id' IS DISTINCT FROM new_row->>'user_id';
 ELSE
  actor:=(old_row->>'auth_user_id')::uuid;
  must_close:=TG_OP='DELETE' OR new_row->>'active'='false' OR nullif(new_row->>'ends_at','')::timestamptz<=at_time OR old_row->>'role' IS DISTINCT FROM new_row->>'role' OR old_row->>'committee_seat' IS DISTINCT FROM new_row->>'committee_seat';
 END IF;
 IF must_close AND actor IS NOT NULL THEN UPDATE public.portal_log_sessions SET ended_at=greatest(started_at,least(at_time,expires_at)),end_reason='revoke' WHERE actor_id=actor AND ended_at IS NULL;END IF;
 RETURN coalesce(NEW,OLD);
END;
$$;
DROP TRIGGER close_revoked_member_portal_logs ON public.members;
CREATE TRIGGER close_revoked_member_portal_logs AFTER UPDATE OF status,user_id,must_change_password OR DELETE ON public.members FOR EACH ROW EXECUTE FUNCTION public.portal_close_revoked_log_sessions();

CREATE OR REPLACE FUNCTION public.portal_capture_completed_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.portal_log_sessions%ROWTYPE;session_key text;label text;actor uuid;target text;description text;source text;headers jsonb;
BEGIN
 IF TG_TABLE_NAME='admin_activity_logs' THEN
  IF NEW.result IS DISTINCT FROM 'success' OR NEW.details->>'operation_completed'='false' OR NEW.details->>'phase'='authorized_request' THEN RETURN NEW;END IF;
  label:=public.portal_completed_action_label(NEW.action_name);actor:=NEW.actor_id;target:=NEW.target_id;
  description:=CASE WHEN nullif(btrim(NEW.details->>'reason'),'') IS NOT NULL THEN 'Reason: '||left(NEW.details->>'reason',500) ELSE '' END;
  source:='audit:'||NEW.id;
 ELSE
  -- Only completed feature events are admitted. Member attribution is checked
  -- again against the actual session below; staff actions retain their audit source.
  actor:=NEW.actor_id;target:=NEW.entity_key;description:=NEW.message;source:='event:'||NEW.id;
  IF NEW.source_key LIKE 'announcements:%' AND NEW.action IN ('announcement_draft','announcement_published','announcement_scheduled','announcement_archived','announcement_deleted','announcement_updated') THEN label:=NEW.title;
  ELSIF (NEW.source_key LIKE 'loan_applications:%' AND NEW.action IN ('loan_submitted','loan_updated'))
    OR (NEW.source_key LIKE 'loan_documents:%' AND NEW.action='document_uploaded')
    OR (NEW.source_key LIKE 'loan_document_versions:%' AND NEW.action='document_replaced')
    OR (NEW.source_key LIKE 'members:%' AND NEW.action='account_updated')
    OR (NEW.source_key LIKE 'consent:%' AND NEW.action='consent_recorded') THEN
   label:=CASE NEW.action WHEN 'loan_submitted' THEN 'Submit Loan Application' WHEN 'loan_updated' THEN 'Update Loan Application' WHEN 'document_uploaded' THEN 'Upload Document' WHEN 'document_replaced' THEN 'Replace Document' WHEN 'account_updated' THEN 'Update Profile' WHEN 'consent_recorded' THEN 'Submit Consent Evidence' END;
  ELSE RETURN NEW;END IF;
 END IF;
 IF label IS NULL OR actor IS NULL THEN RETURN NEW;END IF;
 IF auth.role()='authenticated' THEN session_key:=auth.jwt()->>'session_id';
 ELSIF auth.role()='service_role' THEN headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;session_key:=headers->>'x-coop-session-id';
 END IF;
 IF session_key IS NULL OR session_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NEW;END IF;
 SELECT * INTO s FROM public.portal_log_sessions WHERE auth_session_id=session_key::uuid AND actor_id=actor AND ended_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME<>'admin_activity_logs' THEN
  IF NEW.source_key NOT LIKE 'announcements:%' AND s.actor_role<>'member' THEN RETURN NEW;END IF;
 END IF;
 INSERT INTO public.portal_active_log_entries(source_key,session_id,actor_id,account_number,actor_name,actor_role,action_label,description,browser,os,ip_address)
 VALUES(source,s.id,s.actor_id,s.account_number,s.actor_name,s.actor_role,label,left(s.actor_name||' · '||label||CASE WHEN nullif(target,'') IS NOT NULL THEN ' · '||left(target,200) ELSE '' END||CASE WHEN description<>'' THEN '. '||description ELSE '' END,1000),s.browser,s.os,s.ip_address)
 ON CONFLICT(source_key) DO NOTHING;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_portal_active_logs(p_search text DEFAULT '',p_role text DEFAULT '',p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_page integer DEFAULT 1,p_page_size integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE viewer text:=public.portal_log_viewer_role();result jsonb;total_count bigint;page_value integer;rows_value jsonb;
BEGIN
 IF viewer IS NULL THEN RAISE EXCEPTION 'Active cooperative account access is required.' USING ERRCODE='42501';END IF;
 IF p_page<1 OR p_page>100000 OR p_page_size NOT IN (10,25,50) OR length(p_search)>160 OR p_role NOT IN ('','super_admin','admin','member','crecom_member','bod_member') OR p_from>=p_to THEN RAISE EXCEPTION 'Choose valid filters.';END IF;
 WITH entries AS (
  SELECT s.id,s.actor_id,public.portal_display_account_id(s.account_number) account_number,s.actor_name,s.actor_role,'Login'::text action,s.browser,s.os,s.started_at time_in,
   coalesce(s.ended_at,CASE WHEN s.expires_at<=now() THEN s.expires_at END) time_out,
   CASE WHEN s.ended_at IS NULL AND s.expires_at>now() THEN 'active' ELSE 'closed' END session_state,s.ip_address,
   s.actor_name||' signed in successfully.'||CASE WHEN s.end_reason='idle_timeout' OR (s.ended_at IS NULL AND s.expires_at<=now()) THEN ' Session ended after inactivity.' WHEN s.end_reason='revoke' THEN ' Portal access ended.' ELSE '' END description,s.started_at event_time FROM public.portal_log_sessions s
  UNION ALL SELECT e.id,e.actor_id,public.portal_display_account_id(e.account_number),e.actor_name,e.actor_role,e.action_label,e.browser,e.os,CASE WHEN e.action_label='Logout' THEN NULL ELSE e.created_at END,CASE WHEN e.action_label='Logout' THEN e.created_at END,'activity',e.ip_address,e.description,e.created_at FROM public.portal_active_log_entries e
 ),filtered AS (
  SELECT * FROM entries WHERE public.portal_log_row_visible(actor_id,actor_role) AND (p_role='' OR actor_role=p_role)
   AND (p_from IS NULL OR event_time>=p_from) AND (p_to IS NULL OR event_time<p_to)
   AND (p_search='' OR strpos(lower(concat_ws(' ',account_number,actor_name,actor_role,action,description,browser,os,ip_address)),lower(p_search))>0)
 ),counted AS (SELECT count(*) n FROM filtered),paging AS (SELECT n,greatest(1,least(p_page,ceil(n::numeric/p_page_size)::integer)) p FROM counted),limited AS (
  SELECT f.* FROM filtered f ORDER BY event_time DESC,id DESC LIMIT p_page_size OFFSET (SELECT (p-1)*p_page_size FROM paging)
 ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'accountNumber',account_number,'name',actor_name,'role',actor_role,'action',action,'browser',browser,'os',os,'timeIn',time_in,'timeOut',time_out,'sessionState',session_state,'ipAddress',ip_address,'details',description) ORDER BY event_time DESC,id DESC) FROM limited),'[]'),'total',n,'page',p,'pageSize',p_page_size) INTO result FROM paging;
 RETURN result;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
