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

CREATE OR REPLACE FUNCTION public.loan_release_action(p_actor_id uuid,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true); result jsonb;
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'A verified staff account is required.' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 result:=public.release_approved_loan(p_args->>'applicationId',(p_args->>'requestId')::uuid,(p_args->>'date')::date,p_args->>'reference',(p_args->>'amount')::numeric,p_args->>'notes');
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN result;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_route_bod(p_cycle uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.application_review_cycles%ROWTYPE; chosen public.staff_memberships%ROWTYPE; next_cycle uuid; assignment uuid; notice uuid; total integer;
BEGIN
 SELECT * INTO STRICT parent FROM public.application_review_cycles WHERE id=p_cycle FOR UPDATE;
 IF parent.stage<>'CRECOM' OR parent.status<>'completed' OR parent.outcome IS DISTINCT FROM 'approve' OR NOT public.committee_signatories_complete(parent.id) OR NOT public.committee_packet_is_current(parent.id) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.application_review_cycles WHERE application_id=parent.application_id AND cycle_no=parent.cycle_no AND stage='BOD' AND status<>'superseded') THEN RETURN true; END IF;
 SELECT count(*) INTO total FROM public.staff_memberships m WHERE m.role='bod_member' AND m.committee_seat='chairperson' AND public.committee_reviewer_available(m.id,parent.application_id,'BOD');
 -- Ambiguous/missing appointments require staff selection, never an arbitrary recipient.
 IF total<>1 THEN RETURN false; END IF;
 SELECT * INTO STRICT chosen FROM public.staff_memberships m WHERE m.role='bod_member' AND m.committee_seat='chairperson' AND public.committee_reviewer_available(m.id,parent.application_id,'BOD');
 INSERT INTO public.application_review_cycles(application_id,cycle_no,stage,packet_version,policy_id,packet_snapshot,created_by,required_approvals,reviewer_target,bod_required,routing_reason)
 VALUES(parent.application_id,parent.cycle_no,'BOD',parent.packet_version,parent.policy_id,parent.packet_snapshot,parent.created_by,1,1,true,parent.routing_reason) RETURNING id INTO next_cycle;
 INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,signatory_role) VALUES(next_cycle,chosen.auth_user_id,chosen.id,'bod_chairperson') RETURNING id INTO assignment;
 INSERT INTO public.notifications(user_id,title,message,type,read) SELECT chosen.auth_user_id,'Loan application ready for BOD review',a.application_id||': All three CRECOM reviewers approved. Review the application and confirm your own decision.','info',false FROM public.loan_applications a WHERE a.id=parent.application_id RETURNING id INTO notice;
 INSERT INTO public.committee_notification_links(notification_id,assignment_id) VALUES(notice,assignment);
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.resubmit_returned_loan(p_application_id text,p_request_id uuid,p_updates jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; prior public.application_workflow_events%ROWTYPE; fingerprint text; result jsonb; current_state jsonb;
BEGIN
 IF NOT public.document_member_active() OR p_request_id IS NULL OR jsonb_typeof(p_updates) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Active member access and valid resubmission details are required.' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_updates) k WHERE k NOT IN ('purpose')) OR (p_updates ? 'purpose' AND (jsonb_typeof(p_updates->'purpose')<>'string' OR length(btrim(p_updates->>'purpose')) NOT BETWEEN 1 AND 2000)) THEN RAISE EXCEPTION 'Enter a valid loan purpose. Contact staff if the amount or loan terms need changing.'; END IF;
 SELECT a0.* INTO STRICT a FROM public.loan_applications a0 JOIN public.members m ON m.id=a0.member_id WHERE a0.application_id=p_application_id AND m.user_id=auth.uid() FOR UPDATE OF a0;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'application',a.id,'updates',p_updates)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.application_workflow_events WHERE request_id=p_request_id;
 IF FOUND THEN IF prior.actor_id=auth.uid() AND prior.action='resubmit' AND prior.request_hash=fingerprint THEN RETURN prior.result; END IF; RAISE EXCEPTION 'This request was already used.' USING ERRCODE='40001'; END IF;
 IF a.status<>'returned' OR EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=a.id) THEN RAISE EXCEPTION 'Only your returned application can be resubmitted.' USING ERRCODE='40001'; END IF;
 current_state:=public.private_application_verification_state(a.id);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(current_state->'requiredKinds') k WHERE NOT EXISTS(SELECT 1 FROM public.loan_documents d WHERE d.loan_application_id=a.id AND d.kind=k)) THEN RAISE EXCEPTION 'Upload every required document before resubmitting.'; END IF;
 IF EXISTS(SELECT 1 FROM public.loan_documents d LEFT JOIN LATERAL(SELECT v.id FROM public.loan_document_versions v WHERE v.document_id=d.id ORDER BY version DESC LIMIT 1)v ON true JOIN LATERAL(SELECT r.status FROM public.loan_document_reviews r WHERE r.document_id=d.id AND r.version_id IS NOT DISTINCT FROM v.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1)r ON true WHERE d.loan_application_id=a.id AND r.status='needs_replacement') THEN RAISE EXCEPTION 'Replace the documents marked Needs replacement before resubmitting.'; END IF;
 UPDATE public.application_review_cycles SET status='superseded',closed_at=coalesce(closed_at,clock_timestamp()) WHERE application_id=a.id AND status<>'superseded';
 UPDATE public.application_verifications SET stage='needs_verification',checks='{"identity":false,"eligibility":false,"terms":false}',verified_state_hash=null,verified_snapshot=null,verified_at=null,verified_by=null,policy_id=null,revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE application_id=a.id;
 UPDATE public.loan_applications SET status='pending',purpose=CASE WHEN p_updates ? 'purpose' THEN btrim(p_updates->>'purpose') ELSE purpose END WHERE id=a.id;
 result:=jsonb_build_object('success',true,'status','pending');
 INSERT INTO public.application_workflow_events(application_id,request_id,request_hash,actor_id,actor_name,action,details,result) VALUES(a.id,p_request_id,fingerprint,auth.uid(),public.document_actor_label(),'resubmit',jsonb_build_object('freshApprovalsRequired',true),result);
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_missing_application_document(p_application_id text,p_kind text,p_storage_path text,p_name text,p_content_type text,p_size_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; metadata jsonb; created uuid;
BEGIN
 IF NOT public.document_member_active() THEN RAISE EXCEPTION 'Active member access is required.' USING ERRCODE='42501'; END IF;
 SELECT a0.* INTO STRICT a FROM public.loan_applications a0 JOIN public.members m ON m.id=a0.member_id WHERE a0.application_id=p_application_id AND m.user_id=auth.uid() FOR UPDATE OF a0;
 IF a.status<>'returned' OR p_kind NOT IN ('validId','payslip','collateral','supporting') THEN RAISE EXCEPTION 'Choose a required document for your returned application.'; END IF;
 SELECT id INTO created FROM public.loan_documents WHERE loan_application_id=a.id AND kind=p_kind AND storage_path=p_storage_path;
 IF created IS NOT NULL THEN RETURN jsonb_build_object('id',created); END IF;
 IF EXISTS(SELECT 1 FROM public.loan_documents WHERE loan_application_id=a.id AND kind=p_kind) THEN RAISE EXCEPTION 'This document already exists. Use Upload replacement on the existing file.'; END IF;
 IF p_storage_path IS NULL OR left(p_storage_path,length(auth.uid()::text)+1)<>auth.uid()::text||'/' OR p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 255 OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 10485760 OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif') THEN RAISE EXCEPTION 'Choose a supported file of up to 10 MB.'; END IF;
 SELECT o.metadata INTO metadata FROM storage.objects o WHERE o.bucket_id='loan-documents' AND o.name=p_storage_path;
 IF metadata IS NULL OR (metadata->>'size')::bigint IS DISTINCT FROM p_size_bytes OR metadata->>'mimetype' IS DISTINCT FROM p_content_type THEN RAISE EXCEPTION 'The uploaded file could not be verified.'; END IF;
 INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes) VALUES(gen_random_uuid(),a.id,auth.uid(),p_kind,p_storage_path,p_name,p_content_type,p_size_bytes) RETURNING id INTO created;
 RETURN jsonb_build_object('id',created);
END;
$$;
