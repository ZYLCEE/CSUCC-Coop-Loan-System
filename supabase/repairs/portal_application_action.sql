-- Focused repair for the missing atomic verify-and-forward RPC.
-- Expected target: production project jhgsqvxlvwhrwpcekvpq. Confirm the target
-- before execution. This file is staged for review and has not been applied.
-- It deliberately leaves portal_dashboard_totals and committee_record_final
-- untouched; the broader migration replaces committee_record_final.
BEGIN;

DO $$
BEGIN
 IF to_regclass('public.portal_action_requests') IS NOT NULL THEN
  RAISE EXCEPTION 'public.portal_action_requests already exists; inspect it before applying this repair.';
 END IF;
 IF to_regprocedure('public.portal_application_action(uuid,text,jsonb)') IS NOT NULL THEN
  RAISE EXCEPTION 'public.portal_application_action already exists; inspect it before applying this repair.';
 END IF;
END;
$$;

CREATE TABLE public.portal_action_requests(
 id uuid PRIMARY KEY,application_id uuid NOT NULL REFERENCES public.loan_applications(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),operation text NOT NULL CHECK(operation IN ('verify_and_forward','recommend_rejection','reject_application')),
 request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.portal_action_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_action_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.portal_action_requests TO authenticated;
GRANT ALL ON public.portal_action_requests TO service_role;
CREATE POLICY staff_read_portal_action_requests ON public.portal_action_requests FOR SELECT TO authenticated USING(public.document_staff_access());

-- Called only by the password-verifying server endpoint. Its sub-actions are
-- one transaction: verification cannot report successful routing on failure.
CREATE FUNCTION public.portal_application_action(p_actor_id uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true);previous_combined text:=current_setting('coop.verifying_and_routing',true);a public.loan_applications%ROWTYPE;state jsonb;output jsonb;prior public.portal_action_requests%ROWTYPE;
 fingerprint text;request_id uuid:=(p_args->>'requestId')::uuid;reviewers uuid[];n integer;candidate record;reason text:=btrim(coalesce(p_args->'payload'->>'reason',''));member_name text;
BEGIN
 IF p_actor_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('verify_and_forward','recommend_rejection','reject_application') OR request_id IS NULL THEN RAISE EXCEPTION 'Choose a valid protected application action.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF NOT public.document_staff_access(CASE WHEN p_operation='verify_and_forward' THEN 'applications.verify' WHEN p_operation='recommend_rejection' THEN 'applications.verify' ELSE 'applications.finalize' END) THEN RAISE EXCEPTION 'Application action permission is required.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-action:'||request_id::text,0));
 SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_args->>'applicationId' FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor_id,'operation',p_operation,'args',p_args)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.portal_action_requests WHERE id=request_id;
 IF FOUND THEN
  IF prior.actor_id<>p_actor_id OR prior.request_hash<>fingerprint THEN RAISE EXCEPTION 'This request reference was already used.' USING ERRCODE='40001';END IF;
  PERFORM set_config('coop.verifying_and_routing',coalesce(previous_combined,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN prior.result;
 END IF;
 IF a.status NOT IN ('pending','under review') OR EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=a.id) THEN RAISE EXCEPTION 'This application is no longer available for that action.' USING ERRCODE='40001';END IF;
 state:=public.get_application_verification(a.application_id);
 IF (state->>'revision')::integer IS DISTINCT FROM (p_args->>'revision')::integer OR state->>'stateHash' IS DISTINCT FROM p_args->>'stateHash' THEN RAISE EXCEPTION 'Application requirements changed. Reload before confirming.' USING ERRCODE='40001';END IF;
 IF p_operation='verify_and_forward' THEN
  PERFORM set_config('coop.verifying_and_routing','true',true);
  IF NOT public.document_staff_access('applications.forward') THEN RAISE EXCEPTION 'Application forwarding permission is required.' USING ERRCODE='42501';END IF;
  IF jsonb_typeof(p_args->'payload'->'checks') IS DISTINCT FROM 'object' OR p_args->'payload'->'checks' IS DISTINCT FROM '{"identity":true,"eligibility":true,"terms":true}'::jsonb THEN RAISE EXCEPTION 'Complete every requirements check before verification.';END IF;
  IF NOT (state->>'enrolled')::boolean THEN state:=public.mutate_application_verification(a.application_id,'start',(state->>'revision')::integer,state->>'stateHash','{}',md5(request_id||':start')::uuid);state:=public.get_application_verification(a.application_id);END IF;
  state:=public.mutate_application_verification(a.application_id,'save_draft',(state->>'revision')::integer,state->>'stateHash',jsonb_build_object('checks',p_args->'payload'->'checks','notes',coalesce(state->>'notes','')),md5(request_id||':checks')::uuid);state:=public.get_application_verification(a.application_id);
  state:=public.mutate_application_verification(a.application_id,'mark_verified',(state->>'revision')::integer,state->>'stateHash','{}',md5(request_id||':verified')::uuid);state:=public.get_application_verification(a.application_id);
  reviewers:='{}';
  FOR candidate IN SELECT * FROM (VALUES('member'::text,1),('member',2),('chairperson',NULL)) AS positions(seat,number) LOOP
   SELECT count(*)::integer,array_agg(m.id ORDER BY m.id) INTO n,reviewers FROM public.staff_memberships m
    WHERE m.role='crecom_member' AND ((m.committee_seat='chairperson' AND candidate.seat='chairperson') OR (m.committee_seat='member' AND candidate.seat='member' AND m.member_number=candidate.number))
    AND public.committee_reviewer_available(m.id,a.id,'CRECOM');
   IF n<>1 THEN RAISE EXCEPTION 'Exactly one eligible account is required for each CRECOM position. Review Committee Accounts before sending.';END IF;
  END LOOP;
  SELECT array_agg(m.id ORDER BY m.committee_seat,m.member_number) INTO reviewers FROM public.staff_memberships m
   WHERE m.role='crecom_member' AND (m.committee_seat='chairperson' OR (m.committee_seat='member' AND m.member_number IN (1,2))) AND public.committee_reviewer_available(m.id,a.id,'CRECOM');
  PERFORM public.committee_mutate_review(a.application_id,'forward',(state->>'revision')::integer,state->>'stateHash',jsonb_build_object('reviewers',to_jsonb(reviewers),'dueAt',NULL,'bodRequired',true,'routingReason','Project workflow specification'),md5(request_id||':forward')::uuid);
  output:=public.get_application_verification(a.application_id);
 ELSIF p_operation='recommend_rejection' THEN
  IF length(reason) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a clear rejection recommendation.';END IF;
  FOR candidate IN SELECT id FROM auth.users WHERE raw_app_meta_data->>'role'='super_admin' AND coalesce(raw_app_meta_data->>'account_status','active')='active' AND (banned_until IS NULL OR banned_until<=now()) LOOP
   INSERT INTO public.notifications(user_id,title,message,type,read,data) VALUES(candidate.id,'Rejection recommendation received',format('%s: %s recommends rejection. Reason: %s. Review the application before recording a final decision.',a.application_id,public.document_actor_label(),reason),'warning',false,jsonb_build_object('category','approvals','entityType','application','entityKey',a.application_id));
  END LOOP;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(p_actor_id,'application-rejection-recommended',a.application_id,'success',jsonb_build_object('reason',reason,'requestId',request_id));
  output:=jsonb_build_object('success',true,'message','Rejection recommendation recorded. Super Admin must review and decide.','reason',reason);
 ELSE
  IF NOT (state->>'enrolled')::boolean THEN state:=public.mutate_application_verification(a.application_id,'start',(state->>'revision')::integer,state->>'stateHash','{}',md5(request_id||':start')::uuid);state:=public.get_application_verification(a.application_id);END IF;
  PERFORM public.committee_record_final(a.id,'reject','super_admin',reason);
  output:=public.get_application_verification(a.application_id);
 END IF;
 INSERT INTO public.portal_action_requests(id,application_id,actor_id,operation,request_hash,result) VALUES(request_id,a.id,p_actor_id,p_operation,fingerprint,output);
 PERFORM set_config('coop.verifying_and_routing',coalesce(previous_combined,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN output;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('coop.verifying_and_routing',coalesce(previous_combined,''),true);PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_application_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_application_action(uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
