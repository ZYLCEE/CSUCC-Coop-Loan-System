import {readFileSync,writeFileSync} from 'node:fs';
const old=readFileSync('supabase/migrations/20261111200000_portal_active_logs.sql','utf8');
function fn(name){const start=old.indexOf('CREATE FUNCTION public.'+name+'('),end=old.indexOf('\n$$;',start)+4;if(start<0||end<4)throw Error(name);return old.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');}
let manage=fn('manage_portal_log_session').replace("'super_admin','admin','crecom_member','bod_member'","'super_admin','admin','member','crecom_member','bod_member'");
manage=manage.replace(" IF s.id IS NOT NULL AND (s.ended_at",` IF role_value='member' AND NOT EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=p_actor_id AND m.status='active' AND m.must_change_password=false) THEN RAISE EXCEPTION 'Active member access is required.' USING ERRCODE='42501';END IF;
 IF s.id IS NOT NULL AND (s.ended_at`);
let capture=fn('portal_capture_completed_activity');
capture=capture.replace("  -- Announcement row changes commit inside the existing feature; no synthetic/background events.\n  IF NEW.source_key NOT LIKE 'announcements:%' OR NEW.action NOT IN ('announcement_draft','announcement_published','announcement_scheduled','announcement_archived','announcement_deleted','announcement_updated') THEN RETURN NEW;END IF;\n  label:=NEW.title;actor:=NEW.actor_id;target:=NEW.entity_key;description:=NEW.message;source:='event:'||NEW.id;",`  -- Only completed feature events are admitted. Member attribution is checked
  -- again against the actual session below; staff actions retain their audit source.
  actor:=NEW.actor_id;target:=NEW.entity_key;description:=NEW.message;source:='event:'||NEW.id;
  IF NEW.source_key LIKE 'announcements:%' AND NEW.action IN ('announcement_draft','announcement_published','announcement_scheduled','announcement_archived','announcement_deleted','announcement_updated') THEN label:=NEW.title;
  ELSIF (NEW.source_key LIKE 'loan_applications:%' AND NEW.action IN ('loan_submitted','loan_updated'))
    OR (NEW.source_key LIKE 'loan_documents:%' AND NEW.action='document_uploaded')
    OR (NEW.source_key LIKE 'loan_document_versions:%' AND NEW.action='document_replaced')
    OR (NEW.source_key LIKE 'members:%' AND NEW.action='account_updated')
    OR (NEW.source_key LIKE 'consent:%' AND NEW.action='consent_recorded') THEN
   label:=CASE NEW.action WHEN 'loan_submitted' THEN 'Submit Loan Application' WHEN 'loan_updated' THEN 'Update Loan Application' WHEN 'document_uploaded' THEN 'Upload Document' WHEN 'document_replaced' THEN 'Replace Document' WHEN 'account_updated' THEN 'Update Profile' WHEN 'consent_recorded' THEN 'Submit Consent Evidence' END;
  ELSE RETURN NEW;END IF;`);
capture=capture.replace(" IF NOT FOUND THEN RETURN NEW;END IF;"," IF NOT FOUND THEN RETURN NEW;END IF;\n IF TG_TABLE_NAME<>'admin_activity_logs' THEN\n  IF NEW.source_key NOT LIKE 'announcements:%' AND s.actor_role<>'member' THEN RETURN NEW;END IF;\n END IF;");
let reader=fn('read_portal_active_logs').replace("Administrator access is required.","Active cooperative account access is required.").replace("'','super_admin','admin','crecom_member','bod_member'","'','super_admin','admin','member','crecom_member','bod_member'");
reader=reader.replace("s.id,s.account_number,s.actor_name,s.actor_role,","s.id,s.actor_id,public.portal_display_account_id(s.account_number) account_number,s.actor_name,s.actor_role,");
reader=reader.replace("e.id,e.account_number,e.actor_name,e.actor_role,","e.id,e.actor_id,public.portal_display_account_id(e.account_number),e.actor_name,e.actor_role,");
reader=reader.replace("(viewer='super_admin' OR actor_role<>'super_admin')","public.portal_log_row_visible(actor_id,actor_role)");
const hooks=fn('portal_close_revoked_log_sessions').replace("'super_admin','admin','coop_admin','crecom_member','bod_member'","'super_admin','admin','coop_admin','member','crecom_member','bod_member'").replace("lower(coalesce(new_row->>'status',''))<>'active'", "(lower(coalesce(new_row->>'status',''))<>'active' OR new_row->>'must_change_password'='true')");
const sql=`-- Five-role visibility and member portal integration. Existing identities and log history stay intact.
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

${manage}

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

${hooks}
DROP TRIGGER close_revoked_member_portal_logs ON public.members;
CREATE TRIGGER close_revoked_member_portal_logs AFTER UPDATE OF status,user_id,must_change_password OR DELETE ON public.members FOR EACH ROW EXECUTE FUNCTION public.portal_close_revoked_log_sessions();

${capture}

${reader}
NOTIFY pgrst,'reload schema';
COMMIT;
`;
if(!capture.includes('Submit Loan Application')||!reader.includes('portal_log_row_visible(actor_id,actor_role)')||!manage.includes('Active member access'))throw Error('Migration preparation failed');
writeFileSync('supabase/migrations/20261111213000_active_log_role_visibility.sql',sql);
