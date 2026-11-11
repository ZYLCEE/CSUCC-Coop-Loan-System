-- The API already uses this dispatcher, but it was missing from the deployed database.
BEGIN;
CREATE OR REPLACE FUNCTION public.application_workflow_action(p_actor_id uuid,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true); result jsonb;
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'A verified staff account is required.' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 result:=public.mutate_application_verification(p_args->>'applicationId',p_args->>'operation',(p_args->>'revision')::integer,p_args->>'stateHash',p_args->'payload',(p_args->>'requestId')::uuid);
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN result;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.application_workflow_action(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.application_workflow_action(uuid,jsonb) TO service_role;
-- Staff actions go through the verified API dispatcher.
REVOKE ALL ON FUNCTION public.mutate_application_verification(text,text,integer,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';

DO $test$
DECLARE actor uuid; member_actor uuid; state jsonb; result jsonb; replay jsonb; test_request uuid:=gen_random_uuid(); args jsonb; denied boolean:=false;
BEGIN
 IF has_function_privilege('authenticated','public.application_workflow_action(uuid,jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.application_workflow_action(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Dispatcher grants are incorrect';END IF;
 IF has_function_privilege('authenticated','public.mutate_application_verification(text,text,integer,text,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Browser can bypass dispatcher';END IF;
 SELECT id INTO STRICT actor FROM auth.users WHERE raw_app_meta_data->>'role'='super_admin' AND coalesce(raw_app_meta_data->>'account_status','active')='active' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 state:=public.get_application_verification('LA-2026-964420');
 args:=jsonb_build_object('applicationId','LA-2026-964420','operation','start','revision',state->'revision','stateHash',state->>'stateHash','payload','{}'::jsonb,'requestId',test_request);
 result:=public.application_workflow_action(actor,args);
 IF result->>'stage'<>'needs_verification' THEN RAISE EXCEPTION 'Start did not open requirements checking';END IF;
 replay:=public.application_workflow_action(actor,args);
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'Retry did not return the saved result';END IF;
 IF (SELECT count(*) FROM public.application_workflow_events WHERE request_id=test_request)<>1 THEN RAISE EXCEPTION 'Duplicate workflow history';END IF;
 state:=public.get_application_verification('LA-2026-964420');
 result:=public.application_workflow_action(actor,jsonb_build_object('applicationId','LA-2026-964420','operation','save_draft','revision',state->'revision','stateHash',state->>'stateHash','payload',jsonb_build_object('checks',jsonb_build_object('identity',true,'eligibility',false,'terms',false),'notes',''),'requestId',gen_random_uuid()));
 state:=public.get_application_verification('LA-2026-964420');
 BEGIN PERFORM public.application_workflow_action(actor,jsonb_build_object('applicationId','LA-2026-964420','operation','mark_verified','revision',state->'revision','stateHash',state->>'stateHash','payload','{}'::jsonb,'requestId',gen_random_uuid()));
 EXCEPTION WHEN raise_exception THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Incomplete requirements were marked verified';END IF;
 SELECT user_id INTO member_actor FROM public.members WHERE id=(SELECT member_id FROM public.loan_applications WHERE application_id='LA-2026-964420');denied:=false;
 BEGIN PERFORM public.application_workflow_action(member_actor,args);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Member actor admitted';END IF;
 IF (SELECT status FROM public.loan_applications WHERE application_id='LA-2026-964420')<>'pending' THEN RAISE EXCEPTION 'Start changed loan approval status';END IF;
END;
$test$;
SELECT 'PASS: Start checking and Save checks work; replay creates one event; incomplete verification and member actors remain blocked; loan remains pending; all changes roll back' AS validation;
ROLLBACK;
