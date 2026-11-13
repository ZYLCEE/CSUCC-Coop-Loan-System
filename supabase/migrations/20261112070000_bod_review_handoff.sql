-- Route only saved, current, unanimous CRECOM approvals. Never create a vote.
BEGIN;
CREATE FUNCTION public.committee_crecom_all_approved(p_cycle uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT c.stage='CRECOM' AND c.status='completed' AND c.outcome='approve' AND c.bod_required
  AND c.reviewer_target=3 AND c.required_approvals=3 AND public.committee_packet_is_current(c.id)
  AND public.committee_signatories_complete(c.id) AND count(*)=3 AND count(DISTINCT x.reviewer_auth_id)=3
  AND count(*) FILTER(WHERE x.signatory_role='crecom_member')=2
  AND count(DISTINCT x.member_number) FILTER(WHERE x.signatory_role='crecom_member')=2
  AND count(*) FILTER(WHERE x.signatory_role='crecom_chairperson')=1
  AND bool_and(x.state='decision_recorded' AND d.decision='approve' AND d.packet_version=c.packet_version
   AND d.signatory_role=x.signatory_role AND d.reviewer_auth_id=x.reviewer_auth_id)
 FROM public.application_review_cycles c JOIN public.review_assignments x ON x.review_cycle_id=c.id
 LEFT JOIN public.individual_review_decisions d ON d.assignment_id=x.id
 WHERE c.id=p_cycle AND x.state NOT IN ('cancelled','reassigned') GROUP BY c.id),false);
$$;

CREATE FUNCTION public.committee_route_completed_crecom_to_bod(p_application uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app public.loan_applications%ROWTYPE;parent public.application_review_cycles%ROWTYPE;bod public.application_review_cycles%ROWTYPE;
 member public.staff_memberships%ROWTYPE;rules public.committee_policy_rules%ROWTYPE;choices uuid[];
 source_actor uuid;source_name text;assignment_id uuid;notification_id uuid;request_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO STRICT app FROM public.loan_applications WHERE id=p_application FOR UPDATE;
 IF app.status NOT IN ('pending','under review') OR EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=app.id) THEN RETURN jsonb_build_object('status','closed');END IF;
 SELECT * INTO parent FROM public.application_review_cycles WHERE application_id=app.id AND stage='CRECOM' AND status<>'superseded' ORDER BY cycle_no DESC LIMIT 1 FOR UPDATE;
 IF parent.id IS NULL OR NOT public.committee_crecom_all_approved(parent.id) THEN RETURN jsonb_build_object('status','not_ready');END IF;
 SELECT * INTO bod FROM public.application_review_cycles WHERE application_id=app.id AND stage='BOD' AND status<>'superseded' ORDER BY cycle_no DESC LIMIT 1;
 IF bod.id IS NOT NULL THEN RETURN jsonb_build_object('status','assigned','cycleId',bod.id);END IF;
 SELECT * INTO rules FROM public.committee_policy_rules WHERE policy_id=parent.policy_id;
 IF rules.policy_id IS NULL OR rules.crecom_approvals<>3 OR rules.bod_reviewers IS DISTINCT FROM 1 OR rules.bod_approvals IS DISTINCT FROM 1
  OR rules.signatory_layout IS DISTINCT FROM 'manual_form_v1' OR NOT public.committee_bod_enabled()
  OR NOT EXISTS(SELECT 1 FROM public.approval_workflow_policies WHERE id=parent.policy_id AND status='approved' AND config->>'bodMode'='required') THEN
  RETURN jsonb_build_object('status','policy_required');
 END IF;
 SELECT array_agg(m.id ORDER BY m.id) INTO choices FROM public.staff_memberships m
 WHERE m.role='bod_member' AND m.committee_seat='chairperson' AND public.committee_reviewer_available(m.id,app.id,'BOD')
 AND NOT EXISTS(SELECT 1 FROM public.review_assignments x WHERE x.review_cycle_id=parent.id AND x.reviewer_auth_id=m.auth_user_id AND x.state NOT IN ('cancelled','reassigned'));
 IF coalesce(cardinality(choices),0)=0 THEN RETURN jsonb_build_object('status','needs_reviewer');END IF;
 IF cardinality(choices)<>1 THEN RETURN jsonb_build_object('status','needs_selection','eligibleCount',cardinality(choices));END IF;
 SELECT * INTO STRICT member FROM public.staff_memberships WHERE id=choices[1] FOR SHARE;
 IF NOT public.committee_reviewer_available(member.id,app.id,'BOD') THEN RETURN jsonb_build_object('status','needs_reviewer');END IF;
 SELECT d.reviewer_auth_id,coalesce(nullif(d.reviewer_name,''),nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Committee reviewer') INTO STRICT source_actor,source_name
 FROM public.review_assignments x JOIN public.individual_review_decisions d ON d.assignment_id=x.id
 JOIN auth.users u ON u.id=d.reviewer_auth_id
 WHERE x.review_cycle_id=parent.id AND x.state='decision_recorded' AND d.decision='approve' ORDER BY d.created_at DESC,d.id DESC LIMIT 1;
 INSERT INTO public.application_review_cycles(application_id,cycle_no,stage,packet_version,packet_snapshot,policy_id,created_by,required_approvals,reviewer_target,bod_required,routing_reason)
 VALUES(app.id,parent.cycle_no,'BOD',parent.packet_version,parent.packet_snapshot,parent.policy_id,parent.created_by,1,1,true,'Assigned automatically after all three CRECOM approvals.') RETURNING * INTO bod;
 INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,signatory_role)
 VALUES(bod.id,member.auth_user_id,member.id,'bod_chairperson') RETURNING id INTO assignment_id;
 INSERT INTO public.notifications(user_id,title,message,type,read)
 VALUES(member.auth_user_id,'Loan application ready for BOD review',app.application_id||': All three CRECOM reviewers approved. Review the application, requirements and their recorded approvals.','info',false) RETURNING id INTO notification_id;
 INSERT INTO public.committee_notification_links(notification_id,assignment_id) VALUES(notification_id,assignment_id);
 INSERT INTO public.notifications(user_id,title,message,type,read)
 VALUES(parent.created_by,'Application sent to BOD',app.application_id||': All three CRECOM approvals are complete. The application was automatically assigned to the eligible BOD Chairperson.','info',false);
 UPDATE public.application_verifications SET revision=revision+1,updated_by=source_actor,updated_at=clock_timestamp() WHERE application_id=app.id;
 INSERT INTO public.committee_review_events(request_id,request_hash,application_id,cycle_id,actor_id,actor_name,action,reason,result)
 VALUES(request_id,encode(sha256(convert_to('auto-bod:'||parent.id::text,'UTF8')),'hex'),app.id,bod.id,source_actor,source_name,'forward_bod','Assigned automatically after the third saved CRECOM approval.',jsonb_build_object('success',true,'stage','bod_review','automatic',true,'sourceCycleId',parent.id));
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(source_actor,'committee-review-forward_bod',app.application_id,'success',jsonb_build_object('requestId',request_id,'cycleId',bod.id,'automatic',true,'sourceCycleId',parent.id));
 RETURN jsonb_build_object('status','assigned','cycleId',bod.id);
END;
$$;

-- Read only the approvals from the same submitted review cycle as this BOD case.
CREATE FUNCTION public.committee_bod_crecom_confirmations(p_bod_cycle uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('reviewer',d.reviewer_name,'signatoryRole',d.signatory_role,
  'committeeMemberNumber',coalesce(d.member_number,x.member_number),'decision',d.decision,'createdAt',d.created_at,'reference',d.id)
  ORDER BY CASE WHEN d.signatory_role='crecom_member' THEN coalesce(d.member_number,0) ELSE 3 END)
 FROM public.application_review_cycles b JOIN public.application_review_cycles c ON c.application_id=b.application_id AND c.cycle_no=b.cycle_no AND c.stage='CRECOM'
 JOIN public.review_assignments x ON x.review_cycle_id=c.id JOIN public.individual_review_decisions d ON d.assignment_id=x.id
 WHERE b.id=p_bod_cycle AND b.stage='BOD' AND public.committee_crecom_all_approved(c.id) AND x.state='decision_recorded'),'[]');
$$;

-- Preserve password verification in the API and all existing mutation guards.
CREATE OR REPLACE FUNCTION public.committee_review_action(p_actor_id uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true);output jsonb;app_id uuid;parent_id uuid;routing jsonb;bod_decision boolean;
BEGIN
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id) THEN RAISE EXCEPTION 'A verified account is required.' USING ERRCODE='42501';END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF p_operation='activate_policy' THEN output:=public.committee_activate_policy((p_args->>'policyId')::uuid,p_args->'rules',(p_args->>'requestId')::uuid);
 ELSE
  SELECT id INTO app_id FROM public.loan_applications WHERE application_id=p_args->>'applicationId';
  -- Serialize explicit forwarding and the automatic handoff on the same application.
  PERFORM id FROM public.loan_applications WHERE id=app_id FOR UPDATE;
  SELECT id INTO parent_id FROM public.application_review_cycles WHERE application_id=app_id AND stage='CRECOM' AND status<>'superseded' ORDER BY cycle_no DESC LIMIT 1;
  SELECT EXISTS(SELECT 1 FROM public.review_assignments x JOIN public.application_review_cycles c ON c.id=x.review_cycle_id
   WHERE x.id=(p_args->'payload'->>'assignmentId')::uuid AND x.reviewer_auth_id=auth.uid() AND c.application_id=app_id AND c.stage='BOD') INTO bod_decision;
  IF (p_operation='forward_bod' OR p_operation IN ('approve','reject') AND bod_decision)
   AND NOT EXISTS(SELECT 1 FROM public.committee_review_events WHERE request_id=(p_args->>'requestId')::uuid AND actor_id=auth.uid())
   AND NOT public.committee_crecom_all_approved(parent_id) THEN
   RAISE EXCEPTION 'All three current CRECOM reviewers must approve before BOD review.' USING ERRCODE='40001';
  END IF;
  output:=public.committee_mutate_review(p_args->>'applicationId',p_operation,(p_args->>'revision')::integer,p_args->>'stateHash',p_args->'payload',(p_args->>'requestId')::uuid);
  IF p_operation='approve' THEN
   routing:=public.committee_route_completed_crecom_to_bod(app_id);
   output:=output||jsonb_build_object('stage',public.committee_application_stage(app_id),'bodRouting',routing);
  END IF;
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN output;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RAISE;
END;
$$;

ALTER FUNCTION public.committee_workspace() RENAME TO committee_workspace_before_bod_handoff;
CREATE FUNCTION public.committee_workspace() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;rows jsonb;
BEGIN
 output:=public.committee_workspace_before_bod_handoff();
 SELECT coalesce(jsonb_agg(a.value||CASE WHEN a.value->>'stage'='BOD' THEN jsonb_build_object('crecomConfirmations',public.committee_bod_crecom_confirmations(x.review_cycle_id)) ELSE '{}'::jsonb END ORDER BY a.ordinality),'[]')
 INTO rows FROM jsonb_array_elements(output->'assignments') WITH ORDINALITY a(value,ordinality) JOIN public.review_assignments x ON x.id=(a.value->>'id')::uuid;
 RETURN output||jsonb_build_object('assignments',rows);
END;
$$;
ALTER FUNCTION public.committee_review_packet(uuid) RENAME TO committee_review_packet_before_bod_handoff;
CREATE FUNCTION public.committee_review_packet(p_assignment_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;confirmations jsonb;cycle_id uuid;
BEGIN
 -- The original function verifies the caller's exact assignment first.
 output:=public.committee_review_packet_before_bod_handoff(p_assignment_id);
 IF output->'assignment'->>'stage'='BOD' THEN
  SELECT review_cycle_id INTO STRICT cycle_id FROM public.review_assignments WHERE id=p_assignment_id;
  confirmations:=public.committee_bod_crecom_confirmations(cycle_id);
  output:=output||jsonb_build_object('crecomConfirmations',confirmations,'canRespond',coalesce((output->>'canRespond')::boolean,false) AND jsonb_array_length(confirmations)=3);
 END IF;
 RETURN output;
END;
$$;
ALTER FUNCTION public.committee_review_state(text) RENAME TO committee_review_state_before_bod_handoff;
CREATE FUNCTION public.committee_review_state(p_application_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;summary jsonb;
BEGIN
 output:=public.committee_review_state_before_bod_handoff(p_application_id);
 SELECT c.packet_snapshot->'summary' INTO summary FROM public.application_review_cycles c JOIN public.loan_applications a ON a.id=c.application_id
 WHERE a.application_id=p_application_id AND c.status<>'superseded' ORDER BY c.cycle_no DESC,c.created_at DESC LIMIT 1;
 RETURN output||jsonb_build_object('applicationSummary',summary,'bodHandoffVersion',1);
END;
$$;
REVOKE ALL ON FUNCTION public.committee_crecom_all_approved(uuid),public.committee_route_completed_crecom_to_bod(uuid),public.committee_bod_crecom_confirmations(uuid),
 public.committee_workspace_before_bod_handoff(),public.committee_review_packet_before_bod_handoff(uuid),public.committee_review_state_before_bod_handoff(text),
 public.committee_workspace(),public.committee_review_packet(uuid),public.committee_review_state(text),public.committee_review_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.committee_workspace(),public.committee_review_packet(uuid),public.committee_review_state(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.committee_review_action(uuid,text,jsonb) TO service_role;

-- Recover cases already waiting after unanimous CRECOM approval. This only assigns
-- a uniquely eligible BOD Chairperson; it does not approve or release a loan.
DO $$DECLARE app_id uuid;BEGIN
 FOR app_id IN SELECT DISTINCT c.application_id FROM public.application_review_cycles c WHERE c.stage='CRECOM' AND c.status='completed' AND c.outcome='approve'
 LOOP PERFORM public.committee_route_completed_crecom_to_bod(app_id);END LOOP;
END;$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
