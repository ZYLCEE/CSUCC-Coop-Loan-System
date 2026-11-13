-- Local implementation. Apply only after separate deployment approval.
BEGIN;

CREATE OR REPLACE FUNCTION public.portal_dashboard_totals(p_start date,p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE collections numeric; disbursement numeric; missing boolean; pending integer;
BEGIN
 IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>366 THEN RAISE EXCEPTION 'Choose a valid reporting period.'; END IF;
 SELECT count(*)::integer INTO pending FROM public.loan_applications a
 LEFT JOIN public.application_verifications w ON w.application_id=a.id
 WHERE a.status='pending' AND w.application_id IS NULL;
 SELECT coalesce(sum(payment_amount),0) INTO collections FROM public.loan_payments
 WHERE payment_status='posted' AND payment_date>=p_start AND payment_date<p_end;
 SELECT coalesce(sum(amount-processing_fee_amount_at_release-service_fee_amount_at_release),0),
 coalesce(bool_or(processing_fee_amount_at_release IS NULL OR service_fee_amount_at_release IS NULL),false)
 INTO disbursement,missing FROM public.loan_applications
 WHERE date_released>=p_start AND date_released<p_end AND status IN ('released','overdue','completed');
 missing:=missing OR EXISTS(SELECT 1 FROM public.loan_applications WHERE status IN ('released','overdue','completed') AND date_released IS NULL);
 RETURN jsonb_build_object('pending',pending,'collections',collections,'disbursement',CASE WHEN missing THEN NULL ELSE disbursement END);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_dashboard_totals(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_dashboard_totals(date,date) TO authenticated;

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

-- Approval keeps every existing committee prerequisite. Rejection checks only
-- the stages actually assigned, so a failed CRECOM review never needs BOD.
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
REVOKE ALL ON FUNCTION public.portal_application_action(uuid,text,jsonb),public.committee_record_final(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_application_action(uuid,text,jsonb) TO service_role;
DO $$
DECLARE item text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH item IN ARRAY ARRAY['loan_applications','members','loan_payments','application_verifications'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=item) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',item);
   END IF;
  END LOOP;
 END IF;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
