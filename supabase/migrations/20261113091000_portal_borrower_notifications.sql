-- Normalize future borrower notices only. Historical messages are preserved.
BEGIN;
ALTER TABLE public.individual_review_decisions ADD COLUMN member_reason text;
CREATE FUNCTION public.portal_member_decision_reason() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.decision='reject' THEN NEW.member_reason:=NEW.reason;END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER portal_member_decision_reason BEFORE INSERT ON public.individual_review_decisions FOR EACH ROW EXECUTE FUNCTION public.portal_member_decision_reason();

CREATE FUNCTION public.portal_prepare_borrower_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app public.loan_applications%ROWTYPE;activity public.portal_activity_events%ROWTYPE;review_event public.committee_review_events%ROWTYPE;cycle public.application_review_cycles%ROWTYPE;
 action text;reason text;document_kind text;total integer;approved integer;title text;message text;legacy_return boolean:=false;
BEGIN
 IF NEW.user_id IS NULL OR EXISTS(SELECT 1 FROM auth.users WHERE id=NEW.user_id AND raw_app_meta_data->>'role' IN ('super_admin','admin','crecom_member','bod_member')) THEN RETURN NEW;END IF;
 IF NEW.data->>'activityEventId' IS NOT NULL THEN SELECT * INTO activity FROM public.portal_activity_events WHERE id::text=NEW.data->>'activityEventId';END IF;
 SELECT a.* INTO app FROM public.loan_applications a JOIN public.members m ON m.id=a.member_id
 WHERE m.user_id=NEW.user_id AND (a.application_id=NEW.data->>'entityKey' OR a.application_id=split_part(NEW.message,':',1)) LIMIT 1;
 IF app.id IS NULL THEN RETURN NEW;END IF;
 action:=coalesce(NEW.data->>'event',NEW.data->>'action');
 IF action IS NULL AND NEW.title ILIKE '%return%' THEN action:='verification_return';legacy_return:=true;END IF;
 IF action='loan_under_review' AND current_setting('coop.verifying_and_routing',true)='true' THEN RETURN NULL;END IF;
 IF action IN ('verification_save_draft','document_uploaded','document_version_uploaded') THEN RETURN NULL;END IF;
 IF action='loan_submitted' THEN title:='Application received';message:=format('Your %s application %s has been received and is awaiting requirements review.',app.loan_type,app.application_id);
 ELSIF action IN ('verification_start','loan_under_review') THEN title:='Requirements review started';message:=format('We are reviewing the requirements for application %s. We will notify you if any information or documents need attention.',app.application_id);
 ELSIF action='verification_resubmit' THEN title:='Updates received';message:=format('We received your updates for application %s. Your corrected requirements are awaiting review.',app.application_id);
 ELSIF action='verification_mark_verified' THEN title:='Requirements verified';message:=format('Your requirements for application %s have been verified. Your application is now awaiting CRECOM review. Final approval and release are still pending.',app.application_id);
 ELSIF action='verification_return' THEN
  IF legacy_return THEN reason:=substring(NEW.message from length(app.application_id)+3);ELSE SELECT details->>'reason' INTO reason FROM public.application_workflow_events WHERE application_id=app.id AND action='return' ORDER BY created_at DESC LIMIT 1;END IF;
  title:='Application returned for correction';message:=format('Application %s needs corrections before review can continue. Required changes: %s. Update and resubmit the same application through the app.',app.application_id,coalesce(reason,split_part(NEW.message,':',2)));
 ELSIF action IN ('document_reviewed','document_verified','document_needs_replacement') THEN
  SELECT r.reason,d.kind INTO reason,document_kind FROM public.loan_document_reviews r JOIN public.loan_documents d ON d.id=r.document_id WHERE r.id::text=split_part(activity.source_key,':',2) AND r.status='needs_replacement';
  IF document_kind IS NULL THEN RETURN NULL;END IF;
  title:='Document replacement required';message:=format('Please replace your %s for application %s. Reason: %s. Open the app to upload a replacement.',CASE document_kind WHEN 'validId' THEN 'Valid ID' WHEN 'payslip' THEN 'Pay Slip' WHEN 'collateral' THEN 'Collateral Document' ELSE 'Supporting Document' END,app.application_id,reason);
 ELSIF action IN ('committee_approve','committee_reject') THEN
  SELECT * INTO review_event FROM public.committee_review_events WHERE id::text=split_part(activity.source_key,':',2);
  SELECT * INTO cycle FROM public.application_review_cycles WHERE id=review_event.cycle_id;
  IF cycle.id IS NULL THEN RETURN NEW;END IF;
  SELECT count(*) FILTER(WHERE d.decision='approve'),count(*) INTO approved,total FROM public.review_assignments x JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=cycle.id AND x.state='decision_recorded';
  IF action='committee_reject' THEN
   SELECT d.member_reason INTO reason FROM public.individual_review_decisions d WHERE d.assignment_id=review_event.assignment_id;
   title:=cycle.stage||' review requires attention';message:=format('%s did not approve application %s. %s Your application cannot proceed to approval or release while this decision remains unresolved. We will notify you of the next step.',CASE WHEN cycle.stage='BOD' THEN 'BOD' ELSE 'A CRECOM reviewer' END,app.application_id,CASE WHEN reason IS NOT NULL THEN 'Reason: '||reason||'.' ELSE 'Open the app to review the available decision details.' END);
  ELSIF cycle.stage='BOD' THEN title:='BOD review complete';message:=format('BOD approved application %s. Your application is awaiting the Super Admin’s final decision.',app.application_id);
  ELSIF approved=3 THEN title:='CRECOM review complete';message:=format('All three CRECOM reviewers approved application %s. Your application is now awaiting BOD review.',app.application_id);
  ELSE title:=format('CRECOM review update: %s of 3 approved',approved);message:=format('A CRECOM reviewer approved application %s. %s of 3 required approvals are recorded.',app.application_id,approved);END IF;
 ELSIF action='loan_released' THEN title:='Loan released';message:=format('Your loan under application %s was released on %s. Net proceeds: ₱%s. View your release details and repayment schedule in the app.',app.application_id,app.date_released,to_char(app.amount-coalesce(app.processing_fee_amount_at_release,0)-coalesce(app.service_fee_amount_at_release,0),'FM999999999990.00'));
 END IF;
 IF title IS NOT NULL THEN NEW.title:=title;NEW.message:=message;END IF;
 NEW.data:=coalesce(NEW.data,'{}')||jsonb_build_object('category',coalesce(NEW.data->>'category','loans'),'entityType','application','entityKey',app.application_id,'applicationId',app.id,'event',coalesce(action,'application_update'),'emailHandledByReturn',legacy_return);
 RETURN NEW;
END;
$$;
CREATE TRIGGER portal_prepare_borrower_notice BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.portal_prepare_borrower_notice();

CREATE UNIQUE INDEX portal_email_notification_unique ON public.application_email_outbox(notification_id) WHERE notification_id IS NOT NULL;
ALTER TABLE public.application_email_outbox ADD COLUMN lease_id uuid,ADD COLUMN locked_at timestamptz,ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN provider_message_id text,ADD COLUMN application_snapshot jsonb,ADD COLUMN delivery_payload jsonb,ADD COLUMN first_attempt_at timestamptz;
CREATE FUNCTION public.portal_capture_email_context() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 SELECT jsonb_build_object('application_id',a.application_id,'member_name',a.member_name,'loan_type',a.loan_type,'status',a.status) INTO NEW.application_snapshot FROM public.loan_applications a WHERE a.id=NEW.application_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER portal_capture_email_context BEFORE INSERT ON public.application_email_outbox FOR EACH ROW EXECUTE FUNCTION public.portal_capture_email_context();
CREATE FUNCTION public.portal_queue_borrower_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app public.loan_applications%ROWTYPE;email text;member_auth uuid;
BEGIN
 IF NEW.user_id IS NULL OR NEW.data->>'entityType'<>'application' OR coalesce((NEW.data->>'emailHandledByReturn')::boolean,false) THEN RETURN NEW;END IF;
 SELECT a.* INTO app FROM public.loan_applications a JOIN public.members m ON m.id=a.member_id WHERE a.application_id=NEW.data->>'entityKey' AND m.user_id=NEW.user_id;
 IF app.id IS NULL THEN RETURN NEW;END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=NEW.user_id AND u.email_confirmed_at IS NOT NULL;
 IF email IS NULL THEN RETURN NEW;END IF;
 INSERT INTO public.application_email_outbox(application_id,member_auth_id,recipient_email,subject,message,request_id,notification_id)
 VALUES(app.id,NEW.user_id,email,NEW.title,NEW.message,NEW.id,NEW.id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END;
$$;
CREATE TRIGGER portal_queue_borrower_email AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.portal_queue_borrower_email();

-- Lease jobs to a server-only worker; retry only delivery, never the loan action.
CREATE FUNCTION public.portal_claim_email_jobs(p_limit integer DEFAULT 20) RETURNS SETOF public.application_email_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose a valid email batch size.';END IF;
 UPDATE public.application_email_outbox SET status='failed',last_error='Delivery confirmation expired. Review provider history before retrying.'
 WHERE status IN ('sending','queued') AND first_attempt_at<now()-interval '23 hours';
 UPDATE public.application_email_outbox o SET status='failed',last_error='Recipient email is not currently verified for this member.' WHERE status IN ('queued','sending') AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=o.member_auth_id AND lower(u.email)=lower(o.recipient_email) AND u.email_confirmed_at IS NOT NULL);
 RETURN QUERY WITH ready AS (SELECT id FROM public.application_email_outbox WHERE
  (status='queued' AND next_attempt_at<=now() OR status='sending' AND locked_at<now()-interval '10 minutes') AND attempts<6
  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT p_limit)
 UPDATE public.application_email_outbox o SET status='sending',lease_id=gen_random_uuid(),locked_at=now(),attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),application_snapshot=coalesce(o.application_snapshot,(SELECT jsonb_build_object('application_id',a.application_id,'member_name',a.member_name,'loan_type',a.loan_type,'status',a.status) FROM public.loan_applications a WHERE a.id=o.application_id))
 FROM ready WHERE o.id=ready.id RETURNING o.*;
END;
$$;
CREATE FUNCTION public.portal_prepare_email_payload(p_id uuid,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>200000 THEN RAISE EXCEPTION 'Choose a valid email payload.';END IF;
 UPDATE public.application_email_outbox SET delivery_payload=coalesce(delivery_payload,p_payload)
 WHERE id=p_id AND lease_id=p_lease AND status='sending' AND p_payload->'to'=jsonb_build_array(recipient_email) RETURNING delivery_payload INTO output;
 IF output IS NULL THEN RAISE EXCEPTION 'Email delivery lease changed.' USING ERRCODE='40001';END IF;RETURN output;
END;
$$;
CREATE FUNCTION public.portal_finish_email_job(p_id uuid,p_lease uuid,p_success boolean,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
 IF p_success AND nullif(btrim(p_provider_id),'') IS NULL THEN RAISE EXCEPTION 'Provider acceptance must be confirmed before marking sent.';END IF;
 UPDATE public.application_email_outbox SET status=CASE WHEN p_success THEN 'sent' WHEN attempts>=6 THEN 'failed' ELSE 'queued' END,
 sent_at=CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,provider_message_id=CASE WHEN p_success THEN left(p_provider_id,200) ELSE provider_message_id END,
 last_error=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Email provider unavailable'),500) END,
 next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::integer)),lease_id=NULL
 WHERE id=p_id AND lease_id=p_lease AND status='sending';GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_member_decision_reason(),public.portal_prepare_borrower_notice(),public.portal_queue_borrower_email(),public.portal_capture_email_context(),public.portal_claim_email_jobs(integer),public.portal_prepare_email_payload(uuid,uuid,jsonb),public.portal_finish_email_job(uuid,uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_claim_email_jobs(integer),public.portal_prepare_email_payload(uuid,uuid,jsonb),public.portal_finish_email_job(uuid,uuid,boolean,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.portal_record_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; old_data jsonb; category text; action text; title text; message text; entity_type text; entity_key text;
 app public.loan_applications%ROWTYPE; member_row public.members%ROWTYPE; cycle public.application_review_cycles%ROWTYPE;
 assignment public.review_assignments%ROWTYPE; event_id uuid; actor uuid:=auth.uid(); owner uuid; owner_message text; sa_only boolean:=false;
 source text; label text; count_value integer; target integer; person record; notice uuid; actor_label text;
BEGIN
 row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 old_data:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 source:=TG_TABLE_NAME||':'||(row_data->>'id');
 IF TG_OP='DELETE' THEN source:=source||':delete:'||txid_current(); END IF;
 -- For updates use both row snapshots, rather than volatile updated_at values.
 IF TG_OP='UPDATE' THEN source:=TG_TABLE_NAME||':'||((row_data->>'id'))||':update:'||txid_current()||':'||md5((old_data::text)||row_data::text); END IF;
 IF TG_TABLE_NAME='members' THEN
  category:='accounts';entity_type:='member';entity_key:=coalesce((row_data->>'member_id'),(row_data->>'id'));
  label:=left(btrim(concat_ws(' ',(row_data->>'first_name'),(row_data->>'last_name'))),160);
  IF TG_OP='INSERT' THEN action:='account_created';title:=CASE WHEN lower(coalesce((row_data->>'status'),''))='pending' THEN 'Member account awaiting approval' ELSE 'Account created' END;
   message:=label||' · '||entity_key||' · Status: '||coalesce((row_data->>'status'),'pending')||'.';
   owner:=((row_data->>'user_id'))::uuid;owner_message:='Your account request was received. Current status: '||coalesce((row_data->>'status'),'pending')||'.';
  ELSIF TG_OP='DELETE' THEN action:='account_deleted';title:='Account removed';message:=label||' · '||entity_key||' was removed.';
  ELSIF (row_data->>'status') IS DISTINCT FROM (old_data->>'status') THEN action:='account_status_changed';title:='Account status updated';message:=label||' · '||entity_key||': '||coalesce((old_data->>'status'),'not set')||' → '||coalesce((row_data->>'status'),'not set')||'.';
   owner:=((row_data->>'user_id'))::uuid;owner_message:='Your account status changed to '||coalesce((row_data->>'status'),'not set')||'.';
  ELSIF ((row_data->>'role'),(row_data->>'membership_type'),(row_data->>'first_name'),(row_data->>'last_name'),(row_data->>'email'),(row_data->>'phone'),(row_data->>'address'),(row_data->>'department')) IS DISTINCT FROM
    ((old_data->>'role'),(old_data->>'membership_type'),(old_data->>'first_name'),(old_data->>'last_name'),(old_data->>'email'),(old_data->>'phone'),(old_data->>'address'),(old_data->>'department')) THEN action:='account_updated';title:='Account details updated';message:=label||' · '||entity_key||' account details were updated.';
  ELSE RETURN NEW; END IF;
  actor:=coalesce(actor,((row_data->>'created_by'))::uuid,((row_data->>'user_id'))::uuid);
 ELSIF TG_TABLE_NAME='loan_applications' THEN
  category:='loans';entity_type:='application';entity_key:=(row_data->>'application_id');
  SELECT * INTO member_row FROM public.members WHERE id=((row_data->>'member_id'))::uuid;
  IF TG_OP='INSERT' THEN action:='loan_submitted';title:='New loan application';message:=coalesce((row_data->>'member_name'),'Member')||' submitted '||entity_key||' · '||coalesce((row_data->>'loan_type'),'Loan')||'.';
   owner:=member_row.user_id;owner_message:=entity_key||': Your loan application was received.';actor:=coalesce(actor,owner);
  ELSIF (row_data->>'status') IS DISTINCT FROM (old_data->>'status') THEN
   IF (row_data->>'status') IN ('approved','rejected') AND EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=((row_data->>'id'))::uuid) THEN RETURN NEW; END IF;
   action:='loan_'||replace(coalesce((row_data->>'status'),'updated'),' ','_');title:='Loan status updated';message:=entity_key||' · '||coalesce((row_data->>'member_name'),'Member')||': '||coalesce((old_data->>'status'),'pending')||' → '||coalesce((row_data->>'status'),'updated')||'.';
   IF (row_data->>'status') IN ('under review','approved','released','overdue','completed') THEN owner:=member_row.user_id;owner_message:=entity_key||': Your loan status is now '||(row_data->>'status')||'.'; END IF;
  ELSIF ((row_data->>'amount'),(row_data->>'tenure_months'),(row_data->>'purpose'),(row_data->>'co_maker_member_id')) IS DISTINCT FROM ((old_data->>'amount'),(old_data->>'tenure_months'),(old_data->>'purpose'),(old_data->>'co_maker_member_id')) THEN
   action:='loan_updated';title:='Loan application updated';message:=entity_key||' · Application details were updated.';
  ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME IN ('loan_documents','loan_document_versions','loan_document_reviews') THEN
  category:='documents';entity_type:='application';
  IF TG_TABLE_NAME='loan_documents' THEN SELECT * INTO app FROM public.loan_applications WHERE id=((row_data->>'loan_application_id'))::uuid;action:='document_uploaded';title:='Member document uploaded';label:=(row_data->>'kind');actor:=coalesce(actor,((row_data->>'user_id'))::uuid);
  ELSE SELECT a.* INTO app FROM public.loan_documents d JOIN public.loan_applications a ON a.id=d.loan_application_id WHERE d.id=((row_data->>'document_id'))::uuid;
   SELECT kind INTO label FROM public.loan_documents WHERE id=((row_data->>'document_id'))::uuid;
   IF TG_TABLE_NAME='loan_document_versions' THEN action:='document_replaced';title:='Replacement document uploaded';actor:=coalesce(actor,((row_data->>'uploaded_by'))::uuid);
   ELSE action:='document_reviewed';title:=CASE WHEN (row_data->>'status')='verified' THEN 'Document verified' ELSE 'Document replacement requested' END;actor:=coalesce(actor,((row_data->>'reviewer_id'))::uuid);END IF;
  END IF;
  entity_key:=app.application_id;message:=entity_key||' · '||coalesce(label,'Supporting document')||' · '||title||'.';
  IF TG_TABLE_NAME='loan_document_reviews' THEN SELECT user_id INTO owner FROM public.members WHERE id=app.member_id;owner_message:=entity_key||': '||coalesce(label,'Supporting document')||' · '||title||'.';IF (row_data->>'status')='needs_replacement' THEN owner_message:=owner_message||' '||coalesce(row_data->>'reason','');END IF;END IF;
 ELSIF TG_TABLE_NAME='application_workflow_events' THEN
  SELECT * INTO app FROM public.loan_applications WHERE id=((row_data->>'application_id'))::uuid;
  category:='loans';entity_type:='application';entity_key:=app.application_id;action:='verification_'||(row_data->>'action');title:='Application verification updated';message:=entity_key||' · '||replace((row_data->>'action'),'_',' ')||'.';actor:=((row_data->>'actor_id'))::uuid;
  IF row_data->>'action' IN ('mark_verified','resubmit') OR (row_data->>'action'='start' AND current_setting('coop.verifying_and_routing',true) IS DISTINCT FROM 'true') THEN
   SELECT user_id INTO owner FROM public.members WHERE id=app.member_id;owner_message:=entity_key||': Application review updated.';
  END IF;
 ELSIF TG_TABLE_NAME='committee_review_events' THEN
  SELECT * INTO app FROM public.loan_applications WHERE id=((row_data->>'application_id'))::uuid;
  SELECT * INTO cycle FROM public.application_review_cycles WHERE id=((row_data->>'cycle_id'))::uuid;
  SELECT * INTO assignment FROM public.review_assignments WHERE id=((row_data->>'assignment_id'))::uuid;
  category:='approvals';entity_type:='application';entity_key:=app.application_id;action:='committee_'||(row_data->>'action');actor:=((row_data->>'actor_id'))::uuid;
  label:=CASE assignment.signatory_role WHEN 'crecom_member' THEN 'CRECOM Member' WHEN 'crecom_chairperson' THEN 'CRECOM Chairperson' WHEN 'bod_chairperson' THEN 'BOD Chairperson' ELSE coalesce(cycle.stage,'Staff') END;
  title:=CASE (row_data->>'action') WHEN 'approve' THEN label||' approval recorded' WHEN 'reject' THEN label||' rejection recorded' WHEN 'clarify' THEN label||' requested clarification' WHEN 'recuse' THEN label||' recused from review' WHEN 'forward' THEN 'Application sent to CRECOM' WHEN 'forward_bod' THEN 'Application sent to BOD' WHEN 'finalize' THEN 'Final loan decision recorded' WHEN 'reply' THEN 'Reviewer clarification answered' WHEN 'reassign' THEN 'Committee reviewer reassigned' ELSE 'Application returned to verification' END;
  message:=entity_key||' · '||coalesce((row_data->>'actor_name'),label)||' · '||title||'.';
  IF (row_data->>'action') IN ('approve','reject') THEN
   SELECT count(*) FILTER(WHERE d.decision='approve') INTO count_value FROM public.review_assignments x JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=cycle.id AND x.state='decision_recorded';
   message:=message||format(' %s of %s %s approvals.',count_value,cycle.reviewer_target,cycle.stage);
   SELECT user_id INTO owner FROM public.members WHERE id=app.member_id;
   owner_message:=entity_key||format(': %s review progress updated. %s of %s approvals recorded.',cycle.stage,count_value,cycle.reviewer_target);
  ELSIF (row_data->>'action')='finalize' THEN message:=message||' Outcome: '||coalesce((row_data->'result'->>'stage'),'recorded')||'.';END IF;
 ELSIF TG_TABLE_NAME='loan_payments' THEN
  IF TG_OP='UPDATE' AND (row_data->>'payment_status') IS NOT DISTINCT FROM (old_data->>'payment_status') THEN RETURN NEW; END IF;
  SELECT * INTO app FROM public.loan_applications WHERE id=((row_data->>'loan_application_id'))::uuid;
  category:='payments';entity_type:='active_loan';entity_key:=app.application_id;action:='payment_'||coalesce((row_data->>'payment_status'),'posted');title:=CASE WHEN (row_data->>'payment_status')='reversed' THEN 'Loan payment reversed' ELSE 'Loan payment recorded' END;
  message:=entity_key||' · '||coalesce(app.member_name,'Member')||' · '||title||' · Receipt '||coalesce((row_data->>'receipt_number'),'not specified')||'.';actor:=coalesce(((row_data->>'reversed_by'))::uuid,((row_data->>'recorded_by'))::uuid,actor);
 SELECT user_id INTO owner FROM public.members WHERE id=app.member_id;owner_message:=entity_key||': '||title||' · Amount ₱'||coalesce(row_data->>'payment_amount','0')||'.';
 ELSIF TG_TABLE_NAME='shared_documents' THEN
  IF TG_OP='UPDATE' AND ((row_data->>'status'),(row_data->>'deleted_at'),(row_data->>'title')) IS NOT DISTINCT FROM ((old_data->>'status'),(old_data->>'deleted_at'),(old_data->>'title')) THEN RETURN NEW; END IF;
  category:='documents';entity_type:='documents';entity_key:=(row_data->>'id');action:=CASE WHEN (row_data->>'deleted_at') IS NOT NULL THEN 'shared_document_deleted' ELSE 'shared_document_'||coalesce((row_data->>'status'),'uploaded') END;title:='Cooperative document updated';message:=left((row_data->>'title'),160)||' · '||replace(action,'_',' ')||'.';actor:=coalesce(actor,((row_data->>'created_by'))::uuid);
 ELSIF TG_TABLE_NAME='announcements' THEN
  IF TG_OP='UPDATE' AND ((row_data->>'status'),(row_data->>'title')) IS NOT DISTINCT FROM ((old_data->>'status'),(old_data->>'title')) THEN RETURN NEW;END IF;
  category:='announcements';entity_type:='announcements';entity_key:=(row_data->>'id');action:='announcement_'||CASE WHEN TG_OP='DELETE' THEN 'deleted' ELSE coalesce((row_data->>'status'),'updated') END;title:='Announcement updated';message:=left((row_data->>'title'),160)||' · '||replace(action,'_',' ')||'.';
 ELSIF TG_TABLE_NAME='admin_activity_logs' THEN
  label:=(row_data->>'action_name');
  IF label LIKE 'security-verify:%' THEN RETURN NEW; END IF;
  IF (row_data->>'result')='success' AND (label LIKE 'committee-review-%' OR label LIKE 'application-verification-%' OR label LIKE 'document-%' OR label LIKE '%loan-document%' OR label LIKE 'announcement-%' OR label IN ('review-document','share-document','save-document-draft','publish-document','delete-shared-document','create-announcement','edit-announcement','delete-announcement','create-account','edit-account','delete-account','activate-account','block-account','unblock-account','approve-loan','reject-loan','review-loan','release-loan','record-counter-payment','reverse-counter-payment')) THEN RETURN NEW; END IF;
  category:=CASE WHEN label ~ '(account|membership|password|role|privilege|own-profile|own-setup|invite|setup-link)' THEN 'accounts' WHEN label ~ '(document|shared-upload)' THEN 'documents' WHEN label ~ '(announcement)' THEN 'announcements' WHEN label ~ '(application|workflow)' THEN 'approvals' ELSE 'system' END;
  sa_only:=category='system' OR (row_data->>'result')<>'success' OR label ~ '(password|privilege|role|security|link|invite)';action:=label;entity_type:=CASE category WHEN 'accounts' THEN 'accounts' WHEN 'documents' THEN 'documents' WHEN 'announcements' THEN 'announcements' WHEN 'approvals' THEN 'applications' ELSE 'system' END;entity_key:=coalesce((row_data->>'target_id'),'');
  title:=CASE WHEN (row_data->>'result')='success' THEN 'System activity recorded' ELSE 'System action needs attention' END;
  message:=initcap(replace(replace(label,'-',' '),'_',' '))||' · Result: '||coalesce((row_data->>'result'),'recorded')||'.';actor:=((row_data->>'actor_id'))::uuid;
 ELSE RETURN coalesce(NEW,OLD); END IF;
 IF category IS NULL OR message IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
 event_id:=public.portal_emit_activity(source,category,action,title,message,entity_type,entity_key,actor,owner,owner_message,sa_only);
 IF event_id IS NOT NULL AND TG_TABLE_NAME='committee_review_events' AND (row_data->>'action') IN ('approve','reject') THEN
  FOR person IN SELECT x.id,x.reviewer_auth_id FROM public.review_assignments x WHERE x.review_cycle_id=cycle.id AND x.state NOT IN ('reassigned','cancelled') AND public.committee_reviewer_available(x.membership_id,app.id,cycle.stage) LOOP
   INSERT INTO public.notifications(user_id,title,message,type,read,data) VALUES(person.reviewer_auth_id,'Assigned application review updated',entity_key||format(' · %s of %s %s approvals recorded.',count_value,cycle.reviewer_target,cycle.stage),'info',false,
    jsonb_build_object('activityEventId',event_id,'category','approvals','entityType','assignment','entityKey',person.id)) RETURNING id INTO notice;
   INSERT INTO public.committee_notification_links(notification_id,assignment_id) VALUES(notice,person.id);
  END LOOP;
 END IF;
 RETURN coalesce(NEW,OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_emit_activity(p_source text,p_category text,p_action text,p_title text,p_message text,p_entity_type text,p_entity_key text,
 p_actor uuid DEFAULT NULL,p_owner uuid DEFAULT NULL,p_owner_message text DEFAULT NULL,p_super_admin_only boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_id uuid; actor_name text; actor_role text; actor uuid:=coalesce(p_actor,auth.uid()); metadata jsonb;
BEGIN
 SELECT left(coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),u.email,'User'),160),coalesce(u.raw_app_meta_data->>'role','member') INTO actor_name,actor_role FROM auth.users u WHERE u.id=actor;
 actor_name:=coalesce(actor_name,'System');actor_role:=coalesce(actor_role,'system');
 INSERT INTO public.portal_activity_events(source_key,category,action,entity_type,entity_key,actor_id,actor_name,actor_role,title,message,super_admin_only)
 VALUES(p_source,p_category,p_action,p_entity_type,left(coalesce(p_entity_key,''),200),actor,actor_name,actor_role,left(p_title,200),left(p_message,2000),p_super_admin_only)
 ON CONFLICT(source_key) DO NOTHING RETURNING id INTO event_id;
 IF event_id IS NULL THEN RETURN NULL; END IF;
 IF p_action='verification_save_draft' THEN RETURN event_id;END IF;
 metadata:=jsonb_build_object('activityEventId',event_id,'category',p_category,'action',p_action,'entityType',p_entity_type,'entityKey',p_entity_key,'actorName',actor_name,'actorRole',actor_role);
 INSERT INTO public.notifications(user_id,title,message,type,read,data)
 SELECT u.id,left(p_title,200),left(p_message,2000),CASE WHEN p_action LIKE '%reject%' OR p_action LIKE '%fail%' OR p_action LIKE '%overdue%' THEN 'warning' ELSE 'info' END,false,metadata
 FROM auth.users u WHERE u.raw_app_meta_data->>'role' IN ('super_admin','admin','coop_admin')
  AND (NOT p_super_admin_only OR u.raw_app_meta_data->>'role'='super_admin') AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND NOT EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=u.id AND m.status IS DISTINCT FROM 'active');
 IF p_owner IS NOT NULL AND p_owner_message IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner AND coalesce(raw_app_meta_data->>'account_status','active')='active' AND (banned_until IS NULL OR banned_until<=now())) THEN
  INSERT INTO public.notifications(user_id,title,message,type,read,data) VALUES(p_owner,left(p_title,200),left(p_owner_message,2000),'info',false,
   jsonb_build_object('activityEventId',event_id,'category',p_category,'action',p_action,'entityType',p_entity_type,'entityKey',p_entity_key))
  ON CONFLICT ((data->>'activityEventId'),user_id) WHERE data->>'activityEventId' IS NOT NULL DO NOTHING;
 END IF;
 RETURN event_id;
END;
$$;

CREATE FUNCTION public.portal_application_delivery(p_application_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE app_id uuid;output jsonb;
BEGIN
 IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501';END IF;
 SELECT id INTO STRICT app_id FROM public.loan_applications WHERE application_id=p_application_id;
 SELECT jsonb_build_object('queued',count(*) FILTER(WHERE status IN ('queued','sending')),'sent',count(*) FILTER(WHERE status='sent'),'failed',count(*) FILTER(WHERE status='failed')) INTO output FROM public.application_email_outbox WHERE application_id=app_id;
 RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_application_delivery(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_application_delivery(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
