-- Returning a pending application can initialize its verification record atomically.
BEGIN;

CREATE OR REPLACE FUNCTION public.mutate_application_verification(
  p_application_id text,
  p_action text,
  p_revision integer,
  p_state_hash text,
  p_payload jsonb,
  p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a public.loan_applications%ROWTYPE;
  w public.application_verifications%ROWTYPE;
  prior public.application_workflow_events%ROWTYPE;
  state jsonb;
  request_hash text;
  result jsonb;
  details jsonb:='{}';
  actor uuid:=auth.uid();
  recipient uuid;
  notification uuid;
  doc public.loan_documents%ROWTYPE;
  doc_version uuid;
  selected_kinds text[];
  selected_kind text;
  chosen_policy uuid;
  lock_key text;
  initialized_for_return boolean:=false;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('start','save_draft','mark_verified','return')
    OR p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    THEN RAISE EXCEPTION 'Choose a valid verification action.'; END IF;
  IF NOT public.document_staff_access(CASE WHEN p_action='return' THEN 'applications.return' ELSE 'applications.verify' END)
    THEN RAISE EXCEPTION 'Application verification permission is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id FOR UPDATE;
  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'application',a.id,'actor',actor,'action',p_action,'revision',p_revision,
    'stateHash',p_state_hash,'payload',p_payload)::text,'UTF8')),'hex');
  SELECT * INTO prior FROM public.application_workflow_events WHERE request_id=p_request_id;
  IF FOUND THEN
    IF prior.actor_id=actor AND prior.application_id=a.id AND prior.request_hash=request_hash THEN RETURN prior.result; END IF;
    RAISE EXCEPTION 'This request reference was already used. Refresh before saving.' USING ERRCODE='40001';
  END IF;
  IF a.status IS NULL OR a.status NOT IN ('pending','under review') THEN
    RAISE EXCEPTION 'Verification is available for Pending or Under Review applications.';
  END IF;
  SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id FOR UPDATE;
  IF coalesce(w.revision,0) IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'Another staff member updated verification. Refresh before saving.' USING ERRCODE='40001';
  END IF;
  -- Serialize with document review/replacement RPCs and trusted evidence writers.
  PERFORM d.id FROM public.loan_documents d WHERE d.loan_application_id=a.id ORDER BY d.id FOR UPDATE;
  state:=public.private_application_verification_state(a.id);
  IF p_state_hash IS DISTINCT FROM state->>'stateHash' THEN
    RAISE EXCEPTION 'The application, documents or evidence changed. Refresh before saving.' USING ERRCODE='40001';
  END IF;
  chosen_policy:=(state->'policy'->>'id')::uuid;
  IF p_action='start' THEN
    IF w.application_id IS NOT NULL THEN RAISE EXCEPTION 'Verification has already started. Refresh.' USING ERRCODE='40001'; END IF;
    INSERT INTO public.application_verifications(application_id,updated_by,policy_id)
      VALUES(a.id,actor,chosen_policy);
    details:=jsonb_build_object('stage','needs_verification');
  ELSE
    IF w.application_id IS NULL THEN
      IF p_action<>'return' THEN RAISE EXCEPTION 'Start the requirements check before saving this action.'; END IF;
      INSERT INTO public.application_verifications(application_id,updated_by,policy_id)
        VALUES(a.id,actor,chosen_policy) RETURNING * INTO w;
      initialized_for_return:=true;
    END IF;
    IF p_action='save_draft' THEN
      IF jsonb_typeof(p_payload->'checks') IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(p_payload->'checks'))<>3
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'checks') k WHERE k NOT IN ('identity','eligibility','terms'))
        OR jsonb_typeof(p_payload->'checks'->'identity') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(p_payload->'checks'->'eligibility') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(p_payload->'checks'->'terms') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string' OR length(p_payload->>'notes')>2000
        THEN RAISE EXCEPTION 'Choose valid checks and internal notes of up to 2,000 characters.'; END IF;
      UPDATE public.application_verifications SET checks=p_payload->'checks',notes=btrim(p_payload->>'notes'),
        stage='needs_verification',policy_id=chosen_policy,revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
        WHERE application_id=a.id;
      details:=jsonb_build_object('checks',p_payload->'checks','notes',btrim(p_payload->>'notes'));
    ELSIF p_action='mark_verified' THEN
      IF jsonb_array_length(state->'blockers')>0 THEN
        RAISE EXCEPTION 'Complete all verification requirements, recorded consent evidence and approved configuration before marking verified.';
      END IF;
      UPDATE public.application_verifications SET stage='ready_for_committee',policy_id=chosen_policy,
        verified_state_hash=state->>'stateHash',verified_snapshot=state,verified_by=actor,verified_at=clock_timestamp(),
        revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;
      details:=jsonb_build_object('packetHash',state->>'packetHash','policyId',chosen_policy,'stage','ready_for_committee');
    ELSE
      IF p_payload->>'category' IS NULL OR p_payload->>'category' NOT IN ('documents','information','consent','other')
        OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
        OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 2000
        OR jsonb_typeof(p_payload->'affectedKinds') IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_payload->'affectedKinds')>4
        THEN RAISE EXCEPTION 'Choose a correction category and enter specific member-visible instructions.'; END IF;
      SELECT coalesce(array_agg(DISTINCT value),'{}') INTO selected_kinds
        FROM jsonb_array_elements_text(p_payload->'affectedKinds');
      IF EXISTS(SELECT 1 FROM unnest(selected_kinds) k WHERE k NOT IN ('validId','payslip','collateral','supporting'))
        THEN RAISE EXCEPTION 'Choose valid affected documents.'; END IF;
      IF p_payload->>'category'='documents' AND cardinality(selected_kinds)=0
        THEN RAISE EXCEPTION 'Select the documents that need correction.'; END IF;
      SELECT user_id INTO recipient FROM public.members WHERE id=a.member_id AND status='active';
      IF recipient IS NULL THEN RAISE EXCEPTION 'The member inbox is unavailable. Check the linked active member account.'; END IF;
      FOREACH selected_kind IN ARRAY selected_kinds LOOP
        SELECT * INTO doc FROM public.loan_documents WHERE loan_application_id=a.id AND kind=selected_kind;
        IF NOT FOUND THEN RAISE EXCEPTION 'A selected file is missing. Use the information category to describe missing requirements.'; END IF;
        SELECT id INTO doc_version FROM public.loan_document_versions WHERE document_id=doc.id ORDER BY version DESC LIMIT 1;
        INSERT INTO public.loan_document_reviews(document_id,version_id,status,reason,reviewer_id,reviewer_name)
          VALUES(doc.id,doc_version,'needs_replacement',btrim(p_payload->>'reason'),actor,public.document_actor_label());
      END LOOP;
      UPDATE public.application_review_cycles SET status='superseded',closed_at=clock_timestamp()
        WHERE application_id=a.id AND status<>'superseded';
      UPDATE public.review_assignments ra SET state='cancelled',revision=ra.revision+1
        WHERE ra.review_cycle_id IN (SELECT id FROM public.application_review_cycles WHERE application_id=a.id)
          AND ra.state IN ('assigned','awaiting_clarification','recused');
      UPDATE public.application_verifications SET stage='returned_for_requirements',
        checks='{"identity":false,"eligibility":false,"terms":false}',verified_state_hash=null,
        verified_snapshot=null,verified_by=null,verified_at=null,
        revision=revision+CASE WHEN initialized_for_return THEN 0 ELSE 1 END,
        updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;
      UPDATE public.loan_applications SET status='returned' WHERE id=a.id;
      INSERT INTO public.notifications(user_id,title,message,type,read)
        VALUES(recipient,'Loan application returned',a.application_id||': '||btrim(p_payload->>'reason'),'warning',false)
        RETURNING id INTO notification;
      INSERT INTO public.application_email_outbox(application_id,member_auth_id,recipient_email,subject,message,request_id,notification_id)
        SELECT a.id,recipient,u.email,'Loan application returned — '||a.application_id,
          a.application_id||': '||btrim(p_payload->>'reason'),p_request_id,notification
        FROM auth.users u WHERE u.id=recipient;
      details:=jsonb_build_object('category',p_payload->>'category','reason',btrim(p_payload->>'reason'),'affectedKinds',selected_kinds);
    END IF;
  END IF;
  SELECT jsonb_build_object('revision',revision,'stage',stage) INTO result
    FROM public.application_verifications WHERE application_id=a.id;
  INSERT INTO public.application_workflow_events(application_id,request_id,request_hash,actor_id,actor_name,action,details,result,notification_id)
    VALUES(a.id,p_request_id,request_hash,actor,public.document_actor_label(),p_action,details,result,notification);
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    VALUES(actor,'application-verification-'||p_action,a.application_id,'success',
      details||jsonb_build_object('requestId',p_request_id,'revision',result->'revision'));
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_application_verification(text,text,integer,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_application_verification(text,text,integer,text,jsonb,uuid) TO service_role;
NOTIFY pgrst,'reload schema';

COMMIT;
