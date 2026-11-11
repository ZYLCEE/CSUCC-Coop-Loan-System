-- Forward migration. Email delivery is intentionally queued until configured.
BEGIN;
ALTER TABLE public.loan_applications DROP CONSTRAINT IF EXISTS loan_applications_status_check;
ALTER TABLE public.loan_applications ADD CONSTRAINT loan_applications_status_check CHECK(status IN ('pending','under review','returned','approved','rejected','released','completed','overdue'));
ALTER TABLE public.committee_policy_rules DROP CONSTRAINT committee_policy_rules_final_mode_check;
ALTER TABLE public.committee_policy_rules ADD CONSTRAINT committee_policy_rules_final_mode_check CHECK(final_mode IN ('super_admin','authorized_admin'));
ALTER TABLE public.application_final_decisions DROP CONSTRAINT application_final_decisions_mode_check;
ALTER TABLE public.application_final_decisions ADD CONSTRAINT application_final_decisions_mode_check CHECK(mode IN ('super_admin','authorized_admin'));
ALTER TABLE public.application_workflow_events DROP CONSTRAINT application_workflow_events_action_check;
ALTER TABLE public.application_workflow_events ADD CONSTRAINT application_workflow_events_action_check CHECK(action IN ('start','save_draft','mark_verified','return','resubmit'));

CREATE TABLE public.application_email_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES public.loan_applications(id),
 member_auth_id uuid NOT NULL REFERENCES auth.users(id),recipient_email text NOT NULL,subject text NOT NULL,message text NOT NULL,
 request_id uuid NOT NULL UNIQUE,notification_id uuid REFERENCES public.notifications(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,last_error text
);
ALTER TABLE public.application_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_email_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.application_email_outbox TO authenticated;
GRANT ALL ON public.application_email_outbox TO service_role;
CREATE POLICY staff_read_application_email_outbox ON public.application_email_outbox FOR SELECT TO authenticated USING(public.document_staff_access('applications.return'));

CREATE OR REPLACE FUNCTION public.pending_loan_workflow_status()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.status='under review' THEN NEW.status:='pending'; END IF;
 IF TG_OP='INSERT' AND NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'New loan applications must start as Pending.'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pending_loan_workflow_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER a_pending_loan_workflow_status BEFORE INSERT OR UPDATE OF status ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.pending_loan_workflow_status();

CREATE OR REPLACE FUNCTION public.committee_transition_allowed(p_application uuid,p_old text,p_new text,p_caller name)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.application_final_decisions%ROWTYPE;
BEGIN
 IF p_old IS NOT DISTINCT FROM p_new THEN RETURN true; END IF;
 IF p_caller NOT IN ('postgres','supabase_admin','service_role') THEN RETURN false; END IF;
 IF p_old IN ('pending','under review') AND p_new='returned' AND public.document_staff_access('applications.return') AND EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application AND stage='returned_for_requirements') THEN RETURN true; END IF;
 IF p_old='returned' AND p_new='pending' AND public.document_member_active() AND EXISTS(SELECT 1 FROM public.loan_applications a JOIN public.members m ON m.id=a.member_id WHERE a.id=p_application AND m.user_id=auth.uid()) THEN RETURN true; END IF;
 -- Preserve servicing of historical loans already approved before enrollment.
 IF NOT EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application) AND public.document_staff_access()
 AND ((p_old='approved' AND p_new='released') OR (p_old IN ('released','overdue') AND p_new IN ('overdue','completed'))) THEN RETURN true; END IF;
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 RETURN d.application_id IS NOT NULL AND public.document_staff_access() AND (
  (p_old IN ('pending','under review') AND p_new=CASE WHEN d.decision='approve' THEN 'approved' ELSE 'rejected' END)
  OR (d.decision='approve' AND ((p_old='approved' AND p_new='released') OR (p_old IN ('released','overdue') AND p_new IN ('overdue','completed')))));
END;
$$;


create or replace function public.release_approved_loan(
  p_application_id text,p_request_id uuid,p_date date,p_reference text,
  p_expected_amount numeric,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare loan public.loan_applications; actor_name text; policy public.loan_policy_settings;
  processing_fee numeric; service_fee numeric; net_proceeds numeric;
begin
  if not public.document_staff_access('loans.release') then raise exception 'Loan release permission is required.' using errcode='42501'; end if;
  if p_request_id is null or p_reference is null or length(btrim(p_reference)) not between 1 and 80
    or coalesce(length(p_notes),0)>2000 then raise exception 'Enter a disbursement reference of 1 to 80 characters and notes of up to 2000 characters.'; end if;
  if p_date is null or p_date>(now() at time zone 'Asia/Manila')::date then raise exception 'Release date cannot be in the future.'; end if;
  select * into loan from public.loan_applications where application_id=p_application_id for update;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  if loan.release_request_id=p_request_id then
    if loan.released_by<>auth.uid() or loan.date_released<>p_date or loan.release_reference<>btrim(p_reference)
      or coalesce(loan.release_notes,'')<>coalesce(p_notes,'') or p_expected_amount is null or loan.amount<>p_expected_amount
      then raise exception 'This request was already used for different release details.' using errcode='23505'; end if;
    return jsonb_build_object('id',loan.id,'application_id',loan.application_id,'status',loan.status,
      'date_released',loan.date_released,'release_reference',loan.release_reference,'amount',loan.amount,
      'interest_rate_at_release',loan.interest_rate_at_release,
      'processing_fee_amount_at_release',loan.processing_fee_amount_at_release,
      'service_fee_amount_at_release',loan.service_fee_amount_at_release,
      'net_proceeds',loan.amount-coalesce(loan.processing_fee_amount_at_release,0)
        -coalesce(loan.service_fee_amount_at_release,0));
  end if;
  if loan.status<>'approved' or loan.date_released is not null or loan.date_completed is not null
    then raise exception 'Only approved loans that have not been released or completed can be marked as released.'; end if;
  if loan.date_approved is null then raise exception 'The approval date must be recorded before releasing this loan.'; end if;
  if p_date<loan.date_approved or p_date<loan.date_submitted then raise exception 'Release date cannot be earlier than approval or submission.'; end if;
  if p_expected_amount is null or p_expected_amount<>loan.amount or loan.amount<=0
    then raise exception 'The loan amount changed or is invalid. Refresh the application and review it again.'; end if;
  select * into policy from public.loan_policy_settings where singleton;
  if not found or policy.base_interest_rate is null or policy.base_interest_rate<0
    or policy.processing_fee_percent is null or policy.processing_fee_percent<0
    or policy.service_fee_percent is null or policy.service_fee_percent<0 then
    raise exception 'Valid loan policy rates must be configured before releasing a loan.';
  end if;
  processing_fee:=round(loan.amount*policy.processing_fee_percent/100,2);
  service_fee:=round(loan.amount*policy.service_fee_percent/100,2);
  net_proceeds:=loan.amount-processing_fee-service_fee;
  if net_proceeds<0 then raise exception 'The release fees exceed the approved principal.'; end if;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,id::text) into actor_name from auth.users where id=auth.uid();
  update public.loan_applications set status='released',date_released=p_date,updated_at=clock_timestamp(),
    release_reference=btrim(p_reference),release_notes=coalesce(p_notes,''),released_by=auth.uid(),
    released_by_name=actor_name,release_request_id=p_request_id,
    interest_rate_at_release=policy.base_interest_rate,
    processing_fee_rate_at_release=policy.processing_fee_percent,
    service_fee_rate_at_release=policy.service_fee_percent,
    processing_fee_amount_at_release=processing_fee,
    service_fee_amount_at_release=service_fee where id=loan.id returning * into loan;
  insert into public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    values(auth.uid(),'release-loan',loan.application_id,'success',jsonb_build_object(
      'loan_id',loan.id,'amount',loan.amount,'release_date',p_date,'disbursement_reference',btrim(p_reference),
      'previous_status','approved','status','released','notes',coalesce(p_notes,''),
      'interest_rate_at_release',loan.interest_rate_at_release,
      'processing_fee_amount_at_release',processing_fee,'service_fee_amount_at_release',service_fee,
      'net_proceeds',net_proceeds));
  return jsonb_build_object('id',loan.id,'application_id',loan.application_id,'status','released',
    'date_released',loan.date_released,'release_reference',loan.release_reference,'amount',loan.amount,
    'interest_rate_at_release',loan.interest_rate_at_release,
    'processing_fee_amount_at_release',processing_fee,'service_fee_amount_at_release',service_fee,
    'net_proceeds',net_proceeds);
end $$;

CREATE OR REPLACE FUNCTION public.mutate_application_verification(p_application_id text,p_action text,p_revision integer,p_state_hash text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; prior public.application_workflow_events%ROWTYPE;
  state jsonb; request_hash text; result jsonb; details jsonb:='{}'; actor uuid:=auth.uid(); recipient uuid; notification uuid;
  doc public.loan_documents%ROWTYPE; doc_version uuid; selected_kinds text[]; selected_kind text; chosen_policy uuid; lock_key text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('start','save_draft','mark_verified','return') OR p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    THEN RAISE EXCEPTION 'Choose a valid verification action.'; END IF;
  IF NOT public.document_staff_access(CASE WHEN p_action='return' THEN 'applications.return' ELSE 'applications.verify' END)
    THEN RAISE EXCEPTION 'Application verification permission is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id FOR UPDATE;
  request_hash:=encode(sha256(convert_to(jsonb_build_object('application',a.id,'actor',actor,'action',p_action,'revision',p_revision,'stateHash',p_state_hash,'payload',p_payload)::text,'UTF8')),'hex');
  SELECT * INTO prior FROM public.application_workflow_events WHERE request_id=p_request_id;
  IF FOUND THEN
    IF prior.actor_id=actor AND prior.application_id=a.id AND prior.request_hash=request_hash THEN RETURN prior.result; END IF;
    RAISE EXCEPTION 'This request reference was already used. Refresh before saving.' USING ERRCODE='40001';
  END IF;
  IF a.status IS NULL OR a.status NOT IN ('pending','under review') THEN RAISE EXCEPTION 'Verification is available for Pending or Under Review applications.'; END IF;
  SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id FOR UPDATE;
  IF coalesce(w.revision,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Another staff member updated verification. Refresh before saving.' USING ERRCODE='40001'; END IF;
  -- Serialize with document review/replacement RPCs, and with trusted evidence writers.
  PERFORM d.id FROM public.loan_documents d WHERE d.loan_application_id=a.id ORDER BY d.id FOR UPDATE;
  state:=public.private_application_verification_state(a.id);
  IF p_state_hash IS DISTINCT FROM state->>'stateHash' THEN RAISE EXCEPTION 'The application, documents or evidence changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
  chosen_policy:=(state->'policy'->>'id')::uuid;
  IF p_action='start' THEN
    IF w.application_id IS NOT NULL THEN RAISE EXCEPTION 'Verification has already started. Refresh.' USING ERRCODE='40001'; END IF;
    INSERT INTO public.application_verifications(application_id,updated_by,policy_id) VALUES(a.id,actor,chosen_policy);
    details:=jsonb_build_object('stage','needs_verification');
  ELSE
    IF w.application_id IS NULL THEN
      IF p_action<>'return' THEN RAISE EXCEPTION 'Start the requirements check before saving this action.'; END IF;
      INSERT INTO public.application_verifications(application_id,updated_by,policy_id) VALUES(a.id,actor,chosen_policy);
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
        stage='needs_verification',policy_id=chosen_policy,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;
      details:=jsonb_build_object('checks',p_payload->'checks','notes',btrim(p_payload->>'notes'));
    ELSIF p_action='mark_verified' THEN
      IF jsonb_array_length(state->'blockers')>0 THEN RAISE EXCEPTION 'Complete all verification requirements, recorded consent evidence and approved configuration before marking verified.'; END IF;
      UPDATE public.application_verifications SET stage='ready_for_committee',policy_id=chosen_policy,verified_state_hash=state->>'stateHash',
        verified_snapshot=state,verified_by=actor,verified_at=clock_timestamp(),revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;
      details:=jsonb_build_object('packetHash',state->>'packetHash','policyId',chosen_policy,'stage','ready_for_committee');
    ELSE
      IF p_payload->>'category' IS NULL OR p_payload->>'category' NOT IN ('documents','information','consent','other')
        OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'reason')) NOT BETWEEN 1 AND 2000
        OR jsonb_typeof(p_payload->'affectedKinds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'affectedKinds')>4
        THEN RAISE EXCEPTION 'Choose a correction category and enter specific member-visible instructions.'; END IF;
      SELECT coalesce(array_agg(DISTINCT value),'{}') INTO selected_kinds FROM jsonb_array_elements_text(p_payload->'affectedKinds');
      IF EXISTS(SELECT 1 FROM unnest(selected_kinds) k WHERE k NOT IN ('validId','payslip','collateral','supporting')) THEN RAISE EXCEPTION 'Choose valid affected documents.'; END IF;
      IF p_payload->>'category'='documents' AND cardinality(selected_kinds)=0 THEN RAISE EXCEPTION 'Select the documents that need correction.'; END IF;
      SELECT user_id INTO recipient FROM public.members WHERE id=a.member_id AND status='active';
      IF recipient IS NULL THEN RAISE EXCEPTION 'The member inbox is unavailable. Check the linked active member account.'; END IF;
      FOREACH selected_kind IN ARRAY selected_kinds LOOP
        SELECT * INTO doc FROM public.loan_documents WHERE loan_application_id=a.id AND kind=selected_kind;
        IF NOT FOUND THEN RAISE EXCEPTION 'A selected file is missing. Use the information category to describe missing requirements.'; END IF;
        SELECT id INTO doc_version FROM public.loan_document_versions WHERE document_id=doc.id ORDER BY version DESC LIMIT 1;
        INSERT INTO public.loan_document_reviews(document_id,version_id,status,reason,reviewer_id,reviewer_name)
          VALUES(doc.id,doc_version,'needs_replacement',btrim(p_payload->>'reason'),actor,public.document_actor_label());
      END LOOP;
      UPDATE public.application_review_cycles SET status='superseded',closed_at=clock_timestamp() WHERE application_id=a.id AND status<>'superseded';
      UPDATE public.review_assignments ra SET state='cancelled',revision=ra.revision+1 WHERE ra.review_cycle_id IN (SELECT id FROM public.application_review_cycles WHERE application_id=a.id) AND ra.state IN ('assigned','awaiting_clarification','recused');
      UPDATE public.application_verifications SET stage='returned_for_requirements',checks='{"identity":false,"eligibility":false,"terms":false}',verified_state_hash=null,verified_snapshot=null,verified_by=null,verified_at=null,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;
      UPDATE public.loan_applications SET status='returned' WHERE id=a.id;
      INSERT INTO public.notifications(user_id,title,message,type,read)
        VALUES(recipient,'Loan application returned',a.application_id||': '||btrim(p_payload->>'reason'),'warning',false) RETURNING id INTO notification;
      INSERT INTO public.application_email_outbox(application_id,member_auth_id,recipient_email,subject,message,request_id,notification_id)
        SELECT a.id,recipient,u.email,'Loan application returned — '||a.application_id,a.application_id||': '||btrim(p_payload->>'reason'),p_request_id,notification FROM auth.users u WHERE u.id=recipient;
      details:=jsonb_build_object('category',p_payload->>'category','reason',btrim(p_payload->>'reason'),'affectedKinds',selected_kinds);
    END IF;
  END IF;
  SELECT jsonb_build_object('revision',revision,'stage',stage) INTO result FROM public.application_verifications WHERE application_id=a.id;
  INSERT INTO public.application_workflow_events(application_id,request_id,request_hash,actor_id,actor_name,action,details,result,notification_id)
    VALUES(a.id,p_request_id,request_hash,actor,public.document_actor_label(),p_action,details,result,notification);
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    VALUES(actor,'application-verification-'||p_action,a.application_id,'success',details||jsonb_build_object('requestId',p_request_id,'revision',result->'revision'));
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_document_replacement(
  p_document_id uuid,p_expected_version_id uuid,p_storage_path text,p_name text,p_content_type text,p_size_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.loan_documents%ROWTYPE; current_version uuid; current_number integer; review_status text; app_status text; object_metadata jsonb; created_id uuid;
BEGIN
  IF NOT public.document_member_active() THEN RAISE EXCEPTION 'Sign in with an active member account.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT d FROM public.loan_documents WHERE id=p_document_id FOR UPDATE;
  IF d.user_id<>auth.uid() THEN RAISE EXCEPTION 'This document belongs to another member.' USING ERRCODE='42501'; END IF;
  SELECT id INTO created_id FROM public.loan_document_versions WHERE document_id=d.id AND storage_path=p_storage_path;
  IF created_id IS NOT NULL THEN RETURN jsonb_build_object('id',created_id); END IF;
  SELECT id,version INTO current_version,current_number FROM public.loan_document_versions WHERE document_id=d.id ORDER BY version DESC LIMIT 1;
  IF current_version IS DISTINCT FROM p_expected_version_id THEN RAISE EXCEPTION 'A newer replacement already exists. Refresh your documents.' USING ERRCODE='40001'; END IF;
  SELECT status INTO review_status FROM public.loan_document_reviews WHERE document_id=d.id AND version_id IS NOT DISTINCT FROM current_version ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT status::text INTO app_status FROM public.loan_applications WHERE id=d.loan_application_id;
  IF review_status IS DISTINCT FROM 'needs_replacement' OR app_status IS NULL OR app_status NOT IN ('pending','under review','returned')
    THEN RAISE EXCEPTION 'A replacement can be submitted only for a requested file while the application is Pending or Returned.'; END IF;
  IF p_storage_path IS NULL OR left(p_storage_path,length(auth.uid()::text)+1)<>auth.uid()::text||'/'
    OR p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 255 OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 10485760
    OR p_content_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')
    THEN RAISE EXCEPTION 'Choose a supported file of up to 10 MB.'; END IF;
  SELECT metadata INTO object_metadata FROM storage.objects WHERE bucket_id='loan-documents' AND name=p_storage_path;
  IF object_metadata IS NULL OR (object_metadata->>'size')::bigint IS DISTINCT FROM p_size_bytes OR object_metadata->>'mimetype' IS DISTINCT FROM p_content_type
    THEN RAISE EXCEPTION 'The uploaded file could not be verified. Please retry.'; END IF;
  IF EXISTS(SELECT 1 FROM public.loan_documents WHERE storage_path=p_storage_path) OR EXISTS(SELECT 1 FROM public.loan_document_versions WHERE storage_path=p_storage_path)
    THEN RAISE EXCEPTION 'This file is already registered.'; END IF;
  INSERT INTO public.loan_document_versions(document_id,version,storage_path,original_name,content_type,size_bytes,uploaded_by,uploaded_by_name)
  VALUES(d.id,coalesce(current_number,1)+1,p_storage_path,p_name,p_content_type,p_size_bytes,auth.uid(),public.document_actor_label())
  RETURNING id INTO created_id;
  -- No review is copied to the new version. The new upload starts To review.
  RETURN jsonb_build_object('id',created_id,'version',coalesce(current_number,1)+1);
END;
$$;

CREATE OR REPLACE FUNCTION public.member_application_corrections()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT public.document_member_active() THEN RAISE EXCEPTION 'Active member access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',a.application_id,'stage',v.stage,'purpose',a.purpose,'missingKinds',(SELECT coalesce(jsonb_agg(k),'[]') FROM jsonb_array_elements_text(public.private_application_verification_state(a.id)->'requiredKinds') k WHERE NOT EXISTS(SELECT 1 FROM public.loan_documents d WHERE d.loan_application_id=a.id AND d.kind=k)),
    'reason',e.details->>'reason','affectedKinds',e.details->'affectedKinds','createdAt',e.created_at) ORDER BY e.created_at DESC),'[]') INTO rows
    FROM public.application_verifications v JOIN public.loan_applications a ON a.id=v.application_id
    JOIN public.members m ON m.id=a.member_id
    CROSS JOIN LATERAL(SELECT details,created_at FROM public.application_workflow_events e WHERE e.application_id=a.id AND e.action='return' ORDER BY created_at DESC,id DESC LIMIT 1)e
    WHERE m.user_id=auth.uid() AND v.stage='returned_for_requirements';
  RETURN rows;
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
    'memberNumber',coalesce(m.member_id,'Not recorded'),'loanType',a.loan_type,'loanStatus',a.status,'loanSummary',jsonb_build_object('amount',a.amount,'months',a.tenure_months,'monthlyPayment',a.monthly_payment,'purpose',a.purpose),'returnEmailStatus',(SELECT o.status FROM public.application_email_outbox o WHERE o.application_id=a.id ORDER BY o.created_at DESC LIMIT 1),
    'stage',coalesce(review_stage,CASE WHEN w.application_id IS NULL THEN 'not_started' WHEN stale THEN 'needs_verification' ELSE w.stage END),
    'enrolled',w.application_id IS NOT NULL,'revision',coalesce(w.revision,0),'stale',coalesce(stale,false),
    'checks',coalesce(w.checks,'{"identity":false,"eligibility":false,"terms":false}'),'notes',coalesce(w.notes,''),
    'history',history,'lastReturned',returned,'canEnroll',a.status IN ('pending','under review') AND NOT EXISTS(SELECT 1 FROM public.application_review_cycles WHERE application_id=a.id AND status<>'superseded'),
    'permissions',jsonb_build_object('verify',public.document_staff_access('applications.verify'),'return',public.document_staff_access('applications.return'),'policyManage',public.document_staff_access('workflow.policy.manage')));
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_application_stage(p_application uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; d public.application_final_decisions%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 IF FOUND THEN RETURN CASE WHEN d.decision='approve' THEN 'final_approved' ELSE 'final_rejected' END; END IF;
 SELECT * INTO c FROM public.application_review_cycles WHERE application_id=p_application AND status<>'superseded' ORDER BY cycle_no DESC,CASE WHEN stage='BOD' THEN 0 ELSE 1 END LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT public.committee_packet_is_current(c.id) THEN RETURN 'review_stale'; END IF;
 IF c.outcome='reject' THEN RETURN 'review_attention'; END IF;
 IF c.status='open' THEN
  IF EXISTS(SELECT 1 FROM public.review_assignments WHERE review_cycle_id=c.id AND state IN ('awaiting_clarification','recused')) THEN RETURN 'review_attention'; END IF;
  RETURN CASE WHEN c.stage='CRECOM' THEN 'crecom_review' ELSE 'bod_review' END;
 END IF;
 IF c.stage='CRECOM' AND c.bod_required THEN RETURN 'ready_for_bod'; END IF;
 RETURN 'ready_for_final';
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_mutate_review(p_application_id text,p_action text,p_revision integer,p_state_hash text,p_payload jsonb,p_request_id uuid)
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
  IF NOT public.document_staff_access('applications.finalize') THEN RAISE EXCEPTION 'Final decision permission is required.' USING ERRCODE='42501'; END IF;
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
  IF p.config->>'bodMode' IS DISTINCT FROM 'required' OR rules.crecom_approvals<>3 OR rules.bod_reviewers IS DISTINCT FROM 1 OR rules.bod_approvals IS DISTINCT FROM 1 OR rules.signatory_layout<>'manual_form_v1' THEN RAISE EXCEPTION 'Activate the confirmed four-position workflow before forwarding.'; END IF;
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
   IF parent.id IS NULL OR parent.outcome IS DISTINCT FROM 'approve' OR NOT public.committee_signatories_complete(parent.id) OR NOT public.committee_packet_is_current(parent.id) OR NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'Complete the current CRECOM stage before required BOD review.'; END IF;
   bod_needed:=true;route_reason:=parent.routing_reason;cycle_number:=parent.cycle_no;packet:=parent.packet_snapshot;
  END IF;
  IF target_count IS NULL OR approvals_needed IS NULL OR jsonb_typeof(p_payload->'reviewers') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_payload->'reviewers')<>target_count
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_payload->'reviewers'))<>target_count
   OR (p_payload->>'dueAt' IS NOT NULL AND (p_payload->>'dueAt')::timestamptz<=now()) THEN RAISE EXCEPTION 'Choose the exact number of distinct eligible reviewers and a future deadline.'; END IF;
  PERFORM m.id FROM public.staff_memberships m WHERE m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) ORDER BY m.id FOR SHARE;
  IF stage_name='CRECOM' AND ((SELECT count(*) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='member')<>2 OR (SELECT count(*) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='chairperson')<>1) THEN RAISE EXCEPTION 'Select exactly two CRECOM members and one CRECOM chairperson.'; END IF;
  FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers') LOOP
   IF NOT public.committee_reviewer_available(candidate,a.id,stage_name) THEN RAISE EXCEPTION 'A selected reviewer is inactive, not set up, conflicted or no longer eligible.' USING ERRCODE='40001'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT auth_user_id) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')))<>target_count THEN RAISE EXCEPTION 'Each reviewer must be a different person.'; END IF;
  INSERT INTO public.application_review_cycles(application_id,cycle_no,stage,packet_version,packet_snapshot,policy_id,created_by,required_approvals,reviewer_target,bod_required,routing_reason)
   VALUES(a.id,cycle_number,stage_name,CASE WHEN p_action='forward_bod' THEN parent.packet_version ELSE w.revision END,packet,p.id,auth.uid(),approvals_needed,target_count,bod_needed,route_reason) RETURNING * INTO c;
  event_cycle:=c.id;
  FOR membership IN SELECT * FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) LOOP
   INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,signatory_role,due_at) VALUES(c.id,membership.auth_user_id,membership.id,CASE WHEN stage_name='BOD' THEN 'bod_chairperson' WHEN membership.committee_seat='chairperson' THEN 'crecom_chairperson' ELSE 'crecom_member' END,(p_payload->>'dueAt')::timestamptz) RETURNING id INTO new_assignment;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(membership.auth_user_id,'Application assigned for review',a.application_id||': A '||stage_name||' review packet is ready in My Assigned Applications.','info',false) RETURNING id INTO notification;
   INSERT INTO public.committee_notification_links VALUES(notification,new_assignment);
  END LOOP;
 ELSIF p_action='reopen' THEN
  IF length(reason) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter the reason for returning to verification.'; END IF;
  UPDATE public.application_review_cycles SET status='superseded',closed_at=clock_timestamp() WHERE application_id=a.id AND status<>'superseded';
  UPDATE public.review_assignments SET state='cancelled',revision=revision+1 WHERE review_cycle_id IN (SELECT id FROM public.application_review_cycles WHERE application_id=a.id) AND state IN ('assigned','awaiting_clarification','recused');
  UPDATE public.application_verifications SET stage='needs_verification',policy_id=null,verified_state_hash=null,verified_snapshot=null,verified_at=null,verified_by=null WHERE application_id=a.id;
 ELSIF p_action='finalize' THEN
  SELECT * INTO STRICT rules FROM public.committee_policy_rules WHERE policy_id=w.policy_id;
  PERFORM public.committee_record_final(a.id,p_payload->>'decision',CASE WHEN rules.final_mode='authorized_admin' THEN 'authorized_admin' ELSE 'super_admin' END,reason);
 ELSE
  SELECT * INTO STRICT assignment FROM public.review_assignments WHERE id=(p_payload->>'assignmentId')::uuid FOR UPDATE;
  SELECT * INTO STRICT c FROM public.application_review_cycles WHERE id=assignment.review_cycle_id AND application_id=a.id FOR UPDATE;
  event_cycle:=c.id;event_assignment:=assignment.id;
  IF c.status<>'open' OR assignment.state IN ('cancelled','reassigned','decision_recorded') THEN RAISE EXCEPTION 'This assignment is already closed or decided.' USING ERRCODE='40001'; END IF;
  PERFORM m.id FROM public.staff_memberships m WHERE m.id=assignment.membership_id FOR SHARE;
  IF p_action IN ('approve','reject','clarify','recuse') AND NOT public.committee_assignment_eligible(assignment.id) THEN RAISE EXCEPTION 'This case is not assigned to your active membership.' USING ERRCODE='42501'; END IF;
  IF p_action<>'approve' AND length(reason) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a reason or clarification.'; END IF;
  IF p_action NOT IN ('recuse','reassign') AND NOT public.committee_packet_is_current(c.id) THEN RAISE EXCEPTION 'The packet changed or evidence expired. Staff must return it to verification before new decisions.' USING ERRCODE='40001'; END IF;
  IF p_action IN ('approve','reject') THEN
   IF assignment.state<>'assigned' THEN RAISE EXCEPTION 'Wait for staff to resolve the clarification, or for reassignment.'; END IF;
   IF p_payload->>'confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirm your decision for this exact application packet.'; END IF;
   INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,packet_version,decision,reason,reviewer_name,confirmation_text,confirmation_method,signatory_role)
   VALUES(assignment.id,auth.uid(),c.packet_version,p_action,nullif(reason,''),public.document_actor_label(),
    format('I record %s as %s for %s, packet version %s.',p_action,replace(assignment.signatory_role,'_',' '),a.application_id,c.packet_version),'account_password',assignment.signatory_role);
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
   PERFORM m.id FROM public.staff_memberships m WHERE m.id=candidate FOR SHARE;
   IF NOT public.committee_reviewer_available(candidate,a.id,c.stage) OR EXISTS(SELECT 1 FROM public.review_assignments x JOIN public.staff_memberships m ON m.id=candidate WHERE x.review_cycle_id=c.id AND x.reviewer_auth_id=m.auth_user_id) THEN RAISE EXCEPTION 'Choose a different eligible reviewer who has not reviewed this cycle.'; END IF;
   IF assignment.signatory_role IS DISTINCT FROM (SELECT CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' THEN 'crecom_member' END FROM public.staff_memberships m WHERE m.id=candidate) THEN RAISE EXCEPTION 'The replacement must hold the same committee position as the original assignment.'; END IF;
   UPDATE public.review_assignments SET state='reassigned',revision=revision+1 WHERE id=assignment.id;
   SELECT * INTO STRICT membership FROM public.staff_memberships WHERE id=candidate;
   INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,signatory_role,due_at) VALUES(c.id,membership.auth_user_id,membership.id,assignment.signatory_role,assignment.due_at) RETURNING id INTO new_assignment;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(membership.auth_user_id,'Application reassigned for review',a.application_id||': A review packet is ready in My Assigned Applications.','info',false) RETURNING id INTO notification;
   INSERT INTO public.committee_notification_links VALUES(notification,new_assignment);
  END IF;
  SELECT count(*) FILTER(WHERE x.state='decision_recorded'),count(*) FILTER(WHERE d.decision='approve') INTO responded,approvals
   FROM public.review_assignments x LEFT JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=c.id AND x.state NOT IN ('cancelled','reassigned');
  IF responded=c.reviewer_target OR EXISTS(SELECT 1 FROM public.individual_review_decisions d JOIN public.review_assignments x ON x.id=d.assignment_id WHERE x.review_cycle_id=c.id AND d.decision='reject') THEN
   outcome_value:=CASE WHEN responded=c.reviewer_target AND approvals>=c.required_approvals THEN 'approve' ELSE 'reject' END;
   UPDATE public.application_review_cycles SET status='completed',outcome=outcome_value,closed_at=clock_timestamp() WHERE id=c.id;
   INSERT INTO public.notifications(user_id,title,message,type,read) VALUES(c.created_by,'Committee review completed',a.application_id||': All '||c.reviewer_target||' '||c.stage||' reviewers responded. Panel outcome: '||outcome_value||'.','info',false);
  END IF;
 END IF;
 IF p_action='approve' AND c.stage='CRECOM' AND outcome_value='approve' THEN PERFORM public.committee_route_bod(c.id); END IF;
 UPDATE public.application_verifications SET revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE application_id=a.id;
 result:=jsonb_build_object('success',true,'stage',public.committee_application_stage(a.id),'cycleId',event_cycle);
 INSERT INTO public.committee_review_events(request_id,request_hash,application_id,cycle_id,assignment_id,actor_id,actor_name,action,reason,result)
 VALUES(p_request_id,fingerprint,a.id,event_cycle,event_assignment,auth.uid(),public.document_actor_label(),p_action,reason,result);
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'committee-review-'||p_action,a.application_id,'success',jsonb_build_object('requestId',p_request_id,'cycleId',event_cycle,'assignmentId',event_assignment,'payload',p_payload));
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_record_final(p_application uuid,p_decision text,p_mode text,p_reason text)
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
 IF NOT c.bod_required OR p.config->>'bodMode' IS DISTINCT FROM 'required' OR r.signatory_layout<>'manual_form_v1' OR NOT public.committee_signatories_complete(c.id) THEN RAISE EXCEPTION 'Complete the required two CRECOM member and one CRECOM chairperson confirmations first.'; END IF;
 recommendation:=c.outcome;chosen_cycles:=ARRAY[c.id];
 IF c.bod_required THEN
  SELECT * INTO b FROM public.application_review_cycles WHERE application_id=a.id AND cycle_no=c.cycle_no AND stage='BOD' AND status='completed';
  IF b.id IS NULL OR NOT public.committee_signatories_complete(b.id) OR b.outcome IS NULL OR NOT public.committee_packet_is_current(b.id) THEN RAISE EXCEPTION 'Complete the required current BOD review first.'; END IF;
  chosen_cycles:=array_append(chosen_cycles,b.id);
  IF b.outcome='reject' THEN recommendation:='reject'; END IF;
 END IF;
 IF p_mode IS DISTINCT FROM r.final_mode OR p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Choose the authorized final decision and enter its reason.'; END IF;
 IF NOT public.document_staff_access('applications.finalize') OR (r.final_mode='super_admin' AND (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin') THEN RAISE EXCEPTION 'Your account is not authorized to record this final decision.' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.committee_activate_policy(p_policy_id uuid,p_rules jsonb,p_request_id uuid)
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
  OR coalesce(p_rules->>'finalMode','') NOT IN ('super_admin','authorized_admin') OR p_rules->>'allowOverride' IS DISTINCT FROM 'false'
  OR length(btrim(coalesce(p_rules->>'ruleReference',''))) NOT BETWEEN 1 AND 500
  OR length(btrim(p.authorization_reference))=0 THEN RAISE EXCEPTION 'Complete the approved voting, final-authority and authorization references.'; END IF;
 IF p.config->>'bodMode' IS DISTINCT FROM 'required' OR bn IS DISTINCT FROM 1 OR ba IS DISTINCT FROM 1 OR p_rules->>'signatoryLayout' IS DISTINCT FROM 'manual_form_v1' OR p_rules->>'bodAuthority' IS DISTINCT FROM 'recommendation' THEN RAISE EXCEPTION 'Every loan requires two CRECOM members, one CRECOM chairperson and one BOD chairperson before Super Admin final decision.'; END IF;
 IF p.config->>'bodMode'<>'none' AND (bn IS NULL OR bn NOT BETWEEN 1 AND 100 OR ba IS NULL OR ba NOT BETWEEN 1 AND bn OR coalesce(p_rules->>'bodAuthority','pending') NOT IN ('recommendation','binding_decision')) THEN RAISE EXCEPTION 'Complete BOD reviewer counts, approval threshold and authority.'; END IF;
 UPDATE public.approval_workflow_policies SET status='approved',effective_at=now(),approved_at=clock_timestamp(),approved_by=auth.uid() WHERE id=p.id;
 INSERT INTO public.committee_policy_rules(policy_id,crecom_approvals,bod_reviewers,bod_approvals,final_mode,allow_override,bod_authority,all_responses,rule_reference,activated_by)
 VALUES(p.id,ca,CASE WHEN p.config->>'bodMode'='none' THEN NULL ELSE bn END,CASE WHEN p.config->>'bodMode'='none' THEN NULL ELSE ba END,
 p_rules->>'finalMode',(p_rules->>'allowOverride')::boolean,CASE WHEN p.config->>'bodMode'='none' THEN 'pending' ELSE p_rules->>'bodAuthority' END,true,btrim(p_rules->>'ruleReference'),auth.uid());
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'workflow-policy-activate',p_request_id::text,'success',jsonb_build_object('policyId',p.id,'version',p.version,'rules',p_rules,'fingerprint',fingerprint));
 RETURN jsonb_build_object('success',true,'policyId',p.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_review_state(p_application_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; state jsonb; cycles jsonb; events jsonb; candidates jsonb; final jsonb; stage_value text;
BEGIN
 IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id;
 SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id;
 state:=public.private_application_verification_state(a.id);stage_value:=public.committee_application_stage(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'stage',c.stage,'cycle',c.cycle_no,'packetVersion',c.packet_version,'status',c.status,'outcome',c.outcome,
  'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,'bodRequired',c.bod_required,'routingReason',c.routing_reason,'createdAt',c.created_at,
  'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'membershipId',x.membership_id,'name',coalesce(d.reviewer_name,nullif(u.raw_user_meta_data->>'full_name',''),u.email),'signatoryRole',x.signatory_role,'confirmationReference',d.id,'confirmationText',d.confirmation_text,'confirmationMethod',d.confirmation_method,
   'state',x.state,'revision',x.revision,'decision',d.decision,'reason',d.reason,'decidedAt',d.created_at) ORDER BY x.assigned_at),'[]')
   FROM public.review_assignments x JOIN auth.users u ON u.id=x.reviewer_auth_id LEFT JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=c.id))
  ORDER BY c.cycle_no DESC,c.created_at DESC),'[]') INTO cycles FROM public.application_review_cycles c WHERE c.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',e.actor_name,'reason',e.reason,'createdAt',e.created_at,'assignmentId',e.assignment_id) ORDER BY e.created_at DESC),'[]')
 INTO events FROM public.committee_review_events e WHERE e.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'role',m.role,'committeeSeat',m.committee_seat,'title',m.title) ORDER BY u.email),'[]')
 INTO candidates FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE public.committee_reviewer_available(m.id,a.id,CASE WHEN m.role='crecom_member' THEN 'CRECOM' ELSE 'BOD' END);
 SELECT jsonb_build_object('decision',decision,'mode',mode,'reason',reason,'createdAt',created_at,'actor',actor_name) INTO final FROM public.application_final_decisions WHERE application_id=a.id;
 RETURN jsonb_build_object('applicationId',a.application_id,'revision',coalesce(w.revision,0),'stateHash',state->>'stateHash','verificationStage',coalesce(stage_value,w.stage,'not_started'),
  'verified',coalesce(w.stage='ready_for_committee' AND w.verified_state_hash=state->>'stateHash' AND jsonb_array_length(state->'blockers')=0,false),
  'blockers',state->'blockers','policyId',state->'policy'->>'id','policyName',state->'policy'->>'name','policyConfig',state->'policy'->'config',
  'rules',public.committee_rules_json((state->'policy'->>'id')::uuid),'candidates',candidates,'cycles',cycles,'events',events,'finalDecision',final,
  'canManage',public.document_staff_access('applications.forward'),
  'canFinalize',public.document_staff_access('applications.finalize') AND stage_value='ready_for_final'
   AND (public.committee_rules_json(w.policy_id)->>'finalMode'='authorized_admin' OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())='super_admin'));
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_membership_eligible(p_id uuid,p_allow_setup boolean DEFAULT false,p_allow_future boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.id=p_id AND m.auth_user_id=auth.uid() AND m.active
  AND (p_allow_future OR m.starts_at<=now()) AND (m.ends_at IS NULL OR m.ends_at>now())
  AND (p_allow_setup OR m.setup_completed_at IS NOT NULL)
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
  AND (m.role='crecom_member' OR m.committee_seat='chairperson')
  AND NOT EXISTS(SELECT 1 FROM public.members b WHERE b.user_id=u.id));
$$;

CREATE OR REPLACE FUNCTION public.committee_accounts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin'
  THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'email'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('id',m.id,'requestId',m.invitation_request_id,'userId',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'email',u.email,'role',m.role,'committeeSeat',m.committee_seat,'title',m.title,'startsAt',m.starts_at,'endsAt',m.ends_at,'active',m.active,'revision',m.revision,'setupCompletedAt',m.setup_completed_at,
   'status',CASE WHEN NOT m.active THEN 'inactive' WHEN m.ends_at<=now() THEN 'expired' WHEN m.setup_completed_at IS NULL THEN 'invited' WHEN m.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'lastSignInAt',u.last_sign_in_at,'assignedCount',(SELECT count(*) FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE a.membership_id=m.id AND c.status='open' AND a.state IN ('assigned','awaiting_clarification')),
   'lastInviteAt',m.last_invite_at,'error',null) AS row FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  UNION ALL
  SELECT jsonb_build_object('id',r.id,'requestId',r.id,'creationMode',coalesce(r.payload->>'provisioningMode','invite'),'userId',r.auth_user_id,'name',r.payload->>'name','email',r.email,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','title',r.payload->>'title',
   'startsAt',r.payload->>'startsAt','endsAt',r.payload->>'endsAt','active',false,'revision',0,'setupCompletedAt',null,
   'status',CASE WHEN r.state='failed' THEN 'failed' ELSE 'provisioning' END,'lastSignInAt',null,'assignedCount',0,'lastInviteAt',r.created_at,'error',r.error)
   FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state<>'complete'
 )records;
 RETURN jsonb_build_object('accounts',rows,'bodEnabled',public.committee_bod_enabled());
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_reserve_invite(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.committee_account_requests%ROWTYPE; existing auth.users%ROWTYPE; fingerprint text; invite_email text:=lower(btrim(p_payload->>'email')); start_date timestamptz; end_date timestamptz;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 OR length(coalesce(invite_email,'')) NOT BETWEEN 3 AND 254 OR invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  OR coalesce(p_payload->>'role','') NOT IN ('crecom_member','bod_member') OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Enter valid committee account details.'; END IF;

 IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;
 start_date:=(p_payload->>'startsAt')::timestamptz;end_date:=(p_payload->>'endsAt')::timestamptz;
 IF start_date IS NULL OR (end_date IS NOT NULL AND end_date<=start_date) THEN RAISE EXCEPTION 'Choose valid membership dates.'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'payload',p_payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('committee-invite:'||invite_email,0));
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.kind<>'invite' OR r.actor_id<>auth.uid() OR r.request_hash<>fingerprint THEN RAISE EXCEPTION 'This invitation reference was already used.' USING ERRCODE='40001'; END IF;
  IF r.state='complete' THEN RETURN jsonb_build_object('complete',true,'membershipId',r.membership_id); END IF;
  IF r.lease_until>now() THEN RAISE EXCEPTION 'Invitation processing is still pending. Wait a minute and retry.' USING ERRCODE='55P03'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.committee_account_requests q WHERE q.kind='invite' AND lower(q.email)=invite_email) THEN RAISE EXCEPTION 'This email already has a committee invitation. Use its Retry or Send setup link action.' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=invite_email) THEN RAISE EXCEPTION 'This email is already registered. Existing member or staff accounts cannot be converted through an invitation.'; END IF;
  INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash) VALUES(p_request_id,'invite',auth.uid(),invite_email,p_payload,fingerprint) RETURNING * INTO r;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-request',p_request_id::text,'success',jsonb_build_object('role',p_payload->>'role','email',invite_email,'committeeSeat',p_payload->>'committeeSeat'));
 END IF;
 SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;
 IF FOUND AND ((coalesce(r.payload->>'provisioningMode','invite')<>'password' AND existing.invited_at IS NULL) OR (existing.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text
  AND (existing.raw_app_meta_data->>'role' IS NOT NULL OR existing.raw_user_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text))
  OR EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=existing.id)) THEN RAISE EXCEPTION 'The existing account does not match this invitation. Contact the system administrator.'; END IF;
 UPDATE public.committee_account_requests SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds',error=null,auth_user_id=existing.id WHERE id=r.id;
 RETURN jsonb_build_object('complete',false,'authUserId',existing.id,'payload',r.payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_finish_invite(p_request_id uuid,p_attempt_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.committee_account_requests%ROWTYPE; u auth.users%ROWTYPE; membership uuid;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request_id AND kind='invite' FOR UPDATE;
 IF r.actor_id<>auth.uid() THEN RAISE EXCEPTION 'This invitation belongs to another administrator.' USING ERRCODE='42501'; END IF;
 IF r.state='complete' THEN RETURN r.result; END IF;
 IF r.attempt_id IS DISTINCT FROM p_attempt_id OR r.lease_until<=now() THEN RAISE EXCEPTION 'Invitation processing changed. Retry the saved request.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 IF lower(u.email)<>lower(r.email) OR (coalesce(r.payload->>'provisioningMode','invite')<>'password' AND u.invited_at IS NULL) OR u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role'
  OR u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id)
  THEN RAISE EXCEPTION 'The invited account could not be verified.'; END IF;
 IF coalesce(r.payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (r.payload->>'role'='bod_member' AND r.payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'The invitation needs a valid committee position.'; END IF;
 INSERT INTO public.staff_memberships(auth_user_id,role,active,starts_at,ends_at,assigned_by,title,committee_seat,invitation_request_id,last_invite_at)
 VALUES(u.id,r.payload->>'role',true,(r.payload->>'startsAt')::timestamptz,(r.payload->>'endsAt')::timestamptz,auth.uid(),coalesce(r.payload->>'title',''),r.payload->>'committeeSeat',r.id,clock_timestamp()) RETURNING id INTO membership;
 UPDATE public.committee_account_requests SET state='complete',auth_user_id=u.id,membership_id=membership,result=jsonb_build_object('membershipId',membership),lease_until=null WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-complete',membership::text,'success',jsonb_build_object('requestId',r.id,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat'));
 RETURN jsonb_build_object('membershipId',membership);
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_change_membership(p_id uuid,p_revision integer,p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text; next_role text; next_seat text; starts timestamptz; ends timestamptz; next_active boolean; result jsonb;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_action IS NULL OR p_action NOT IN ('edit','deactivate','reactivate') OR p_payload IS NULL
  OR length(btrim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a reason for this membership change.'; END IF;
 SELECT * INTO STRICT m FROM public.staff_memberships WHERE id=p_id FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'action',p_action,'payload',p_payload,'actor',auth.uid())::text,'UTF8')),'hex');
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id;
 IF FOUND THEN IF r.request_hash=fingerprint AND r.actor_id=auth.uid() AND r.kind='membership' THEN RETURN r.result; END IF; RAISE EXCEPTION 'This request reference was already used.' USING ERRCODE='40001'; END IF;
 IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Membership changed. Reload before saving.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id FOR UPDATE;
 IF u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'This account requires manual membership reconciliation.'; END IF;
 next_role:=m.role;next_seat:=m.committee_seat;starts:=m.starts_at;ends:=m.ends_at;next_active:=m.active;
 IF p_action='edit' THEN
  next_seat:=p_payload->>'committeeSeat';
 IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;
  next_role:=p_payload->>'role';starts:=(p_payload->>'startsAt')::timestamptz;ends:=(p_payload->>'endsAt')::timestamptz;
  IF next_role IS NULL OR next_role NOT IN ('crecom_member','bod_member') OR starts IS NULL OR ends<=starts OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Choose valid membership details.'; END IF;
 ELSIF p_action='deactivate' THEN next_active:=false;
 ELSE next_active:=true; IF ends<=now() THEN RAISE EXCEPTION 'Update expired membership dates before reactivation.'; END IF;
 END IF;

 IF p_action='edit' AND p_payload ? 'name' THEN
  IF length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Enter a valid reviewer name.'; END IF;
  UPDATE auth.users SET raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('full_name',btrim(p_payload->>'name')) WHERE id=u.id;
 END IF;
 UPDATE public.staff_memberships SET role=next_role,committee_seat=next_seat,starts_at=starts,ends_at=ends,active=next_active,title=CASE WHEN p_action='edit' THEN coalesce(p_payload->>'title','') ELSE title END,revision=revision+1 WHERE id=m.id;
 IF next_role IS DISTINCT FROM m.role THEN UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}',to_jsonb(next_role)) WHERE id=u.id; END IF;
 result:=jsonb_build_object('id',m.id,'revision',m.revision+1);
 INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,state,auth_user_id,membership_id,result)
 VALUES(p_request_id,'membership',auth.uid(),u.email,p_payload,fingerprint,'complete',u.id,m.id,result);
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'committee-membership-'||p_action,m.id::text,'success',jsonb_build_object('reason',p_payload->>'reason','oldRole',m.role,'newRole',next_role,'oldSeat',m.committee_seat,'newSeat',next_seat,'active',next_active,'requestId',p_request_id));
 RETURN result;
END;
$$;

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


REVOKE ALL ON FUNCTION public.mutate_application_verification(text,text,integer,text,jsonb,uuid),public.application_workflow_action(uuid,jsonb),public.committee_route_bod(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.application_workflow_action(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.release_approved_loan(text,uuid,date,text,numeric,text),public.loan_release_action(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loan_release_action(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.resubmit_returned_loan(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resubmit_returned_loan(text,uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.submit_missing_application_document(text,text,text,text,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_missing_application_document(text,text,text,text,text,bigint) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
