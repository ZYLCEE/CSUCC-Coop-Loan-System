import {readFileSync,writeFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261111213000_active_log_role_visibility.sql','utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const cases=String.raw`
-- Every fixture and helper override is inside this rolled-back transaction.
-- No real Auth users, memberships, loan records or audit records are changed.
DO $$ BEGIN
 IF public.portal_display_account_id('2026-0005')<>'CSUCC-2026-0005' OR public.portal_display_account_id('csucc-2026-0005')<>'CSUCC-2026-0005' OR public.portal_display_account_id('custom-id')<>'custom-id' THEN RAISE EXCEPTION 'ID display mismatch';END IF;
 IF has_function_privilege('authenticated','public.manage_portal_log_session(uuid,uuid,text,text,text,text,integer)','EXECUTE') OR has_function_privilege('anon','public.member_log_session(text,integer,text)','EXECUTE') OR has_table_privilege('authenticated','public.portal_active_log_entries','INSERT') THEN RAISE EXCEPTION 'Writer permissions broadened';END IF;
 IF public.portal_log_viewer_role() IS NOT NULL THEN RAISE EXCEPTION 'Missing identity admitted';END IF;
 BEGIN PERFORM public.member_log_session('start');RAISE EXCEPTION 'Unverified member admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
CREATE TEMP TABLE log_role_fixtures(actor uuid,session_id uuid,auth_id uuid,role text);
INSERT INTO log_role_fixtures SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),role FROM unnest(ARRAY['super_admin','admin','member','crecom_member','bod_member']) role CROSS JOIN generate_series(1,2);
INSERT INTO public.portal_log_sessions(id,auth_session_id,actor_id,account_number,actor_name,actor_role,expires_at)
 SELECT session_id,auth_id,actor,'2026-0005','ROLE-SCOPE-FIXTURE '||role,role,now()+interval '15 minutes' FROM log_role_fixtures;
INSERT INTO public.portal_active_log_entries(source_key,session_id,actor_id,account_number,actor_name,actor_role,action_label,description)
 SELECT 'role-scope:'||actor,session_id,actor,'2026-0005','ROLE-SCOPE-FIXTURE '||role,role,'Update Profile','ROLE-SCOPE-FIXTURE completed profile update' FROM log_role_fixtures;

CREATE TEMP TABLE portal_activity_events (LIKE public.portal_activity_events INCLUDING DEFAULTS);
ALTER TABLE pg_temp.portal_activity_events ALTER COLUMN actor_name SET DEFAULT 'ROLE-CAPTURE-FIXTURE',ALTER COLUMN actor_role SET DEFAULT 'member';
CREATE TRIGGER isolated_event_capture AFTER INSERT ON pg_temp.portal_activity_events FOR EACH ROW EXECUTE FUNCTION public.portal_capture_completed_activity();
DO $$ DECLARE actor_row record; before_count bigint; BEGIN BEGIN
 SELECT * INTO actor_row FROM log_role_fixtures WHERE role='member' LIMIT 1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_row.actor,'session_id',actor_row.auth_id)::text,true);
 SELECT count(*) INTO before_count FROM public.portal_active_log_entries WHERE actor_id=actor_row.actor;
 INSERT INTO pg_temp.portal_activity_events(source_key,category,action,title,message,entity_type,entity_key,actor_id)
 VALUES('loan_applications:role-fixture','loans','loan_submitted','Loan submitted','ROLE-CAPTURE-FIXTURE successful submission','application','SYNTHETIC-APP',actor_row.actor);
 IF (SELECT count(*) FROM public.portal_active_log_entries WHERE actor_id=actor_row.actor)<>before_count+1 THEN RAISE EXCEPTION 'Member submission not captured';END IF;
 INSERT INTO pg_temp.portal_activity_events(source_key,category,action,title,message,entity_type,entity_key,actor_id)
 VALUES('background:role-fixture','loans','unknown_action','Unknown event','ROLE-CAPTURE-FIXTURE excluded','application','SYNTHETIC-APP',actor_row.actor);
 IF (SELECT count(*) FROM public.portal_active_log_entries WHERE actor_id=actor_row.actor)<>before_count+1 THEN RAISE EXCEPTION 'Unknown event captured';END IF;
 RAISE EXCEPTION 'Rollback event-capture fixtures' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;END;END $$;

-- Private fixtures let the reader and the actual SELECT policies be exercised
-- under each role without creating synthetic Auth accounts or sessions.
CREATE OR REPLACE FUNCTION public.portal_log_viewer_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT nullif(current_setting('coop_test.viewer',true),'') $$;
GRANT SELECT ON log_role_fixtures TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r text; actor_value uuid; response jsonb; expected integer; n integer; BEGIN
 FOREACH r IN ARRAY ARRAY['super_admin','admin','member','crecom_member','bod_member'] LOOP
  SELECT actor INTO actor_value FROM log_role_fixtures WHERE role=r ORDER BY actor LIMIT 1;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_value)::text,true);
  PERFORM set_config('coop_test.viewer',r,true);
  expected:=CASE r WHEN 'super_admin' THEN 10 WHEN 'admin' THEN 8 ELSE 1 END;
  SELECT count(*) INTO n FROM public.portal_log_sessions WHERE actor_name LIKE 'ROLE-SCOPE-FIXTURE%';
  IF n<>expected THEN RAISE EXCEPTION 'Session RLS mismatch for %: %',r,n;END IF;
  SELECT count(*) INTO n FROM public.portal_active_log_entries WHERE source_key LIKE 'role-scope:%';
  IF n<>expected THEN RAISE EXCEPTION 'Entry RLS mismatch for %: %',r,n;END IF;
  response:=public.read_portal_active_logs('ROLE-SCOPE-FIXTURE','',NULL,NULL,1,50);
  IF (response->>'total')::integer<>expected*2 THEN RAISE EXCEPTION 'Reader scope mismatch for %: %',r,response;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(response->'rows') x WHERE x->>'accountNumber'<>'CSUCC-2026-0005') THEN RAISE EXCEPTION 'Reader ID mismatch';END IF;
  IF r IN ('member','crecom_member','bod_member') THEN
   response:=public.read_portal_active_logs('ROLE-SCOPE-FIXTURE','super_admin',NULL,NULL,1,50);
   IF (response->>'total')::integer<>0 THEN RAISE EXCEPTION 'Role filter escaped owner scope for %',r;END IF;
  END IF;
 END LOOP;
 PERFORM set_config('coop_test.viewer','',true);
 SELECT count(*) INTO n FROM public.portal_log_sessions;IF n<>0 THEN RAISE EXCEPTION 'Unadmitted viewer saw sessions';END IF;
 BEGIN PERFORM public.read_portal_active_logs();RAISE EXCEPTION 'Unadmitted viewer read logs';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT 'PASS: five-role reader and RLS scopes, same-role privacy, member completed-event capture, unknown-event exclusion, canonical ID display and private writers' AS validation;
ROLLBACK;
`;
writeFileSync('docs/active-logs/role-visibility-rollback.sql','BEGIN;\n'+migration+'\n'+cases);
