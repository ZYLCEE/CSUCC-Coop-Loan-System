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
COMMIT;
