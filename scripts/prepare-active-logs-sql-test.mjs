import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261111200000_portal_active_logs.sql','utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const test=String.raw`
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
`;
mkdirSync('docs/active-logs',{recursive:true});writeFileSync('docs/active-logs/rollback-validation.sql','BEGIN;\n'+migration+'\n'+test);
console.log('Prepared rollback-only Active Logs validation; no database contacted.');
