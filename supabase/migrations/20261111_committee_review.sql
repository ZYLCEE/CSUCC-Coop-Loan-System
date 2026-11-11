-- Phase 3. No policies, accounts, assignments or loan decisions are seeded.
BEGIN;
CREATE TABLE public.committee_policy_rules(
 policy_id uuid PRIMARY KEY REFERENCES public.approval_workflow_policies(id),
 crecom_approvals integer NOT NULL CHECK(crecom_approvals BETWEEN 1 AND 100),
 bod_reviewers integer CHECK(bod_reviewers BETWEEN 1 AND 100),bod_approvals integer CHECK(bod_approvals BETWEEN 1 AND bod_reviewers),
 final_mode text NOT NULL CHECK(final_mode='super_admin'),
 allow_override boolean NOT NULL,bod_authority text NOT NULL CHECK(bod_authority IN ('pending','recommendation','binding_decision')),
 all_responses boolean NOT NULL CHECK(all_responses),rule_reference text NOT NULL CHECK(length(btrim(rule_reference)) BETWEEN 1 AND 500),
 activated_by uuid NOT NULL REFERENCES auth.users(id),activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.application_review_cycles ADD COLUMN required_approvals integer CHECK(required_approvals>0),
 ADD COLUMN reviewer_target integer CHECK(reviewer_target>0),ADD COLUMN outcome text CHECK(outcome IN ('approve','reject')),
 ADD COLUMN bod_required boolean NOT NULL DEFAULT false,ADD COLUMN routing_reason text NOT NULL DEFAULT '',ADD COLUMN closed_at timestamptz;
ALTER TABLE public.review_assignments ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.individual_review_decisions ADD COLUMN reviewer_name text,
 ADD COLUMN confirmation_text text,ADD COLUMN confirmation_method text CHECK(confirmation_method='account_password');
CREATE TABLE public.committee_review_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,request_hash text NOT NULL,
 application_id uuid NOT NULL REFERENCES public.loan_applications(id),cycle_id uuid REFERENCES public.application_review_cycles(id),
 assignment_id uuid REFERENCES public.review_assignments(id),actor_id uuid NOT NULL REFERENCES auth.users(id),actor_name text NOT NULL,
 action text NOT NULL CHECK(action IN ('forward','forward_bod','approve','reject','clarify','recuse','reply','reassign','reopen','finalize')),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.application_final_decisions(
 application_id uuid PRIMARY KEY REFERENCES public.loan_applications(id),policy_id uuid NOT NULL REFERENCES public.approval_workflow_policies(id),
 decision text NOT NULL CHECK(decision IN ('approve','reject')),mode text NOT NULL CHECK(mode='super_admin'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),state_hash text NOT NULL,cycle_ids uuid[] NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.committee_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committee_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_final_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_policy_rules,public.committee_review_events,public.application_final_decisions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.committee_policy_rules,public.committee_review_events,public.application_final_decisions TO authenticated;
GRANT ALL ON public.committee_policy_rules,public.committee_review_events,public.application_final_decisions TO service_role;
CREATE POLICY staff_read_policy_rules ON public.committee_policy_rules FOR SELECT TO authenticated USING(public.document_staff_access());
CREATE POLICY staff_read_review_events ON public.committee_review_events FOR SELECT TO authenticated USING(public.document_staff_access());
CREATE POLICY staff_read_final_decisions ON public.application_final_decisions FOR SELECT TO authenticated USING(public.document_staff_access());
CREATE TRIGGER immutable_final_decision BEFORE UPDATE OR DELETE ON public.application_final_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();
CREATE TRIGGER immutable_execution_rules BEFORE UPDATE OR DELETE ON public.committee_policy_rules FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();
CREATE TRIGGER immutable_review_events BEFORE UPDATE OR DELETE ON public.committee_review_events FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();

CREATE FUNCTION public.committee_reviewer_available(p_membership uuid,p_application uuid,p_stage text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  JOIN public.loan_applications a ON a.id=p_application JOIN public.members borrower ON borrower.id=a.member_id
  WHERE m.id=p_membership AND m.role=CASE WHEN p_stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
  AND m.active AND m.starts_at<=now() AND (m.ends_at IS NULL OR m.ends_at>now()) AND m.setup_completed_at IS NOT NULL
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
  AND (m.role='crecom_member' OR public.committee_bod_enabled())
  AND m.auth_user_id IS DISTINCT FROM borrower.user_id
  AND NOT EXISTS(SELECT 1 FROM public.members b WHERE b.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.members cm WHERE cm.id::text=to_jsonb(a)->>'co_maker_member_id' AND cm.user_id=u.id));
$$;
CREATE FUNCTION public.committee_packet_is_current(p_cycle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.application_review_cycles c JOIN public.application_verifications v ON v.application_id=c.application_id
 CROSS JOIN LATERAL(SELECT public.private_application_verification_state(c.application_id) AS state)s
 WHERE c.id=p_cycle AND c.status IN ('open','completed') AND v.stage='ready_for_committee'
 AND v.policy_id=c.policy_id AND v.verified_state_hash=c.packet_snapshot->>'stateHash'
 AND c.packet_snapshot->>'stateHash'=s.state->>'stateHash' AND jsonb_array_length(s.state->'blockers')=0);
$$;
CREATE FUNCTION public.committee_application_stage(p_application uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; d public.application_final_decisions%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 IF FOUND THEN RETURN CASE WHEN d.decision='approve' THEN 'final_approved' ELSE 'final_rejected' END; END IF;
 SELECT * INTO c FROM public.application_review_cycles WHERE application_id=p_application AND status<>'superseded' ORDER BY cycle_no DESC,CASE WHEN stage='BOD' THEN 0 ELSE 1 END LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT public.committee_packet_is_current(c.id) THEN RETURN 'review_stale'; END IF;
 IF c.status='open' THEN
  IF EXISTS(SELECT 1 FROM public.review_assignments WHERE review_cycle_id=c.id AND state IN ('awaiting_clarification','recused')) THEN RETURN 'review_attention'; END IF;
  RETURN CASE WHEN c.stage='CRECOM' THEN 'crecom_review' ELSE 'bod_review' END;
 END IF;
 IF c.stage='CRECOM' AND c.bod_required THEN RETURN 'ready_for_bod'; END IF;
 RETURN 'ready_for_final';
END;
$$;
CREATE FUNCTION public.committee_record_final(p_application uuid,p_decision text,p_mode text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; c public.application_review_cycles%ROWTYPE; b public.application_review_cycles%ROWTYPE;
 r public.committee_policy_rules%ROWTYPE; p public.approval_workflow_policies%ROWTYPE; recommendation text; recipient uuid; chosen_cycles uuid[];
BEGIN
 SELECT * INTO STRICT a FROM public.loan_applications WHERE id=p_application FOR UPDATE;
 IF a.status NOT IN ('pending','under review') OR EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=a.id) THEN RAISE EXCEPTION 'This application already has a final decision.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT c FROM public.application_review_cycles WHERE application_id=a.id AND stage='CRECOM' AND status<>'superseded' ORDER BY cycle_no DESC LIMIT 1;
 SELECT * INTO STRICT r FROM public.committee_policy_rules WHERE policy_id=c.policy_id;
 SELECT * INTO STRICT p FROM public.approval_workflow_policies WHERE id=c.policy_id AND status='approved';
 IF c.status<>'completed' OR c.outcome IS NULL OR NOT public.committee_packet_is_current(c.id) THEN RAISE EXCEPTION 'Complete a current CRECOM review before the final decision.'; END IF;
 recommendation:=c.outcome;chosen_cycles:=ARRAY[c.id];
 IF c.bod_required THEN
  SELECT * INTO b FROM public.application_review_cycles WHERE application_id=a.id AND cycle_no=c.cycle_no AND stage='BOD' AND status='completed';
  IF b.id IS NULL OR b.outcome IS NULL OR NOT public.committee_packet_is_current(b.id) THEN RAISE EXCEPTION 'Complete the required current BOD review first.'; END IF;
  chosen_cycles:=array_append(chosen_cycles,b.id);
  IF b.outcome='reject' THEN recommendation:='reject'; END IF;
 END IF;
 IF p_mode IS DISTINCT FROM r.final_mode OR p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Choose the authorized final decision and enter its reason.'; END IF;
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' OR p_mode<>'super_admin' THEN RAISE EXCEPTION 'Super Admin final authority is required.' USING ERRCODE='42501'; END IF;
 IF p_decision='approve' AND recommendation='reject' THEN RAISE EXCEPTION 'A failed required panel approval cannot be overridden.'; END IF;
 INSERT INTO public.application_final_decisions(application_id,policy_id,decision,mode,reason,state_hash,cycle_ids,actor_id,actor_name)
 VALUES(a.id,c.policy_id,p_decision,p_mode,btrim(p_reason),c.packet_snapshot->>'stateHash',chosen_cycles,auth.uid(),public.document_actor_label());
 UPDATE public.loan_applications SET status=CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
 date_approved=CASE WHEN p_decision='approve' THEN (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date ELSE date_approved END WHERE id=a.id;
 SELECT user_id INTO recipient FROM public.members WHERE id=a.member_id;
 IF recipient IS NOT NULL THEN INSERT INTO public.notifications(user_id,title,message,type,read)
  VALUES(recipient,'Application decision recorded',a.application_id||': Your application was '||CASE WHEN p_decision='approve' THEN 'approved. Please contact the cooperative for release arrangements.' ELSE 'rejected after review. Please contact the cooperative for details.' END,'info',false); END IF;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'application-final-'||p_decision,a.application_id,'success',jsonb_build_object('policyId',c.policy_id,'cycles',chosen_cycles,'mode',p_mode,'reason',p_reason));
END;
$$;

CREATE FUNCTION public.committee_activate_policy(p_policy_id uuid,p_rules jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.approval_workflow_policies%ROWTYPE; fingerprint text; prior jsonb; n integer; ca integer; bn integer; ba integer;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin policy activation is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_rules) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Complete the voting rules.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('coop-approval-policy-draft',0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'policy',p_policy_id,'rules',p_rules)::text,'UTF8')),'hex');
 SELECT details INTO prior FROM public.admin_activity_logs WHERE action_name='workflow-policy-activate' AND target_id=p_request_id::text;
 IF FOUND THEN IF prior->>'fingerprint'=fingerprint THEN RETURN jsonb_build_object('success',true); END IF; RAISE EXCEPTION 'This activation request was already used.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT p FROM public.approval_workflow_policies WHERE id=p_policy_id FOR UPDATE;
 IF p.status<>'draft' OR p.id IS DISTINCT FROM (SELECT id FROM public.approval_workflow_policies ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'Activate the latest saved draft. Refresh policy settings.' USING ERRCODE='40001'; END IF;
 n:=(p.config->>'reviewerCount')::integer;ca:=(p_rules->>'crecomApprovals')::integer;
 bn:=(p_rules->>'bodReviewers')::integer;ba:=(p_rules->>'bodApprovals')::integer;
 IF n IS DISTINCT FROM 3 OR ca IS DISTINCT FROM 3 OR p_rules->>'allResponses' IS DISTINCT FROM 'true'
  OR p_rules->>'finalMode' IS DISTINCT FROM 'super_admin' OR p_rules->>'allowOverride' IS DISTINCT FROM 'false'
  OR length(btrim(coalesce(p_rules->>'ruleReference',''))) NOT BETWEEN 1 AND 500
  OR length(btrim(p.authorization_reference))=0 THEN RAISE EXCEPTION 'Complete the approved voting, final-authority and authorization references.'; END IF;
 IF p.config->>'bodMode'<>'none' AND (bn IS NULL OR bn NOT BETWEEN 1 AND 100 OR ba IS NULL OR ba NOT BETWEEN 1 AND bn OR coalesce(p_rules->>'bodAuthority','pending') NOT IN ('recommendation','binding_decision')) THEN RAISE EXCEPTION 'Complete BOD reviewer counts, approval threshold and authority.'; END IF;
 UPDATE public.approval_workflow_policies SET status='approved',effective_at=now(),approved_at=clock_timestamp(),approved_by=auth.uid() WHERE id=p.id;
 INSERT INTO public.committee_policy_rules(policy_id,crecom_approvals,bod_reviewers,bod_approvals,final_mode,allow_override,bod_authority,all_responses,rule_reference,activated_by)
 VALUES(p.id,ca,CASE WHEN p.config->>'bodMode'='none' THEN NULL ELSE bn END,CASE WHEN p.config->>'bodMode'='none' THEN NULL ELSE ba END,
 p_rules->>'finalMode',(p_rules->>'allowOverride')::boolean,CASE WHEN p.config->>'bodMode'='none' THEN 'pending' ELSE p_rules->>'bodAuthority' END,true,btrim(p_rules->>'ruleReference'),auth.uid());
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'workflow-policy-activate',p_request_id::text,'success',jsonb_build_object('policyId',p.id,'version',p.version,'rules',p_rules,'fingerprint',fingerprint));
 RETURN jsonb_build_object('success',true,'policyId',p.id);
END;
$$;
CREATE FUNCTION public.committee_mutate_review(p_application_id text,p_action text,p_revision integer,p_state_hash text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; c public.application_review_cycles%ROWTYPE;
 parent public.application_review_cycles%ROWTYPE; assignment public.review_assignments%ROWTYPE; membership public.staff_memberships%ROWTYPE;
 p public.approval_workflow_policies%ROWTYPE; rules public.committee_policy_rules%ROWTYPE; prior public.committee_review_events%ROWTYPE;
 current_state jsonb; fingerprint text; result jsonb; packet jsonb; persons jsonb; target_count integer; approvals_needed integer; cycle_number integer;
 candidate uuid; new_assignment uuid; notification uuid; stage_name text; recipient uuid; reason text:=btrim(coalesce(p_payload->>'reason',''));
 bod_needed boolean; route_reason text; responded integer; approvals integer; outcome_value text; existing_cycle uuid; event_cycle uuid; event_assignment uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('forward','forward_bod','approve','reject','clarify','recuse','reply','reassign','reopen','finalize')
  OR p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Choose a valid committee review action.'; END IF;
 IF p_action IN ('approve','reject','clarify','recuse') THEN
  IF NOT public.committee_identity() OR NOT coalesce((public.portal_session_access()->>'allowed')::boolean,false) THEN RAISE EXCEPTION 'Active committee access is required.' USING ERRCODE='42501'; END IF;
 ELSIF p_action='finalize' THEN
  IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin final authority is required.' USING ERRCODE='42501'; END IF;
 ELSIF NOT public.document_staff_access('applications.forward') THEN RAISE EXCEPTION 'Application forwarding permission is required.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('committee-review-request:'||p_request_id::text,0));
 SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'app',a.id,'action',p_action,'revision',p_revision,'stateHash',p_state_hash,'payload',p_payload)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.committee_review_events WHERE request_id=p_request_id;
 IF FOUND THEN IF prior.request_hash=fingerprint AND prior.actor_id=auth.uid() THEN RETURN prior.result; END IF; RAISE EXCEPTION 'This request reference was already used.' USING ERRCODE='40001'; END IF;
 IF a.status NOT IN ('pending','under review') OR EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=a.id) THEN RAISE EXCEPTION 'A final decision has already been recorded for this application.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT w FROM public.application_verifications WHERE application_id=a.id FOR UPDATE;
 IF w.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'The review changed. Refresh before continuing.' USING ERRCODE='40001'; END IF;
 PERFORM d.id FROM public.loan_documents d WHERE d.loan_application_id=a.id ORDER BY d.id FOR UPDATE;
 current_state:=public.private_application_verification_state(a.id);
 IF p_state_hash IS DISTINCT FROM current_state->>'stateHash' THEN RAISE EXCEPTION 'Application requirements changed. Refresh before continuing.' USING ERRCODE='40001'; END IF;
 IF p_action IN ('forward','forward_bod') THEN
  IF w.stage<>'ready_for_committee' OR w.verified_state_hash IS DISTINCT FROM current_state->>'stateHash' OR jsonb_array_length(current_state->'blockers')>0 THEN RAISE EXCEPTION 'Complete current application verification and consent requirements before forwarding.'; END IF;
  SELECT * INTO STRICT p FROM public.approval_workflow_policies WHERE id=w.policy_id AND status='approved';
  SELECT * INTO rules FROM public.committee_policy_rules WHERE policy_id=p.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Activate explicit committee voting and final-authority rules before forwarding.'; END IF;
  SELECT id INTO existing_cycle FROM public.application_review_cycles WHERE application_id=a.id AND status<>'superseded' AND stage=CASE WHEN p_action='forward' THEN 'CRECOM' ELSE 'BOD' END ORDER BY cycle_no DESC LIMIT 1;
  IF existing_cycle IS NOT NULL THEN RAISE EXCEPTION 'This review stage is already assigned. Refresh or return it to verification.' USING ERRCODE='40001'; END IF;
  IF p_action='forward' THEN
   stage_name:='CRECOM';target_count:=(p.config->>'reviewerCount')::integer;approvals_needed:=rules.crecom_approvals;
   IF jsonb_typeof(p_payload->'bodRequired') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Record whether BOD review is required.'; END IF;
   bod_needed:=(p_payload->>'bodRequired')::boolean;route_reason:=btrim(coalesce(p_payload->>'routingReason',''));
   IF (p.config->>'bodMode'='none' AND bod_needed) OR (p.config->>'bodMode'='required' AND NOT bod_needed) THEN RAISE EXCEPTION 'BOD routing must follow the approved policy.'; END IF;
   IF p.config->>'bodMode'='conditional' AND length(route_reason) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Record why BOD review is or is not required under the approved criteria.'; END IF;
   SELECT coalesce(max(cycle_no),0)+1 INTO cycle_number FROM public.application_review_cycles WHERE application_id=a.id;
   SELECT jsonb_build_object('applicationId',a.application_id,'applicant',coalesce(nullif(btrim(concat_ws(' ',m.first_name,m.last_name)),''),a.member_name),
    'memberNumber',m.member_id,'loanType',a.loan_type,'amount',a.amount,'tenureMonths',a.tenure_months,'monthlyPayment',a.monthly_payment,'income',to_jsonb(a)->'income','purpose',a.purpose)
    INTO persons FROM public.members m WHERE m.id=a.member_id;
   packet:=jsonb_build_object('summary',persons,'staffFindings',w.notes,'stateHash',current_state->>'stateHash','packetHash',current_state->>'packetHash',
    'consentSummary',format('Borrower consent: %s; co-maker consent: %s; witness attestations: %s.',current_state->'evidence'->>'borrower',current_state->'evidence'->>'coMaker',current_state->'evidence'->>'witnesses'),
    'documents',(SELECT coalesce(jsonb_agg(jsonb_build_object('documentId',x->>'id','versionId',x->>'versionId','kind',x->>'kind','name',x->>'name','storagePath',x->>'storagePath','contentType',x->>'contentType')),'[]') FROM jsonb_array_elements(current_state->'documents')x));
  ELSE
   stage_name:='BOD';target_count:=rules.bod_reviewers;approvals_needed:=rules.bod_approvals;
   SELECT * INTO parent FROM public.application_review_cycles WHERE application_id=a.id AND stage='CRECOM' AND status='completed' AND bod_required ORDER BY cycle_no DESC LIMIT 1;
   IF parent.id IS NULL OR NOT public.committee_packet_is_current(parent.id) OR NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'Complete the current CRECOM stage before required BOD review.'; END IF;
   bod_needed:=true;route_reason:=parent.routing_reason;cycle_number:=parent.cycle_no;packet:=parent.packet_snapshot;
  END IF;
  IF target_count IS NULL OR approvals_needed IS NULL OR jsonb_typeof(p_payload->'reviewers') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_payload->'reviewers')<>target_count
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_payload->'reviewers'))<>target_count
   OR (p_payload->>'dueAt' IS NOT NULL AND (p_payload->>'dueAt')::timestamptz<=now()) THEN RAISE EXCEPTION 'Choose the exact number of distinct eligible reviewers and a future deadline.'; END IF;
  FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers') LOOP
   IF NOT public.committee_reviewer_available(candidate,a.id,stage_name) THEN RAISE EXCEPTION 'A selected reviewer is inactive, not set up, conflicted or no longer eligible.' USING ERRCODE='40001'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT auth_user_id) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')))<>target_count THEN RAISE EXCEPTION 'Each reviewer must be a different person.'; END IF;
  INSERT INTO public.application_review_cycles(application_id,cycle_no,stage,packet_version,packet_snapshot,policy_id,created_by,required_approvals,reviewer_target,bod_required,routing_reason)
   VALUES(a.id,cycle_number,stage_name,CASE WHEN p_action='forward_bod' THEN parent.packet_version ELSE w.revision END,packet,p.id,auth.uid(),approvals_needed,target_count,bod_needed,route_reason) RETURNING * INTO c;
  event_cycle:=c.id;
  FOR membership IN SELECT * FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) LOOP
   INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,due_at) VALUES(c.id,membership.auth_user_id,membership.id,(p_payload->>'dueAt')::timestamptz) RETURNING id INTO new_assignment;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(membership.auth_user_id,'Application assigned for review',a.application_id||': A '||stage_name||' review packet is ready in My Assigned Applications.','info',false) RETURNING id INTO notification;
   INSERT INTO public.committee_notification_links VALUES(notification,new_assignment);
  END LOOP;
 ELSIF p_action='reopen' THEN
  IF length(reason) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter the reason for returning to verification.'; END IF;
  UPDATE public.application_review_cycles SET status='superseded',closed_at=clock_timestamp() WHERE application_id=a.id AND status<>'superseded';
  UPDATE public.review_assignments SET state='cancelled',revision=revision+1 WHERE review_cycle_id IN (SELECT id FROM public.application_review_cycles WHERE application_id=a.id) AND state IN ('assigned','awaiting_clarification','recused');
  UPDATE public.application_verifications SET stage='needs_verification',policy_id=null,verified_state_hash=null,verified_snapshot=null,verified_at=null,verified_by=null WHERE application_id=a.id;
 ELSIF p_action='finalize' THEN
  PERFORM public.committee_record_final(a.id,p_payload->>'decision','super_admin',reason);
 ELSE
  SELECT * INTO STRICT assignment FROM public.review_assignments WHERE id=(p_payload->>'assignmentId')::uuid FOR UPDATE;
  SELECT * INTO STRICT c FROM public.application_review_cycles WHERE id=assignment.review_cycle_id AND application_id=a.id FOR UPDATE;
  event_cycle:=c.id;event_assignment:=assignment.id;
  IF c.status<>'open' OR assignment.state IN ('cancelled','reassigned','decision_recorded') THEN RAISE EXCEPTION 'This assignment is already closed or decided.' USING ERRCODE='40001'; END IF;
  IF p_action IN ('approve','reject','clarify','recuse') AND NOT public.committee_assignment_eligible(assignment.id) THEN RAISE EXCEPTION 'This case is not assigned to your active membership.' USING ERRCODE='42501'; END IF;
  IF p_action<>'approve' AND length(reason) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a reason or clarification.'; END IF;
  IF p_action NOT IN ('recuse','reassign') AND NOT public.committee_packet_is_current(c.id) THEN RAISE EXCEPTION 'The packet changed or evidence expired. Staff must return it to verification before new decisions.' USING ERRCODE='40001'; END IF;
  IF p_action IN ('approve','reject') THEN
   IF assignment.state<>'assigned' THEN RAISE EXCEPTION 'Wait for staff to resolve the clarification, or for reassignment.'; END IF;
   IF p_payload->>'confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirm your decision for this exact application packet.'; END IF;
   INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,packet_version,decision,reason,reviewer_name,confirmation_text,confirmation_method)
   VALUES(assignment.id,auth.uid(),c.packet_version,p_action,nullif(reason,''),public.document_actor_label(),
    format('I record %s for %s, packet version %s.',p_action,a.application_id,c.packet_version),'account_password');
   UPDATE public.review_assignments SET state='decision_recorded',revision=revision+1 WHERE id=assignment.id;
  ELSIF p_action IN ('clarify','recuse') THEN
   IF assignment.state NOT IN ('assigned','awaiting_clarification') THEN RAISE EXCEPTION 'This assignment cannot be changed.'; END IF;
   UPDATE public.review_assignments SET state=CASE WHEN p_action='clarify' THEN 'awaiting_clarification' ELSE 'recused' END,revision=revision+1 WHERE id=assignment.id;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(c.created_by,'Committee review needs attention',a.application_id||': A reviewer requested '||CASE WHEN p_action='clarify' THEN 'clarification.' ELSE 'reassignment following recusal.' END,'warning',false);
  ELSIF p_action='reply' THEN
   IF assignment.state<>'awaiting_clarification' THEN RAISE EXCEPTION 'This reviewer is not waiting for clarification.'; END IF;
   UPDATE public.review_assignments SET state='assigned',revision=revision+1 WHERE id=assignment.id;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(assignment.reviewer_auth_id,'Review clarification answered',a.application_id||': Staff posted a clarification. Open your assigned case.','info',false) RETURNING id INTO notification;
   INSERT INTO public.committee_notification_links VALUES(notification,assignment.id);
  ELSIF p_action='reassign' THEN
   candidate:=(p_payload->>'membershipId')::uuid;
   IF NOT public.committee_reviewer_available(candidate,a.id,c.stage) OR EXISTS(SELECT 1 FROM public.review_assignments x JOIN public.staff_memberships m ON m.id=candidate WHERE x.review_cycle_id=c.id AND x.reviewer_auth_id=m.auth_user_id) THEN RAISE EXCEPTION 'Choose a different eligible reviewer who has not reviewed this cycle.'; END IF;
   UPDATE public.review_assignments SET state='reassigned',revision=revision+1 WHERE id=assignment.id;
   SELECT * INTO STRICT membership FROM public.staff_memberships WHERE id=candidate;
   INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,due_at) VALUES(c.id,membership.auth_user_id,membership.id,assignment.due_at) RETURNING id INTO new_assignment;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(membership.auth_user_id,'Application reassigned for review',a.application_id||': A review packet is ready in My Assigned Applications.','info',false) RETURNING id INTO notification;
   INSERT INTO public.committee_notification_links VALUES(notification,new_assignment);
  END IF;
  SELECT count(*) FILTER(WHERE x.state='decision_recorded'),count(*) FILTER(WHERE d.decision='approve') INTO responded,approvals
   FROM public.review_assignments x LEFT JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=c.id AND x.state NOT IN ('cancelled','reassigned');
  IF responded=c.reviewer_target THEN
   outcome_value:=CASE WHEN approvals>=c.required_approvals THEN 'approve' ELSE 'reject' END;
   UPDATE public.application_review_cycles SET status='completed',outcome=outcome_value,closed_at=clock_timestamp() WHERE id=c.id;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(c.created_by,'Committee review completed',a.application_id||': All '||c.reviewer_target||' '||c.stage||' reviewers responded. Panel outcome: '||outcome_value||'.','info',false);
  END IF;
 END IF;
 UPDATE public.application_verifications SET revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE application_id=a.id;
 result:=jsonb_build_object('success',true,'stage',public.committee_application_stage(a.id),'cycleId',event_cycle);
 INSERT INTO public.committee_review_events(request_id,request_hash,application_id,cycle_id,assignment_id,actor_id,actor_name,action,reason,result)
 VALUES(p_request_id,fingerprint,a.id,event_cycle,event_assignment,auth.uid(),public.document_actor_label(),p_action,reason,result);
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'committee-review-'||p_action,a.application_id,'success',jsonb_build_object('requestId',p_request_id,'cycleId',event_cycle,'assignmentId',event_assignment,'payload',p_payload));
 RETURN result;
END;
$$;

CREATE FUNCTION public.committee_rules_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('crecomApprovals',crecom_approvals,'bodReviewers',bod_reviewers,'bodApprovals',bod_approvals,
  'finalMode',final_mode,'allowOverride',allow_override,'bodAuthority',bod_authority,'allResponses',all_responses,'ruleReference',rule_reference)
 FROM public.committee_policy_rules WHERE policy_id=p_id;
$$;
CREATE FUNCTION public.committee_review_state(p_application_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; state jsonb; cycles jsonb; events jsonb; candidates jsonb; final jsonb; stage_value text;
BEGIN
 IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id;
 SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id;
 state:=public.private_application_verification_state(a.id);stage_value:=public.committee_application_stage(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'stage',c.stage,'cycle',c.cycle_no,'packetVersion',c.packet_version,'status',c.status,'outcome',c.outcome,
  'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,'bodRequired',c.bod_required,'routingReason',c.routing_reason,'createdAt',c.created_at,
  'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'membershipId',x.membership_id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'state',x.state,'revision',x.revision,'decision',d.decision,'reason',d.reason,'decidedAt',d.created_at) ORDER BY x.assigned_at),'[]')
   FROM public.review_assignments x JOIN auth.users u ON u.id=x.reviewer_auth_id LEFT JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=c.id))
  ORDER BY c.cycle_no DESC,c.created_at DESC),'[]') INTO cycles FROM public.application_review_cycles c WHERE c.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',e.actor_name,'reason',e.reason,'createdAt',e.created_at,'assignmentId',e.assignment_id) ORDER BY e.created_at DESC),'[]')
 INTO events FROM public.committee_review_events e WHERE e.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'role',m.role,'title',m.title) ORDER BY u.email),'[]')
 INTO candidates FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE public.committee_reviewer_available(m.id,a.id,CASE WHEN m.role='crecom_member' THEN 'CRECOM' ELSE 'BOD' END);
 SELECT jsonb_build_object('decision',decision,'mode',mode,'reason',reason,'createdAt',created_at,'actor',actor_name) INTO final FROM public.application_final_decisions WHERE application_id=a.id;
 RETURN jsonb_build_object('applicationId',a.application_id,'revision',coalesce(w.revision,0),'stateHash',state->>'stateHash','verificationStage',coalesce(stage_value,w.stage,'not_started'),
  'verified',coalesce(w.stage='ready_for_committee' AND w.verified_state_hash=state->>'stateHash' AND jsonb_array_length(state->'blockers')=0,false),
  'blockers',state->'blockers','policyId',state->'policy'->>'id','policyName',state->'policy'->>'name','policyConfig',state->'policy'->'config',
  'rules',public.committee_rules_json((state->'policy'->>'id')::uuid),'candidates',candidates,'cycles',cycles,'events',events,'finalDecision',final,
  'canManage',public.document_staff_access('applications.forward'),
  'canFinalize',public.document_staff_access() AND (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())='super_admin'
   AND stage_value='ready_for_final' AND public.committee_rules_json(w.policy_id)->>'finalMode'='super_admin');
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_review_packet(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; a public.review_assignments%ROWTYPE; state jsonb; assignment jsonb; own_decision jsonb; thread jsonb; app_revision integer;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned case.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.review_assignments WHERE id=p_assignment_id;
 SELECT * INTO STRICT c FROM public.application_review_cycles WHERE id=a.review_cycle_id;
 state:=public.private_application_verification_state(c.application_id);
 SELECT revision INTO app_revision FROM public.application_verifications WHERE application_id=c.application_id;
 SELECT x INTO assignment FROM jsonb_array_elements(public.committee_workspace()->'assignments')x WHERE x->>'id'=p_assignment_id::text;
 SELECT jsonb_build_object('id',id,'decision',decision,'reason',reason,'createdAt',created_at,'reviewer',reviewer_name,'confirmation',confirmation_text,'method',confirmation_method) INTO own_decision FROM public.individual_review_decisions WHERE assignment_id=a.id AND reviewer_auth_id=auth.uid();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'actor',actor_name,'reason',reason,'createdAt',created_at,'assignmentId',assignment_id) ORDER BY created_at),'[]') INTO thread
 FROM public.committee_review_events WHERE assignment_id=a.id AND action IN ('clarify','reply','recuse');
 RETURN jsonb_build_object('assignment',assignment,'summary',c.packet_snapshot->'summary','findings',coalesce(c.packet_snapshot->>'staffFindings',''),
  'consentSummary',coalesce(c.packet_snapshot->>'consentSummary',''),'documents',(SELECT coalesce(jsonb_agg(x-'storagePath'-'contentType'),'[]') FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x),
  'appRevision',app_revision,'stateHash',state->>'stateHash','stale',c.status='open' AND NOT public.committee_packet_is_current(c.id),'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,
  'canRespond',c.status='open' AND a.state='assigned' AND public.committee_packet_is_current(c.id) AND NOT EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=c.application_id),
  'myDecision',own_decision,'thread',thread,'cycleStatus',c.status,'outcome',c.outcome);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_document_location(p_assignment_id uuid,p_document_id uuid,p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; item jsonb;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned document.' USING ERRCODE='42501'; END IF;
 SELECT c1.* INTO STRICT c FROM public.review_assignments a JOIN public.application_review_cycles c1 ON c1.id=a.review_cycle_id WHERE a.id=p_assignment_id;
 SELECT x INTO item FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x
 WHERE x->>'documentId'=p_document_id::text AND (x->>'versionId')::uuid IS NOT DISTINCT FROM p_version_id;
 IF item IS NULL OR nullif(item->>'storagePath','') IS NULL OR NOT EXISTS(SELECT 1 FROM public.loan_documents WHERE id=p_document_id AND loan_application_id=c.application_id) THEN RAISE EXCEPTION 'This file version is not part of your assigned packet.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('path',item->>'storagePath','name',item->>'name','contentType',item->>'contentType');
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_can_read_loan_object(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x
 JOIN public.loan_documents d ON d.id=(x->>'documentId')::uuid AND d.loan_application_id=c.application_id
 WHERE public.committee_assignment_eligible(a.id) AND x->>'storagePath'=p_name);
$$;

CREATE FUNCTION public.committee_review_action(p_actor_id uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true); result jsonb;
BEGIN
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id) THEN RAISE EXCEPTION 'A verified account is required.' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF p_operation='activate_policy' THEN result:=public.committee_activate_policy((p_args->>'policyId')::uuid,p_args->'rules',(p_args->>'requestId')::uuid);
 ELSE result:=public.committee_mutate_review(p_args->>'applicationId',p_operation,(p_args->>'revision')::integer,p_args->>'stateHash',p_args->'payload',(p_args->>'requestId')::uuid);
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RAISE;
END;
$$;
CREATE FUNCTION public.committee_transition_allowed(p_application uuid,p_old text,p_new text,p_caller name)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.application_final_decisions%ROWTYPE;
BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.document_staff_access()
  AND NOT EXISTS(SELECT 1 FROM public.loan_applications a JOIN public.members m ON m.id=a.member_id WHERE a.id=p_application AND m.user_id=auth.uid()) THEN RETURN false; END IF;
 IF p_new IS NOT DISTINCT FROM p_old OR NOT EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application) THEN RETURN true; END IF;
 -- Final changes and servicing transitions must come through trusted procedures,
 -- never a direct authenticated table update that bypasses their checks.
 IF p_caller NOT IN ('postgres','supabase_admin','service_role') THEN RETURN false; END IF;
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 IF d.application_id IS NOT NULL AND (
  (p_new=CASE WHEN d.decision='approve' THEN 'approved' ELSE 'rejected' END AND p_old IN ('pending','under review'))
  OR (d.decision='approve' AND ((p_old='approved' AND p_new='released') OR (p_old IN ('released','overdue') AND p_new IN ('overdue','completed'))))
 ) THEN RETURN true; END IF;
 RETURN false;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_enrolled_application_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF public.committee_transition_allowed(OLD.id,OLD.status,NEW.status,current_user) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'This enrolled application requires the authorized committee, final-decision and servicing procedures.' USING ERRCODE='42501';
END;
$$;
CREATE FUNCTION public.committee_final_terms_locked(p_application uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.application_final_decisions f JOIN public.loan_applications a ON a.id=f.application_id
 JOIN public.members m ON m.id=a.member_id WHERE f.application_id=p_application AND (public.document_staff_access() OR m.user_id=auth.uid()));
$$;
CREATE FUNCTION public.committee_guard_final_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role')
 AND (NEW.amount,NEW.member_id,NEW.loan_type,NEW.purpose,NEW.tenure_months,NEW.monthly_payment)
 IS DISTINCT FROM (OLD.amount,OLD.member_id,OLD.loan_type,OLD.purpose,OLD.tenure_months,OLD.monthly_payment)
 AND public.committee_final_terms_locked(OLD.id) THEN RAISE EXCEPTION 'Final approved or rejected packet terms cannot be edited directly.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER committee_guard_final_terms BEFORE UPDATE OF amount,member_id,loan_type,purpose,tenure_months,monthly_payment ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.committee_guard_final_terms();
CREATE FUNCTION public.committee_guard_verification_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.stage,NEW.checks,NEW.notes,NEW.policy_id,NEW.verified_state_hash) IS DISTINCT FROM (OLD.stage,OLD.checks,OLD.notes,OLD.policy_id,OLD.verified_state_hash)
 AND EXISTS(SELECT 1 FROM public.application_review_cycles WHERE application_id=OLD.application_id AND status<>'superseded')
 THEN RAISE EXCEPTION 'Return this case to verification before editing its checks or requirements.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER committee_guard_verification_edit BEFORE UPDATE ON public.application_verifications FOR EACH ROW EXECUTE FUNCTION public.committee_guard_verification_edit();
CREATE FUNCTION public.committee_guard_approved_policy()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.status='approved' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved workflow policies are immutable. Create a new draft version.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER committee_guard_approved_policy BEFORE UPDATE OR DELETE ON public.approval_workflow_policies FOR EACH ROW EXECUTE FUNCTION public.committee_guard_approved_policy();
-- Updated read models and consent binding.
CREATE OR REPLACE FUNCTION public.private_application_verification_state(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; m public.members%ROWTYPE; financial jsonb; documents jsonb; manifest jsonb; current_packet_hash text;
  policy public.approval_workflow_policies%ROWTYPE; w public.application_verifications%ROWTYPE; evidence jsonb; blockers jsonb:='[]'; required_kinds text[]:=ARRAY['validId','payslip'];
  member_active boolean; document jsonb; kind text; borrower_count integer:=0; co_maker_count integer:=0; witness_count integer:=0; checks jsonb;
BEGIN
  SELECT * INTO STRICT a FROM public.loan_applications WHERE id=p_id;
  SELECT * INTO m FROM public.members WHERE id=a.member_id;
  SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id;
  IF w.policy_id IS NOT NULL THEN SELECT * INTO policy FROM public.approval_workflow_policies WHERE id=w.policy_id;
  ELSE SELECT * INTO policy FROM public.approval_workflow_policies WHERE status='approved' AND effective_at<=now() ORDER BY version DESC LIMIT 1; END IF;
  SELECT to_jsonb(s)-'updated_by'-'updated_at' INTO financial FROM public.loan_policy_settings s WHERE singleton=true;
  IF financial IS NULL OR financial->>'collateral_required_above' IS NULL THEN blockers:=blockers||jsonb_build_array('Current loan document requirements are unavailable.');
  ELSIF a.amount>(financial->>'collateral_required_above')::numeric THEN required_kinds:=array_append(required_kinds,'collateral'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'versionId',v.id,'version',coalesce(v.version,1),
      'name',coalesce(v.original_name,d.original_name),'storagePath',coalesce(v.storage_path,d.storage_path),
      'size',coalesce(v.size_bytes,d.size_bytes),'contentType',coalesce(v.content_type,d.content_type),
      'reviewStatus',coalesce(r.status,'to_review'),'reviewId',r.id) ORDER BY d.kind,d.id),'[]') INTO documents
    FROM public.loan_documents d
    LEFT JOIN LATERAL(SELECT * FROM public.loan_document_versions v WHERE v.document_id=d.id ORDER BY version DESC LIMIT 1)v ON true
    LEFT JOIN LATERAL(SELECT * FROM public.loan_document_reviews r WHERE r.document_id=d.id AND r.version_id IS NOT DISTINCT FROM v.id ORDER BY created_at DESC,id DESC LIMIT 1)r ON true
    WHERE d.loan_application_id=a.id;
  SELECT coalesce(jsonb_agg(value-'reviewStatus'-'reviewId' ORDER BY value->>'kind',value->>'id'),'[]') INTO manifest FROM jsonb_array_elements(documents);
  current_packet_hash:=encode(sha256(convert_to(jsonb_build_object(
    'application',jsonb_build_object('id',a.id,'memberId',a.member_id,'loanType',a.loan_type,'amount',a.amount,'purpose',a.purpose,'tenure',a.tenure_months,'monthlyPayment',a.monthly_payment),
    'member',jsonb_build_object('id',m.id,'userId',m.user_id,'memberNumber',m.member_id,'name',concat_ws(' ',m.first_name,m.last_name),'membershipType',m.membership_type),
    'coMakerMemberId',to_jsonb(a)->>'co_maker_member_id','financialPolicy',financial,'documents',manifest)::text,'UTF8')),'hex');
  SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=m.user_id AND u.raw_app_meta_data->>'role'='member'
    AND coalesce(u.raw_app_meta_data->>'account_status','active')='active' AND (u.banned_until IS NULL OR u.banned_until<=now())
    AND m.status='active' AND m.must_change_password=false) INTO member_active;
  IF NOT member_active THEN blockers:=blockers||jsonb_build_array('The member must have an active, linked account with password setup completed.'); END IF;
  FOREACH kind IN ARRAY required_kinds LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'kind'=kind) THEN blockers:=blockers||jsonb_build_array('Required file is missing: '||kind); END IF;
  END LOOP;
  FOR document IN SELECT value FROM jsonb_array_elements(documents) LOOP
    IF document->>'reviewStatus'<>'verified' THEN blockers:=blockers||jsonb_build_array('The latest file must be verified: '||(document->>'kind')); END IF;
  END LOOP;
  checks:=coalesce(w.checks,'{"identity":false,"eligibility":false,"terms":false}');
  IF checks->>'identity' IS DISTINCT FROM 'true' THEN blockers:=blockers||jsonb_build_array('Complete the identity and application details check.'); END IF;
  IF checks->>'eligibility' IS DISTINCT FROM 'true' THEN blockers:=blockers||jsonb_build_array('Complete the membership eligibility and affordability check.'); END IF;
  IF checks->>'terms' IS DISTINCT FROM 'true' THEN blockers:=blockers||jsonb_build_array('Complete the loan terms and payment projection check.'); END IF;
  IF policy.id IS NULL OR policy.status<>'approved' THEN blockers:=blockers||jsonb_build_array('CSUCC-approved verification and consent requirements have not been configured.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'subject',e.subject_reference,'method',e.method,'occurredAt',e.occurred_at,'reference',e.evidence_reference) ORDER BY e.id),'[]') INTO evidence
    FROM public.application_consent_evidence e WHERE e.application_id=a.id AND e.packet_hash=current_packet_hash AND e.invalidated_at IS NULL
    AND e.occurred_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now())
    AND coalesce(policy.config->'allowedConsentMethods','[]') ? e.method
    AND (e.kind<>'borrower' OR e.subject_user_id=m.user_id)
    AND (e.kind<>'co_maker' OR (e.subject_user_id IS DISTINCT FROM m.user_id AND e.subject_reference<>m.member_id AND EXISTS(SELECT 1 FROM public.members cm WHERE cm.id::text=to_jsonb(a)->>'co_maker_member_id' AND ((cm.user_id IS NOT NULL AND cm.user_id=e.subject_user_id) OR (e.method='paper' AND cm.user_id IS NULL AND e.subject_user_id IS NULL AND e.subject_reference IN (cm.member_id,cm.id::text))))));
  SELECT count(*) FILTER(WHERE value->>'kind'='borrower'),count(DISTINCT value->>'subject') FILTER(WHERE value->>'kind'='co_maker'),
    count(DISTINCT value->>'subject') FILTER(WHERE value->>'kind'='witness')
    INTO borrower_count,co_maker_count,witness_count FROM jsonb_array_elements(evidence);
  IF policy.id IS NOT NULL AND policy.status='approved' THEN
    IF jsonb_typeof(policy.config->'borrowerConsentRequired') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(policy.config->'coMakerConsentRequired') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(policy.config->'witnessCount') IS DISTINCT FROM 'number'
      OR jsonb_array_length(coalesce(policy.config->'allowedConsentMethods','[]'))=0
      THEN blockers:=blockers||jsonb_build_array('Approved consent and witness requirements are incomplete.');
    ELSE
      IF (policy.config->>'borrowerConsentRequired')::boolean AND borrower_count<1 THEN blockers:=blockers||jsonb_build_array('Current borrower consent evidence has not been recorded.'); END IF;
      IF (policy.config->>'coMakerConsentRequired')::boolean AND co_maker_count<>1 THEN blockers:=blockers||jsonb_build_array('Exactly one current co-maker consent record is required.'); END IF;
      IF witness_count<(policy.config->>'witnessCount')::integer THEN blockers:=blockers||jsonb_build_array('Required witness attestations have not been recorded for this packet.'); END IF;
    END IF;
  ELSE
    IF borrower_count=0 THEN blockers:=blockers||jsonb_build_array('Borrower consent evidence is not available.'); END IF;
    IF co_maker_count=0 THEN blockers:=blockers||jsonb_build_array('Co-maker consent evidence is not available.'); END IF;
    blockers:=blockers||jsonb_build_array('Witness requirements are pending CSUCC configuration.');
  END IF;
  RETURN jsonb_build_object('packetHash',current_packet_hash,'documents',documents,'requiredKinds',required_kinds,'blockers',blockers,
    'policy',CASE WHEN policy.id IS NULL THEN NULL ELSE jsonb_build_object('id',policy.id,'version',policy.version,'name',policy.name,'status',policy.status,
      'config',policy.config,'authorizationReference',policy.authorization_reference,'createdAt',policy.created_at,'createdBy',policy.created_by_name) END,
    'evidence',jsonb_build_object('borrower',borrower_count,'coMaker',co_maker_count,'witnesses',witness_count),
    'stateHash',encode(sha256(convert_to(jsonb_build_object('packet',current_packet_hash,'reviews',documents,'evidence',evidence,'policyId',policy.id,'policyStatus',policy.status,'memberActive',member_active)::text,'UTF8')),'hex'));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_application_verification(p_application_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; m public.members%ROWTYPE; state jsonb; history jsonb; returned jsonb; stale boolean:=false; review_stage text;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id;
  SELECT * INTO m FROM public.members WHERE id=a.member_id;
  SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id;
  state:=public.private_application_verification_state(a.id);
  review_stage:=public.committee_application_stage(a.id);
  stale:=w.stage='ready_for_committee' AND (w.verified_state_hash IS DISTINCT FROM state->>'stateHash' OR jsonb_array_length(state->'blockers')>0);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',e.actor_name,'createdAt',e.created_at,'details',e.details) ORDER BY e.created_at DESC,e.id DESC),'[]') INTO history FROM public.application_workflow_events e WHERE e.application_id=a.id;
  SELECT jsonb_build_object('reason',e.details->>'reason','category',e.details->>'category','createdAt',e.created_at) INTO returned
    FROM public.application_workflow_events e WHERE e.application_id=a.id AND e.action='return' ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
  RETURN (state-'documents')||jsonb_build_object(
    'documents',(SELECT coalesce(jsonb_agg(value-'storagePath'-'size'-'contentType'),'[]') FROM jsonb_array_elements(state->'documents')),
    'applicationId',a.application_id,'applicationUuid',a.id,'memberName',coalesce(nullif(btrim(concat_ws(' ',m.first_name,m.last_name)),''),a.member_name),
    'memberNumber',coalesce(m.member_id,'Not recorded'),'loanType',a.loan_type,'loanStatus',a.status,
    'stage',coalesce(review_stage,CASE WHEN w.application_id IS NULL THEN 'not_started' WHEN stale THEN 'needs_verification' ELSE w.stage END),
    'enrolled',w.application_id IS NOT NULL,'revision',coalesce(w.revision,0),'stale',coalesce(stale,false),
    'checks',coalesce(w.checks,'{"identity":false,"eligibility":false,"terms":false}'),'notes',coalesce(w.notes,''),
    'history',history,'lastReturned',returned,'canEnroll',a.status IN ('pending','under review') AND NOT EXISTS(SELECT 1 FROM public.application_review_cycles WHERE application_id=a.id AND status<>'superseded'),
    'permissions',jsonb_build_object('verify',public.document_staff_access('applications.verify'),'return',public.document_staff_access('applications.return'),'policyManage',public.document_staff_access('workflow.policy.manage')));
END;
$$;

CREATE OR REPLACE FUNCTION public.application_workflow_summaries()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',a.application_id,'enrolled',true,'revision',v.revision,
    'stage',coalesce(public.committee_application_stage(a.id),CASE WHEN v.stage='ready_for_committee' AND (v.verified_state_hash IS DISTINCT FROM s.state->>'stateHash' OR jsonb_array_length(s.state->'blockers')>0) THEN 'needs_verification' ELSE v.stage END),
    'stale',v.stage='ready_for_committee' AND (v.verified_state_hash IS DISTINCT FROM s.state->>'stateHash' OR jsonb_array_length(s.state->'blockers')>0)) ORDER BY a.application_id),'[]') INTO rows
    FROM public.application_verifications v JOIN public.loan_applications a ON a.id=v.application_id
    CROSS JOIN LATERAL(SELECT public.private_application_verification_state(a.id) AS state)s;
  RETURN rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_workspace()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE assignments jsonb; history jsonb; access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() THEN RAISE EXCEPTION 'Active committee membership is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'applicant',c.packet_snapshot->'summary'->>'applicant','memberNumber',c.packet_snapshot->'summary'->>'memberNumber','loanType',c.packet_snapshot->'summary'->>'loanType',
  'amount',(c.packet_snapshot->'summary'->>'amount')::numeric,'stage',c.stage,'cycle',c.cycle_no,'packetVersion',c.packet_version,'assignedAt',a.assigned_at,'dueAt',a.due_at,'state',a.state,
  'responded',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state='decision_recorded'),
  'assigned',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state NOT IN ('cancelled','reassigned'))) ORDER BY a.assigned_at DESC),'[]')
 INTO assignments FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE public.committee_assignment_eligible(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'assignmentId',d.assignment_id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'cycle',c.cycle_no,'packetVersion',d.packet_version,'decision',d.decision,'reason',d.reason,'createdAt',d.created_at,'accessAvailable',public.committee_assignment_eligible(a.id)) ORDER BY d.created_at DESC),'[]')
 INTO history FROM public.individual_review_decisions d JOIN public.review_assignments a ON a.id=d.assignment_id JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 WHERE d.reviewer_auth_id=auth.uid();
 RETURN jsonb_build_object('assignments',assignments,'history',history,'counts',jsonb_build_object('assigned',jsonb_array_length(assignments),
  'pending',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='assigned'),
  'waiting',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='decision_recorded' AND (x->>'responded')::integer<(x->>'assigned')::integer),
  'clarification',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='awaiting_clarification'),'completed',jsonb_array_length(history)));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_approval_workflow_policies()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE policies jsonb;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'status',p.status,'config',p.config,
    'authorizationReference',p.authorization_reference,'createdAt',p.created_at,'createdBy',p.created_by_name,'executionRules',public.committee_rules_json(p.id)) ORDER BY p.version DESC),'[]') INTO policies FROM public.approval_workflow_policies p;
  RETURN jsonb_build_object('policies',policies,'canManage',public.document_staff_access('workflow.policy.manage'));
END;
$$;
REVOKE ALL ON FUNCTION public.committee_reviewer_available(uuid,uuid,text),public.committee_packet_is_current(uuid),public.committee_application_stage(uuid),public.committee_record_final(uuid,text,text,text),public.committee_activate_policy(uuid,jsonb,uuid),public.committee_mutate_review(text,text,integer,text,jsonb,uuid),public.committee_rules_json(uuid),public.committee_review_action(uuid,text,jsonb),public.committee_guard_verification_edit(),public.committee_guard_approved_policy() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.committee_review_action(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.committee_review_state(text),public.committee_transition_allowed(uuid,text,text,name),public.committee_final_terms_locked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.committee_review_state(text),public.committee_transition_allowed(uuid,text,text,name),public.committee_final_terms_locked(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
