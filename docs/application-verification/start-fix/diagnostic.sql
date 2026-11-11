BEGIN;
DO $test$
DECLARE actor uuid; current_state jsonb; result jsonb; detail text; context text;
BEGIN
 SELECT id INTO STRICT actor FROM auth.users WHERE raw_app_meta_data->>'role'='super_admin' AND coalesce(raw_app_meta_data->>'account_status','active')='active' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 current_state:=public.get_application_verification('LA-2026-964420');
 BEGIN
 result:=public.application_workflow_action(actor,jsonb_build_object('applicationId','LA-2026-964420','operation','start','revision',current_state->'revision','stateHash',current_state->>'stateHash','payload','{}'::jsonb,'requestId',gen_random_uuid()));
 RAISE NOTICE 'Start result: %',result;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS detail=MESSAGE_TEXT,context=PG_EXCEPTION_CONTEXT;RAISE EXCEPTION 'DIAGNOSTIC [%] % / %',SQLSTATE,detail,context;END;
END;
$test$;
ROLLBACK;