-- Standalone rejection repair. No reports, email workers, routing triggers,
-- backfills, assignments or loan decisions are executed by applying this file.
BEGIN;
CREATE TABLE IF NOT EXISTS public.portal_rejection_requests(
 id uuid PRIMARY KEY,application_id uuid NOT NULL REFERENCES public.loan_applications(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.portal_rejection_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_rejection_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.portal_rejection_requests TO service_role;
CREATE OR REPLACE FUNCTION public.committee_record_final(p_application uuid,p_decision text,p_mode text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; c public.application_review_cycles%ROWTYPE; b public.application_review_cycles%ROWTYPE;
 r public.committee_policy_rules%ROWTYPE; p public.approval_workflow_policies%ROWTYPE; w public.application_verifications%ROWTYPE;
 chosen_cycles uuid[]:='{}';recipient uuid;snapshot_hash text;
BEGIN
 IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Choose a final decision and enter a member-facing reason.'; END IF;
 IF NOT public.document_staff_access('applications.finalize') OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid()) IS DISTINCT FROM 'super_admin'
 OR p_mode IS DISTINCT FROM 'super_admin' THEN RAISE EXCEPTION 'Only Super Admin may record the final decision.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.loan_applications WHERE id=p_application FOR UPDATE;
 IF a.status NOT IN ('pending','under review') OR EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=a.id) THEN RAISE EXCEPTION 'This application already has a final decision or is awaiting member corrections.' USING ERRCODE='40001'; END IF;
 SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id FOR UPDATE;
 SELECT * INTO c FROM public.application_review_cycles WHERE application_id=a.id AND stage='CRECOM' AND status<>'superseded' ORDER BY cycle_no DESC LIMIT 1;
 SELECT * INTO p FROM public.approval_workflow_policies WHERE id=coalesce(c.policy_id,w.policy_id) AND status='approved';
 SELECT * INTO r FROM public.committee_policy_rules WHERE policy_id=p.id;
 IF p.id IS NULL OR r.policy_id IS NULL OR r.final_mode<>'super_admin' THEN RAISE EXCEPTION 'An active project workflow policy with Super Admin final authority is required.'; END IF;
 IF c.id IS NOT NULL THEN
  IF c.status<>'completed' OR c.outcome IS NULL OR NOT public.committee_packet_is_current(c.id) OR NOT public.committee_signatories_complete(c.id) THEN RAISE EXCEPTION 'All assigned CRECOM reviewers must respond for the current application version before the final decision.'; END IF;
  chosen_cycles:=array_append(chosen_cycles,c.id);
  SELECT * INTO b FROM public.application_review_cycles WHERE application_id=a.id AND cycle_no=c.cycle_no AND stage='BOD' AND status<>'superseded' LIMIT 1;
  IF b.id IS NOT NULL THEN
   IF b.status<>'completed' OR b.outcome IS NULL OR NOT public.committee_packet_is_current(b.id) OR NOT public.committee_signatories_complete(b.id) THEN RAISE EXCEPTION 'All assigned BOD reviewers must respond for the current application version before the final decision.'; END IF;
   chosen_cycles:=array_append(chosen_cycles,b.id);
  END IF;
 END IF;
 IF p_decision='approve' THEN
  IF c.id IS NULL OR c.outcome IS DISTINCT FROM 'approve' OR c.bod_required IS DISTINCT FROM true OR p.config->>'bodMode' IS DISTINCT FROM 'required'
   OR r.signatory_layout IS DISTINCT FROM 'manual_form_v1' OR b.id IS NULL OR b.outcome IS DISTINCT FROM 'approve' THEN RAISE EXCEPTION 'All three CRECOM approvals and the BOD approval are required. A rejection cannot be overridden.'; END IF;
  IF w.stage<>'ready_for_committee' OR w.verified_state_hash IS DISTINCT FROM public.private_application_verification_state(a.id)->>'stateHash'
   OR jsonb_array_length(public.private_application_verification_state(a.id)->'blockers')<>0 THEN RAISE EXCEPTION 'Complete current requirements verification before approval.'; END IF;
 END IF;
 snapshot_hash:=coalesce(c.packet_snapshot->>'stateHash',public.private_application_verification_state(a.id)->>'stateHash');
 INSERT INTO public.application_final_decisions(application_id,policy_id,decision,mode,reason,state_hash,cycle_ids,actor_id,actor_name)
 VALUES(a.id,p.id,p_decision,'super_admin',btrim(p_reason),snapshot_hash,chosen_cycles,auth.uid(),public.document_actor_label());
 UPDATE public.loan_applications SET status=CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
 date_approved=CASE WHEN p_decision='approve' THEN (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date ELSE date_approved END WHERE id=a.id;
 SELECT user_id INTO recipient FROM public.members WHERE id=a.member_id;
 IF recipient IS NOT NULL THEN INSERT INTO public.notifications(user_id,title,message,type,read,data)
 VALUES(recipient,CASE WHEN p_decision='approve' THEN 'Loan application approved' ELSE 'Loan application not approved' END,
 CASE WHEN p_decision='approve' THEN format('Application %s has received final approval and is awaiting release. We will notify you when your loan is released.',a.application_id)
 ELSE format('After final review, application %s was not approved. Reason: %s. View the decision and any available next steps in the app.',a.application_id,btrim(p_reason)) END,'info',false,jsonb_build_object('category','loans','entityType','application','entityKey',a.application_id,'event','final_'||p_decision));END IF;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'application-final-'||p_decision,a.application_id,'success',jsonb_build_object('policyId',p.id,'cycles',chosen_cycles,'reason',p_reason,'mode','super_admin'));
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_reject_application(p_actor_id uuid,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true);a public.loan_applications%ROWTYPE;
 prior public.portal_rejection_requests%ROWTYPE;state jsonb;output jsonb;fingerprint text;request_id uuid:=(p_args->>'requestId')::uuid;
 reason text:=btrim(coalesce(p_args->'payload'->>'reason',''));
BEGIN
 IF p_actor_id IS NULL OR request_id IS NULL OR length(reason) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Choose an application and enter a member-facing rejection reason.';END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF NOT public.document_staff_access('applications.finalize') OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id AND raw_app_meta_data->>'role'='super_admin') THEN RAISE EXCEPTION 'Only Super Admin may record the final decision.' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-rejection:'||request_id::text,0));
 SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_args->>'applicationId' FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor_id,'args',p_args)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.portal_rejection_requests WHERE id=request_id;
 IF FOUND THEN
  IF prior.actor_id<>p_actor_id OR prior.request_hash<>fingerprint THEN RAISE EXCEPTION 'This request reference was already used.' USING ERRCODE='40001';END IF;
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN prior.result;
 END IF;
 IF a.status NOT IN ('pending','under review') OR EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=a.id) THEN RAISE EXCEPTION 'This application already has a final decision or is awaiting member corrections.' USING ERRCODE='40001';END IF;
 state:=public.get_application_verification(a.application_id);
 IF (state->>'revision')::integer IS DISTINCT FROM (p_args->>'revision')::integer OR state->>'stateHash' IS DISTINCT FROM p_args->>'stateHash' THEN RAISE EXCEPTION 'The application changed. Reload before confirming rejection.' USING ERRCODE='40001';END IF;
 IF NOT coalesce((state->>'enrolled')::boolean,false) THEN
  PERFORM public.mutate_application_verification(a.application_id,'start',(state->>'revision')::integer,state->>'stateHash','{}',md5(request_id||':start')::uuid);
 END IF;
 PERFORM public.committee_record_final(a.id,'reject','super_admin',reason);
 output:=public.get_application_verification(a.application_id);
 INSERT INTO public.portal_rejection_requests(id,application_id,actor_id,request_hash,result) VALUES(request_id,a.id,p_actor_id,fingerprint,output);
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN output;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.committee_record_final(uuid,text,text,text),public.portal_reject_application(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_reject_application(uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
