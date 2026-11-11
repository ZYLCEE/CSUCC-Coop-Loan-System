BEGIN;
-- Successful portal sessions and completed internal actions. Additive: existing audit history is untouched.

CREATE TABLE public.portal_log_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_session_id uuid NOT NULL UNIQUE,actor_id uuid NOT NULL,
 account_number text,actor_name text NOT NULL,actor_role text NOT NULL CHECK(actor_role IN ('super_admin','admin','crecom_member','bod_member')),
 browser text,os text,ip_address text,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 ended_at timestamptz,end_reason text,CHECK(ended_at IS NULL OR ended_at>=started_at),CHECK(expires_at>=started_at)
);
CREATE INDEX portal_sessions_actor_active ON public.portal_log_sessions(actor_id,auth_session_id) WHERE ended_at IS NULL;
CREATE TABLE public.portal_active_log_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_key text NOT NULL UNIQUE,session_id uuid NOT NULL REFERENCES public.portal_log_sessions(id),
 actor_id uuid NOT NULL,account_number text,actor_name text NOT NULL,actor_role text NOT NULL,
 action_label text NOT NULL,description text NOT NULL,browser text,os text,ip_address text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX portal_active_entries_created ON public.portal_active_log_entries(created_at DESC,id);
ALTER TABLE public.portal_log_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_active_log_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_log_sessions,public.portal_active_log_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.portal_log_sessions,public.portal_active_log_entries TO authenticated;
GRANT ALL ON public.portal_log_sessions,public.portal_active_log_entries TO service_role;
CREATE FUNCTION public.portal_log_viewer_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.document_staff_access() THEN CASE WHEN raw_app_meta_data->>'role'='super_admin' THEN 'super_admin' ELSE 'admin' END END FROM auth.users WHERE id=auth.uid()
$$;
REVOKE ALL ON FUNCTION public.portal_log_viewer_role() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_log_viewer_role() TO authenticated,service_role;
CREATE POLICY active_log_session_read ON public.portal_log_sessions FOR SELECT TO authenticated USING(public.portal_log_viewer_role()='super_admin' OR (public.portal_log_viewer_role()='admin' AND actor_role<>'super_admin'));
CREATE POLICY active_log_entry_read ON public.portal_active_log_entries FOR SELECT TO authenticated USING(public.portal_log_viewer_role()='super_admin' OR (public.portal_log_viewer_role()='admin' AND actor_role<>'super_admin'));
CREATE TRIGGER preserve_active_log_entries BEFORE UPDATE OR DELETE ON public.portal_active_log_entries FOR EACH ROW EXECUTE FUNCTION public.portal_activity_immutable();

CREATE FUNCTION public.manage_portal_log_session(p_actor_id uuid,p_auth_session_id uuid,p_operation text,p_browser text DEFAULT NULL,p_os text DEFAULT NULL,p_ip text DEFAULT NULL,p_idle_seconds integer DEFAULT 0)
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
 IF role_value IS NULL OR role_value NOT IN ('super_admin','admin','crecom_member','bod_member') OR coalesce(u.raw_app_meta_data->>'account_status','active')<>'active' OR u.banned_until>at_time THEN RAISE EXCEPTION 'Active portal membership is required.' USING ERRCODE='42501';END IF;
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
REVOKE ALL ON FUNCTION public.manage_portal_log_session(uuid,uuid,text,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_portal_log_session(uuid,uuid,text,text,text,text,integer) TO service_role;

-- End tracking at the actual revocation transaction, including when the browser
-- has already closed or its authorization provider has unmounted.
CREATE FUNCTION public.portal_close_revoked_log_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb:=to_jsonb(OLD);new_row jsonb:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;actor uuid;at_time timestamptz:=clock_timestamp();must_close boolean:=false;
BEGIN
 IF TG_TABLE_SCHEMA='auth' AND TG_TABLE_NAME='sessions' THEN
  UPDATE public.portal_log_sessions SET ended_at=greatest(started_at,least(at_time,expires_at)),end_reason='revoke' WHERE auth_session_id=(old_row->>'id')::uuid AND actor_id=(old_row->>'user_id')::uuid AND ended_at IS NULL;
  RETURN OLD;
 ELSIF TG_TABLE_SCHEMA='auth' THEN
  actor:=(old_row->>'id')::uuid;
  must_close:=TG_OP='DELETE' OR coalesce(new_row->'raw_app_meta_data'->>'account_status','active')<>'active'
   OR coalesce(new_row->'raw_app_meta_data'->>'role','') NOT IN ('super_admin','admin','coop_admin','crecom_member','bod_member')
   OR old_row->'raw_app_meta_data'->>'role' IS DISTINCT FROM new_row->'raw_app_meta_data'->>'role'
   OR nullif(new_row->>'banned_until','')::timestamptz>at_time;
 ELSIF TG_TABLE_NAME='members' THEN
  actor:=(old_row->>'user_id')::uuid;must_close:=TG_OP='DELETE' OR lower(coalesce(new_row->>'status',''))<>'active' OR old_row->>'user_id' IS DISTINCT FROM new_row->>'user_id';
 ELSE
  actor:=(old_row->>'auth_user_id')::uuid;
  must_close:=TG_OP='DELETE' OR new_row->>'active'='false' OR nullif(new_row->>'ends_at','')::timestamptz<=at_time OR old_row->>'role' IS DISTINCT FROM new_row->>'role' OR old_row->>'committee_seat' IS DISTINCT FROM new_row->>'committee_seat';
 END IF;
 IF must_close AND actor IS NOT NULL THEN UPDATE public.portal_log_sessions SET ended_at=greatest(started_at,least(at_time,expires_at)),end_reason='revoke' WHERE actor_id=actor AND ended_at IS NULL;END IF;
 RETURN coalesce(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_close_revoked_log_sessions() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER close_revoked_auth_portal_logs AFTER UPDATE OF raw_app_meta_data,banned_until OR DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.portal_close_revoked_log_sessions();
CREATE TRIGGER close_ended_auth_portal_logs AFTER DELETE ON auth.sessions FOR EACH ROW EXECUTE FUNCTION public.portal_close_revoked_log_sessions();
CREATE TRIGGER close_revoked_member_portal_logs AFTER UPDATE OF status,user_id OR DELETE ON public.members FOR EACH ROW EXECUTE FUNCTION public.portal_close_revoked_log_sessions();
CREATE TRIGGER close_revoked_committee_portal_logs AFTER UPDATE OF active,ends_at,role,committee_seat OR DELETE ON public.staff_memberships FOR EACH ROW EXECUTE FUNCTION public.portal_close_revoked_log_sessions();

CREATE FUNCTION public.portal_completed_action_label(p_action text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_action
 WHEN 'create-account' THEN 'Create Account' WHEN 'edit-account' THEN 'Update Account' WHEN 'activate-account' THEN 'Activate Account'
 WHEN 'block-account' THEN 'Block Account' WHEN 'unblock-account' THEN 'Unblock Account' WHEN 'delete-account' THEN 'Delete Account' WHEN 'reset-account-password' THEN 'Reset Account Password'
 WHEN 'update-admin-privileges' THEN 'Update Privileges' WHEN 'update-own-profile' THEN 'Update Profile' WHEN 'change-own-password' THEN 'Change Password' WHEN 'change-own-email' THEN 'Change Email'
 WHEN 'review-loan' THEN 'Review Application' WHEN 'approve-loan' THEN 'Approve Application' WHEN 'reject-loan' THEN 'Reject Application' WHEN 'release-loan' THEN 'Release Loan'
 WHEN 'record-counter-payment' THEN 'Record Payment' WHEN 'reverse-counter-payment' THEN 'Reverse Payment' WHEN 'update-loan-policy' THEN 'Update Loan Policy'
 WHEN 'review-document' THEN 'Review Document' WHEN 'share-document' THEN 'Share Document' WHEN 'save-document-draft' THEN 'Save Document Draft' WHEN 'publish-document' THEN 'Publish Document' WHEN 'delete-shared-document' THEN 'Delete Document' WHEN 'delete-staff-document' THEN 'Delete Document'
 WHEN 'application-verification-start' THEN 'Start Requirements Check' WHEN 'application-verification-save_draft' THEN 'Save Requirements Checks' WHEN 'application-verification-mark_verified' THEN 'Verify Requirements' WHEN 'application-verification-return' THEN 'Return Application'
 WHEN 'committee-review-forward' THEN 'Send to CRECOM' WHEN 'committee-review-forward_bod' THEN 'Send to BOD' WHEN 'committee-review-approve' THEN 'Committee Approval' WHEN 'committee-review-reject' THEN 'Committee Rejection' WHEN 'committee-review-clarify' THEN 'Request Clarification' WHEN 'committee-review-reply' THEN 'Answer Clarification' WHEN 'committee-review-reassign' THEN 'Reassign Reviewer' WHEN 'committee-review-recuse' THEN 'Reviewer Recusal' WHEN 'committee-review-finalize' THEN 'Final Decision' WHEN 'committee-review-reopen' THEN 'Restart Requirements Check'
 WHEN 'committee-invite-complete' THEN 'Create Committee Account' WHEN 'committee-membership-update' THEN 'Update Committee Membership' WHEN 'committee-membership-deactivate' THEN 'Deactivate Committee Membership'
 WHEN 'committee-own-profile' THEN 'Update Profile' WHEN 'committee-own-password' THEN 'Change Password' WHEN 'workflow-policy-draft' THEN 'Save Approval Policy Draft' WHEN 'workflow-policy-activate' THEN 'Activate Approval Policy'
 WHEN 'send-member-notification' THEN 'Send Notification' WHEN 'send-notification' THEN 'Send Notification' WHEN 'schedule-notification' THEN 'Schedule Notification'
 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.portal_completed_action_label(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.portal_capture_completed_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.portal_log_sessions%ROWTYPE;session_key text;label text;actor uuid;target text;description text;source text;headers jsonb;
BEGIN
 IF TG_TABLE_NAME='admin_activity_logs' THEN
  IF NEW.result IS DISTINCT FROM 'success' OR NEW.details->>'operation_completed'='false' OR NEW.details->>'phase'='authorized_request' THEN RETURN NEW;END IF;
  label:=public.portal_completed_action_label(NEW.action_name);actor:=NEW.actor_id;target:=NEW.target_id;
  description:=CASE WHEN nullif(btrim(NEW.details->>'reason'),'') IS NOT NULL THEN 'Reason: '||left(NEW.details->>'reason',500) ELSE '' END;
  source:='audit:'||NEW.id;
 ELSE
  -- Announcement row changes commit inside the existing feature; no synthetic/background events.
  IF NEW.source_key NOT LIKE 'announcements:%' OR NEW.action NOT IN ('announcement_draft','announcement_published','announcement_scheduled','announcement_archived','announcement_deleted','announcement_updated') THEN RETURN NEW;END IF;
  label:=NEW.title;actor:=NEW.actor_id;target:=NEW.entity_key;description:=NEW.message;source:='event:'||NEW.id;
 END IF;
 IF label IS NULL OR actor IS NULL THEN RETURN NEW;END IF;
 IF auth.role()='authenticated' THEN session_key:=auth.jwt()->>'session_id';
 ELSIF auth.role()='service_role' THEN headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;session_key:=headers->>'x-coop-session-id';
 END IF;
 IF session_key IS NULL OR session_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NEW;END IF;
 SELECT * INTO s FROM public.portal_log_sessions WHERE auth_session_id=session_key::uuid AND actor_id=actor AND ended_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN NEW;END IF;
 INSERT INTO public.portal_active_log_entries(source_key,session_id,actor_id,account_number,actor_name,actor_role,action_label,description,browser,os,ip_address)
 VALUES(source,s.id,s.actor_id,s.account_number,s.actor_name,s.actor_role,label,left(s.actor_name||' · '||label||CASE WHEN nullif(target,'') IS NOT NULL THEN ' · '||left(target,200) ELSE '' END||CASE WHEN description<>'' THEN '. '||description ELSE '' END,1000),s.browser,s.os,s.ip_address)
 ON CONFLICT(source_key) DO NOTHING;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_capture_completed_activity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER capture_completed_portal_audit AFTER INSERT ON public.admin_activity_logs FOR EACH ROW EXECUTE FUNCTION public.portal_capture_completed_activity();
CREATE TRIGGER capture_completed_portal_announcement AFTER INSERT ON public.portal_activity_events FOR EACH ROW EXECUTE FUNCTION public.portal_capture_completed_activity();

-- Existing protected account actions run in the unchanged Edge Function. The Next.js
-- proxy records only its confirmed execution response; grants are stored as hashes only.
CREATE FUNCTION public.append_completed_portal_action(p_actor_id uuid,p_auth_session_id uuid,p_source_key text,p_action text,p_target text,p_reason text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.portal_log_sessions%ROWTYPE;label text:=public.portal_completed_action_label(p_action);
BEGIN
 IF label IS NULL OR p_source_key !~ '^protected:[0-9a-f]{64}$' THEN RETURN false;END IF;
 SELECT * INTO s FROM public.portal_log_sessions WHERE actor_id=p_actor_id AND auth_session_id=p_auth_session_id AND ended_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN false;END IF;
 INSERT INTO public.portal_active_log_entries(source_key,session_id,actor_id,account_number,actor_name,actor_role,action_label,description,browser,os,ip_address)
 VALUES(p_source_key,s.id,s.actor_id,s.account_number,s.actor_name,s.actor_role,label,left(s.actor_name||' · '||label||CASE WHEN nullif(p_target,'') IS NOT NULL THEN ' · '||left(p_target,200) ELSE '' END||CASE WHEN nullif(p_reason,'') IS NOT NULL THEN '. Reason: '||left(p_reason,500) ELSE '' END,1000),s.browser,s.os,s.ip_address)
 ON CONFLICT(source_key) DO NOTHING;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.append_completed_portal_action(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_completed_portal_action(uuid,uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.read_portal_active_logs(p_search text DEFAULT '',p_role text DEFAULT '',p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_page integer DEFAULT 1,p_page_size integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE viewer text:=public.portal_log_viewer_role();result jsonb;total_count bigint;page_value integer;rows_value jsonb;
BEGIN
 IF viewer IS NULL THEN RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE='42501';END IF;
 IF p_page<1 OR p_page>100000 OR p_page_size NOT IN (10,25,50) OR length(p_search)>160 OR p_role NOT IN ('','super_admin','admin','crecom_member','bod_member') OR p_from>=p_to THEN RAISE EXCEPTION 'Choose valid filters.';END IF;
 WITH entries AS (
  SELECT s.id,s.account_number,s.actor_name,s.actor_role,'Login'::text action,s.browser,s.os,s.started_at time_in,
   coalesce(s.ended_at,CASE WHEN s.expires_at<=now() THEN s.expires_at END) time_out,
   CASE WHEN s.ended_at IS NULL AND s.expires_at>now() THEN 'active' ELSE 'closed' END session_state,s.ip_address,
   s.actor_name||' signed in successfully.'||CASE WHEN s.end_reason='idle_timeout' OR (s.ended_at IS NULL AND s.expires_at<=now()) THEN ' Session ended after inactivity.' WHEN s.end_reason='revoke' THEN ' Portal access ended.' ELSE '' END description,s.started_at event_time FROM public.portal_log_sessions s
  UNION ALL SELECT e.id,e.account_number,e.actor_name,e.actor_role,e.action_label,e.browser,e.os,CASE WHEN e.action_label='Logout' THEN NULL ELSE e.created_at END,CASE WHEN e.action_label='Logout' THEN e.created_at END,'activity',e.ip_address,e.description,e.created_at FROM public.portal_active_log_entries e
 ),filtered AS (
  SELECT * FROM entries WHERE (viewer='super_admin' OR actor_role<>'super_admin') AND (p_role='' OR actor_role=p_role)
   AND (p_from IS NULL OR event_time>=p_from) AND (p_to IS NULL OR event_time<p_to)
   AND (p_search='' OR strpos(lower(concat_ws(' ',account_number,actor_name,actor_role,action,description,browser,os,ip_address)),lower(p_search))>0)
 ),counted AS (SELECT count(*) n FROM filtered),paging AS (SELECT n,greatest(1,least(p_page,ceil(n::numeric/p_page_size)::integer)) p FROM counted),limited AS (
  SELECT f.* FROM filtered f ORDER BY event_time DESC,id DESC LIMIT p_page_size OFFSET (SELECT (p-1)*p_page_size FROM paging)
 ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'accountNumber',account_number,'name',actor_name,'role',actor_role,'action',action,'browser',browser,'os',os,'timeIn',time_in,'timeOut',time_out,'sessionState',session_state,'ipAddress',ip_address,'details',description) ORDER BY event_time DESC,id DESC) FROM limited),'[]'),'total',n,'page',p,'pageSize',p_page_size) INTO result FROM paging;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_portal_active_logs(text,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_portal_active_logs(text,text,timestamptz,timestamptz,integer,integer) TO authenticated,service_role;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.portal_log_sessions,public.portal_active_log_entries;
 END IF;
END$$;
NOTIFY pgrst,'reload schema';


-- Validation-only transaction. New feature tables remain uncommitted and invisible
-- to other sessions. Audit fixtures use a TEMP table; existing audit/auth data is not changed.
CREATE TEMP TABLE admin_activity_logs (LIKE public.admin_activity_logs INCLUDING DEFAULTS);
ALTER TABLE pg_temp.admin_activity_logs ALTER COLUMN target_id SET DEFAULT 'SYNTHETIC-TARGET';
CREATE TRIGGER isolated_capture AFTER INSERT ON pg_temp.admin_activity_logs FOR EACH ROW EXECUTE FUNCTION public.portal_capture_completed_activity();
DO $test$
DECLARE actor uuid:='a1111111-1111-4111-8111-111111111111';sid uuid:='b1111111-1111-4111-8111-111111111111';entry uuid:='c1111111-1111-4111-8111-111111111111';n bigint;response jsonb;
BEGIN
 IF has_function_privilege('authenticated','public.manage_portal_log_session(uuid,uuid,text,text,text,text,integer)','EXECUTE') OR has_function_privilege('anon','public.read_portal_active_logs(text,text,timestamptz,timestamptz,integer,integer)','EXECUTE') OR has_function_privilege('authenticated','public.append_completed_portal_action(uuid,uuid,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe function privilege';END IF;
 IF has_table_privilege('authenticated','public.portal_active_log_entries','INSERT') OR has_table_privilege('anon','public.portal_log_sessions','SELECT') THEN RAISE EXCEPTION 'Unsafe table privilege';END IF;
 IF public.portal_completed_action_label('failed-login') IS NOT NULL OR public.portal_completed_action_label('authorize:block-account') IS NOT NULL OR public.portal_completed_action_label('new-unimplemented-action') IS NOT NULL OR public.portal_completed_action_label('change-own-password')<>'Change Password' THEN RAISE EXCEPTION 'Action classification failed';END IF;
 BEGIN PERFORM public.manage_portal_log_session(actor,sid,'start');RAISE EXCEPTION 'Fabricated authentication was accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 INSERT INTO public.portal_log_sessions(id,auth_session_id,actor_id,account_number,actor_name,actor_role,browser,os,ip_address,expires_at) VALUES(entry,sid,actor,'SYNTHETIC-001','Synthetic Admin','admin','Chrome','Windows','127.0.0.1',now()+interval '15 minutes');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 PERFORM set_config('request.headers',jsonb_build_object('x-coop-session-id',sid)::text,true);
 INSERT INTO pg_temp.admin_activity_logs(id,actor_id,action_name,result,target_id,details) VALUES('d1111111-1111-4111-8111-111111111111',actor,'create-account','success','SYNTHETIC-TARGET','{}');
 SELECT count(*) INTO n FROM public.portal_active_log_entries;IF n<>1 THEN RAISE EXCEPTION 'Completed action not captured';END IF;
 INSERT INTO pg_temp.admin_activity_logs(actor_id,action_name,result,details) VALUES(actor,'block-account','failure','{}'),(actor,'authorize:block-account','success','{}'),(actor,'unknown-action','success','{}'),(actor,'block-account','success','{"operation_completed":false}');
 SELECT count(*) INTO n FROM public.portal_active_log_entries;IF n<>1 THEN RAISE EXCEPTION 'A failed, incomplete or unknown action was captured';END IF;
 PERFORM set_config('request.headers','{}',true);
 INSERT INTO pg_temp.admin_activity_logs(actor_id,action_name,result) VALUES(actor,'block-account','success');
 SELECT count(*) INTO n FROM public.portal_active_log_entries;IF n<>1 THEN RAISE EXCEPTION 'Background action was captured';END IF;
 PERFORM set_config('request.headers',jsonb_build_object('x-coop-session-id',sid)::text,true);
 INSERT INTO pg_temp.admin_activity_logs(actor_id,action_name,result,target_id,details) VALUES(actor,'reject-loan','success','SYNTHETIC-APP','{"reason":"Synthetic decision"}');
 IF NOT EXISTS(SELECT 1 FROM public.portal_active_log_entries WHERE action_label='Reject Application' AND browser='Chrome' AND os='Windows' AND description LIKE '%Synthetic decision%') THEN RAISE EXCEPTION 'Completed rejection or session attribution failed';END IF;
 INSERT INTO pg_temp.admin_activity_logs(id,actor_id,action_name,result,details) VALUES('d1111111-1111-4111-8111-111111111111',actor,'create-account','success','{}');
 SELECT count(*) INTO n FROM public.portal_active_log_entries;IF n<>2 THEN RAISE EXCEPTION 'Duplicate source captured';END IF;
 PERFORM public.append_completed_portal_action(actor,sid,'protected:'||repeat('a',64),'block-account','SYNTHETIC-TARGET','Synthetic reason');
 PERFORM public.append_completed_portal_action(actor,sid,'protected:'||repeat('a',64),'block-account','SYNTHETIC-TARGET','Synthetic reason');
 SELECT count(*) INTO n FROM public.portal_active_log_entries;IF n<>3 THEN RAISE EXCEPTION 'Protected receipt retry duplicated';END IF;
 UPDATE public.portal_log_sessions SET started_at=now()-interval '20 minutes',last_activity_at=now()-interval '20 minutes',expires_at=now()-interval '5 minutes' WHERE id=entry;
 INSERT INTO pg_temp.admin_activity_logs(actor_id,action_name,result) VALUES(actor,'create-account','success');
 SELECT count(*) INTO n FROM public.portal_active_log_entries;IF n<>3 THEN RAISE EXCEPTION 'Expired session accepted an action';END IF;
 BEGIN UPDATE public.portal_active_log_entries SET description='changed';RAISE EXCEPTION 'Activity could be edited';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END;
$test$;
-- This temporary definition exists only in this rolled-back transaction. It tests
-- the paginated reader without accessing a real user or real authentication session.
CREATE OR REPLACE FUNCTION public.portal_log_viewer_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT 'super_admin'::text$$;
DO $test$DECLARE data jsonb;BEGIN
 data:=public.read_portal_active_logs();IF (data->>'total')::integer<>4 OR jsonb_array_length(data->'rows')<>4 THEN RAISE EXCEPTION 'Unified session/action reader failed';END IF;
 IF (public.read_portal_active_logs('Synthetic reason')->>'total')::integer<>1 THEN RAISE EXCEPTION 'Search filter failed';END IF;
 IF (public.read_portal_active_logs('','bod_member')->>'total')::integer<>0 THEN RAISE EXCEPTION 'Role filter failed';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'rows') row WHERE row->>'action'='Login' AND row->>'sessionState'='closed' AND row->>'timeOut' IS NOT NULL) THEN RAISE EXCEPTION 'Expired login displayed active';END IF;
END;$test$;
ROLLBACK;
