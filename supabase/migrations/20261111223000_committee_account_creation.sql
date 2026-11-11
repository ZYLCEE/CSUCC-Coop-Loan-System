-- Repair committee provisioning and preserve explicit numbered approval positions.
BEGIN;
ALTER TABLE public.staff_memberships ADD COLUMN member_number smallint;
ALTER TABLE public.staff_memberships ADD CONSTRAINT committee_numbered_position CHECK(member_number IS NULL OR (role='crecom_member' AND committee_seat='member' AND member_number IN (1,2)));
ALTER TABLE public.review_assignments ADD COLUMN member_number smallint CHECK(member_number IS NULL OR member_number IN (1,2));
ALTER TABLE public.individual_review_decisions ADD COLUMN member_number smallint CHECK(member_number IS NULL OR member_number IN (1,2));
CREATE TABLE public.committee_profile_archive(profile_id uuid PRIMARY KEY,auth_user_id uuid NOT NULL,request_id uuid NOT NULL,profile jsonb NOT NULL,archived_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.committee_profile_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_profile_archive FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.committee_profile_archive TO service_role;
CREATE FUNCTION public.committee_archive_auto_profile(p_user uuid,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u auth.users%ROWTYPE;r public.committee_account_requests%ROWTYPE;m public.members%ROWTYPE;dependency record;linked boolean;column_name text;
BEGIN
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request;
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO m FROM public.members WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF r.kind<>'invite' OR r.state='complete' OR lower(u.email)<>lower(r.email) OR lower(m.email) IS DISTINCT FROM lower(u.email)
  OR (u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text AND u.raw_user_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text)
  OR (u.raw_app_meta_data->>'role' IS NOT NULL AND u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role')
  OR abs(extract(epoch FROM m.created_at-u.created_at))>5 OR m.role IS NOT NULL OR m.membership_type IS NOT NULL
  OR nullif(m.phone,'') IS NOT NULL OR nullif(m.address,'') IS NOT NULL OR m.income IS NOT NULL OR nullif(m.department,'') IS NOT NULL OR m.created_by IS NOT NULL
  OR m.in_person_identity_verified OR m.must_change_password OR m.status<>'active' OR m.credit_score IS DISTINCT FROM 700
  OR m.first_name IS DISTINCT FROM coalesce(u.raw_user_meta_data->>'first_name',split_part(coalesce(u.email,'Member'),'@',1))
  OR m.last_name IS DISTINCT FROM coalesce(u.raw_user_meta_data->>'last_name','')
  OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id) THEN RAISE EXCEPTION 'A genuine member or staff profile is linked to this email. Use a separate committee email or ask the system administrator to reconcile the account.';END IF;
 FOR dependency IN SELECT conrelid,conkey FROM pg_constraint WHERE contype='f' AND confrelid='public.members'::regclass LOOP
  IF cardinality(dependency.conkey)<>1 THEN RAISE EXCEPTION 'A linked profile requires manual reconciliation.';END IF;
  SELECT attname INTO column_name FROM pg_attribute WHERE attrelid=dependency.conrelid AND attnum=dependency.conkey[1];
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',dependency.conrelid::regclass,column_name) INTO linked USING m.id;
  IF linked THEN RAISE EXCEPTION 'This email has linked member records. No member data was changed. Use a separate committee email.';END IF;
 END LOOP;
 INSERT INTO public.committee_profile_archive(profile_id,auth_user_id,request_id,profile) VALUES(m.id,u.id,r.id,to_jsonb(m));
 DELETE FROM public.members WHERE id=m.id AND user_id=u.id;
END;
$$;
REVOKE ALL ON FUNCTION public.committee_archive_auto_profile(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.committee_snapshot_member_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='review_assignments' THEN SELECT member_number INTO NEW.member_number FROM public.staff_memberships WHERE id=NEW.membership_id;
 ELSE SELECT member_number INTO NEW.member_number FROM public.review_assignments WHERE id=NEW.assignment_id;END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.committee_snapshot_member_number() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snapshot_review_member_number BEFORE INSERT ON public.review_assignments FOR EACH ROW EXECUTE FUNCTION public.committee_snapshot_member_number();
CREATE TRIGGER snapshot_decision_member_number BEFORE INSERT ON public.individual_review_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_snapshot_member_number();
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  base_member_id TEXT;
BEGIN
  -- A reviewer is not a borrower. Only a trusted role or a matching service-only
  -- invitation reservation may bypass the normal member-profile trigger.
  IF NEW.raw_app_meta_data->>'role' IN ('crecom_member','bod_member') OR EXISTS(
    SELECT 1 FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state='pending'
    AND r.id::text=NEW.raw_user_meta_data->>'committee_invitation_request_id'
    AND lower(r.email)=lower(NEW.email) AND r.payload->>'role' IN ('crecom_member','bod_member')) THEN RETURN NEW;END IF;
  base_member_id := 'M-' || upper(substr(replace(NEW.id::TEXT, '-', ''), 1, 8));

  INSERT INTO public.members (user_id, member_id, first_name, last_name, email)
  VALUES (
    NEW.id,
    base_member_id,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', split_part(COALESCE(NEW.email, 'Member'), '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name', ''),
    NEW.email
  )
  ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.portal_record_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE row_data jsonb; old_data jsonb; category text; action text; title text; message text; entity_type text; entity_key text;
 app public.loan_applications%ROWTYPE; member_row public.members%ROWTYPE; cycle public.application_review_cycles%ROWTYPE;
 assignment public.review_assignments%ROWTYPE; event_id uuid; actor uuid:=auth.uid(); owner uuid; owner_message text; sa_only boolean:=false;
 source text; label text; count_value integer; target integer; person record; notice uuid; actor_label text;
BEGIN
 IF TG_TABLE_NAME='members' AND TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.committee_profile_archive WHERE profile_id=OLD.id AND auth_user_id=OLD.user_id) THEN RETURN OLD;END IF;
 END IF;
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
$function$;
CREATE OR REPLACE FUNCTION public.committee_reserve_invite(p_request_id uuid, p_attempt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.committee_account_requests%ROWTYPE; existing auth.users%ROWTYPE; fingerprint text; invite_email text:=lower(btrim(p_payload->>'email')); start_date timestamptz; end_date timestamptz;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 OR length(coalesce(invite_email,'')) NOT BETWEEN 3 AND 254 OR invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  OR coalesce(p_payload->>'role','') NOT IN ('crecom_member','bod_member') OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Enter valid committee account details.'; END IF;

 IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;
 IF p_payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD membership requires an approved policy enabling the BOD stage.'; END IF;
 IF p_payload->>'role'='crecom_member' AND p_payload->>'committeeSeat'='member' AND coalesce(p_payload->>'committeeMemberNumber','') NOT IN ('1','2') THEN RAISE EXCEPTION 'Choose CRECOM Member 1 or CRECOM Member 2.';END IF;
 start_date:=(p_payload->>'startsAt')::timestamptz;end_date:=(p_payload->>'endsAt')::timestamptz;
 IF start_date IS NULL OR (end_date IS NOT NULL AND end_date<=start_date) THEN RAISE EXCEPTION 'Choose valid membership dates.'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'payload',p_payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('committee-invite:'||invite_email,0));
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  -- A failed legacy request may acquire its missing numbered position once.
  -- Every other detail, owner and the original request reference remain fixed.
  IF r.kind='invite' AND r.actor_id=auth.uid() AND r.state='failed' AND NOT (r.payload ? 'committeeMemberNumber') AND (r.payload-'committeeMemberNumber')=(p_payload-'committeeMemberNumber') THEN
   UPDATE public.committee_account_requests SET payload=p_payload,request_hash=fingerprint WHERE id=r.id RETURNING * INTO r;
  END IF;
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
 IF existing.id IS NOT NULL THEN PERFORM public.committee_archive_auto_profile(existing.id,r.id);END IF;
 IF FOUND AND ((coalesce(r.payload->>'provisioningMode','invite')<>'password' AND existing.invited_at IS NULL) OR (existing.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text
  AND (existing.raw_app_meta_data->>'role' IS NOT NULL OR existing.raw_user_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text))
  OR EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=existing.id)) THEN RAISE EXCEPTION 'The existing account does not match this invitation. Contact the system administrator.'; END IF;
 UPDATE public.committee_account_requests SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds',error=null,auth_user_id=existing.id WHERE id=r.id;
 RETURN jsonb_build_object('complete',false,'authUserId',existing.id,'payload',r.payload);
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_finish_invite(p_request_id uuid, p_attempt_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.committee_account_requests%ROWTYPE; u auth.users%ROWTYPE; membership uuid;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request_id AND kind='invite' FOR UPDATE;
 IF r.actor_id<>auth.uid() THEN RAISE EXCEPTION 'This invitation belongs to another administrator.' USING ERRCODE='42501'; END IF;
 IF r.state='complete' THEN RETURN r.result; END IF;
 IF r.attempt_id IS DISTINCT FROM p_attempt_id OR r.lease_until<=now() THEN RAISE EXCEPTION 'Invitation processing changed. Retry the saved request.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 PERFORM public.committee_archive_auto_profile(p_user_id,r.id);
 IF lower(u.email)<>lower(r.email) OR (coalesce(r.payload->>'provisioningMode','invite')<>'password' AND u.invited_at IS NULL) OR u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role'
  OR u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id)
  THEN RAISE EXCEPTION 'The invited account could not be verified.'; END IF;
 IF r.payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD access is not enabled.'; END IF;
 IF coalesce(r.payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (r.payload->>'role'='bod_member' AND r.payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'The invitation needs a valid committee position.'; END IF;
 INSERT INTO public.staff_memberships(auth_user_id,role,active,starts_at,ends_at,assigned_by,title,committee_seat,member_number,invitation_request_id,last_invite_at)
 VALUES(u.id,r.payload->>'role',true,(r.payload->>'startsAt')::timestamptz,(r.payload->>'endsAt')::timestamptz,auth.uid(),coalesce(r.payload->>'title',''),r.payload->>'committeeSeat',CASE WHEN r.payload->>'role'='crecom_member' AND r.payload->>'committeeSeat'='member' THEN (r.payload->>'committeeMemberNumber')::smallint END,r.id,clock_timestamp()) RETURNING id INTO membership;
 UPDATE public.committee_account_requests SET state='complete',auth_user_id=u.id,membership_id=membership,result=jsonb_build_object('membershipId',membership),lease_until=null WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-complete',membership::text,'success',jsonb_build_object('requestId',r.id,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','committeeMemberNumber',(r.payload->>'committeeMemberNumber')::smallint));
 RETURN jsonb_build_object('membershipId',membership);
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_change_membership(p_id uuid, p_revision integer, p_action text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text; next_role text; next_seat text; starts timestamptz; ends timestamptz; next_active boolean;next_number smallint; result jsonb;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_action IS NULL OR p_action NOT IN ('edit','deactivate','reactivate') OR p_payload IS NULL
  OR length(btrim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a reason for this membership change.'; END IF;
 SELECT * INTO STRICT m FROM public.staff_memberships WHERE id=p_id FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'action',p_action,'payload',p_payload,'actor',auth.uid())::text,'UTF8')),'hex');
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id;
 IF FOUND THEN IF r.request_hash=fingerprint AND r.actor_id=auth.uid() AND r.kind='membership' THEN RETURN r.result; END IF; RAISE EXCEPTION 'This request reference was already used.' USING ERRCODE='40001'; END IF;
 IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Membership changed. Reload before saving.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id FOR UPDATE;
 IF u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'This account requires manual membership reconciliation.'; END IF;
 next_number:=m.member_number;next_role:=m.role;next_seat:=m.committee_seat;starts:=m.starts_at;ends:=m.ends_at;next_active:=m.active;
 IF p_action='edit' THEN
  next_seat:=p_payload->>'committeeSeat';
  next_number:=CASE WHEN p_payload->>'role'='crecom_member' AND next_seat='member' THEN (p_payload->>'committeeMemberNumber')::smallint END;
  IF p_payload->>'role'='crecom_member' AND next_seat='member' AND (next_number IS NULL OR next_number NOT IN (1,2)) THEN RAISE EXCEPTION 'Choose CRECOM Member 1 or CRECOM Member 2.';END IF;
 IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;
  next_role:=p_payload->>'role';starts:=(p_payload->>'startsAt')::timestamptz;ends:=(p_payload->>'endsAt')::timestamptz;
  IF next_role IS NULL OR next_role NOT IN ('crecom_member','bod_member') OR starts IS NULL OR ends<=starts OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Choose valid membership details.'; END IF;
 ELSIF p_action='deactivate' THEN next_active:=false;
 ELSE next_active:=true; IF ends<=now() THEN RAISE EXCEPTION 'Update expired membership dates before reactivation.'; END IF;
 END IF;
 IF next_role='bod_member' AND next_active AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'An approved policy must enable BOD access first.'; END IF;
 UPDATE public.staff_memberships SET role=next_role,committee_seat=next_seat,member_number=next_number,starts_at=starts,ends_at=ends,active=next_active,title=CASE WHEN p_action='edit' THEN coalesce(p_payload->>'title','') ELSE title END,revision=revision+1 WHERE id=m.id;
 IF next_role IS DISTINCT FROM m.role THEN UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}',to_jsonb(next_role)) WHERE id=u.id; END IF;
 result:=jsonb_build_object('id',m.id,'revision',m.revision+1);
 INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,state,auth_user_id,membership_id,result)
 VALUES(p_request_id,'membership',auth.uid(),u.email,p_payload,fingerprint,'complete',u.id,m.id,result);
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'committee-membership-'||p_action,m.id::text,'success',jsonb_build_object('reason',p_payload->>'reason','oldRole',m.role,'newRole',next_role,'oldSeat',m.committee_seat,'newSeat',next_seat,'oldMemberNumber',m.member_number,'newMemberNumber',next_number,'active',next_active,'requestId',p_request_id));
 RETURN result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_account_action(p_actor_id uuid, p_operation text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true); result jsonb;
BEGIN
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id AND raw_app_meta_data->>'role' IN ('super_admin','admin','coop_admin')) THEN
  RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501';END IF;
 IF p_operation='committee_reserve_invite' THEN
  result:=public.committee_reserve_invite((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid,p_args->'p_payload');
 ELSIF p_operation='committee_finish_invite' THEN
  result:=public.committee_finish_invite((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid,(p_args->>'p_user_id')::uuid);
 ELSIF p_operation='committee_request_failed' THEN
  PERFORM public.committee_request_failed((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid,p_args->>'p_message');
  result:='{}';
 ELSIF p_operation='committee_change_membership' THEN
  result:=public.committee_change_membership((p_args->>'p_id')::uuid,(p_args->>'p_revision')::integer,p_args->>'p_action',p_args->'p_payload',(p_args->>'p_request_id')::uuid);
 ELSIF p_operation='committee_begin_link' THEN
  result:=public.committee_begin_link((p_args->>'p_id')::uuid,(p_args->>'p_revision')::integer,(p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid);
 ELSIF p_operation='committee_finish_link' THEN
  result:=public.committee_finish_link((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid);
 ELSE RAISE EXCEPTION 'Unknown committee account operation.';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RAISE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_mutate_review(p_application_id text, p_action text, p_revision integer, p_state_hash text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   IF parent.id IS NULL OR NOT public.committee_packet_is_current(parent.id) OR NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'Complete the current CRECOM stage before required BOD review.'; END IF;
   bod_needed:=true;route_reason:=parent.routing_reason;cycle_number:=parent.cycle_no;packet:=parent.packet_snapshot;
  END IF;
  IF target_count IS NULL OR approvals_needed IS NULL OR jsonb_typeof(p_payload->'reviewers') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_payload->'reviewers')<>target_count
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_payload->'reviewers'))<>target_count
   OR (p_payload->>'dueAt' IS NOT NULL AND (p_payload->>'dueAt')::timestamptz<=now()) THEN RAISE EXCEPTION 'Choose the exact number of distinct eligible reviewers and a future deadline.'; END IF;
  PERFORM m.id FROM public.staff_memberships m WHERE m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) ORDER BY m.id FOR SHARE;
  IF stage_name='CRECOM' AND ((SELECT count(*) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='member')<>2 OR (SELECT count(*) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='chairperson')<>1) THEN RAISE EXCEPTION 'Select exactly two CRECOM members and one CRECOM chairperson.'; END IF;
  IF stage_name='CRECOM' AND (SELECT count(DISTINCT member_number) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='member' AND member_number IN (1,2))<>2 THEN RAISE EXCEPTION 'Select CRECOM Member 1, CRECOM Member 2 and the CRECOM Chairperson.';END IF;
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
  PERFORM public.committee_record_final(a.id,p_payload->>'decision','super_admin',reason);
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
   IF assignment.signatory_role='crecom_member' AND assignment.member_number IS NOT NULL AND assignment.member_number IS DISTINCT FROM (SELECT member_number FROM public.staff_memberships WHERE id=candidate) THEN RAISE EXCEPTION 'Choose a replacement with the same numbered CRECOM member position.';END IF;
   UPDATE public.review_assignments SET state='reassigned',revision=revision+1 WHERE id=assignment.id;
   SELECT * INTO STRICT membership FROM public.staff_memberships WHERE id=candidate;
   INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,signatory_role,due_at) VALUES(c.id,membership.auth_user_id,membership.id,assignment.signatory_role,assignment.due_at) RETURNING id INTO new_assignment;
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
$function$;
CREATE OR REPLACE FUNCTION public.committee_accounts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'email'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('id',m.id,'requestId',m.invitation_request_id,'userId',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'email',u.email,'role',m.role,'committeeSeat',m.committee_seat,'committeeMemberNumber',m.member_number,'title',m.title,'startsAt',m.starts_at,'endsAt',m.ends_at,'active',m.active,'revision',m.revision,'setupCompletedAt',m.setup_completed_at,
   'status',CASE WHEN NOT m.active THEN 'inactive' WHEN m.ends_at<=now() THEN 'expired' WHEN m.role='bod_member' AND NOT public.committee_bod_enabled() THEN 'policy_disabled' WHEN m.setup_completed_at IS NULL THEN 'invited' WHEN m.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'lastSignInAt',u.last_sign_in_at,'assignedCount',(SELECT count(*) FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE a.membership_id=m.id AND c.status='open' AND a.state IN ('assigned','awaiting_clarification')),
   'lastInviteAt',m.last_invite_at,'error',null) AS row FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  UNION ALL
  SELECT jsonb_build_object('id',r.id,'requestId',r.id,'creationMode',coalesce(r.payload->>'provisioningMode','invite'),'userId',r.auth_user_id,'name',r.payload->>'name','email',r.email,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','committeeMemberNumber',(r.payload->>'committeeMemberNumber')::smallint,'title',r.payload->>'title',
   'startsAt',r.payload->>'startsAt','endsAt',r.payload->>'endsAt','active',false,'revision',0,'setupCompletedAt',null,
   'status',CASE WHEN r.state='failed' THEN 'failed' ELSE 'provisioning' END,'lastSignInAt',null,'assignedCount',0,'lastInviteAt',r.created_at,'error',r.error)
   FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state<>'complete'
 )records;
 RETURN jsonb_build_object('accounts',rows,'bodEnabled',public.committee_bod_enabled());
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_account_assignments(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'stage',c.stage,'signatoryRole',a.signatory_role,'committeeMemberNumber',a.member_number,'cycle',c.cycle_no,'state',a.state,'assignedAt',a.assigned_at,'dueAt',a.due_at,
  'needsReassignment',c.status='open' AND a.state IN ('assigned','awaiting_clarification') AND
    (a.signatory_role IS DISTINCT FROM CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' THEN 'crecom_member' END OR (a.member_number IS NOT NULL AND a.member_number IS DISTINCT FROM m.member_number) OR NOT m.active OR m.starts_at>now() OR m.ends_at<=now() OR m.role<>CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END))
  ORDER BY a.assigned_at DESC),'[]') INTO rows FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
  JOIN public.staff_memberships m ON m.id=a.membership_id WHERE m.id=p_id;
 RETURN rows;
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_request_failed(p_request_id uuid, p_attempt_id uuid, p_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 UPDATE public.committee_account_requests SET state='failed',error=left(p_message,500),lease_until=null WHERE id=p_request_id AND actor_id=auth.uid() AND attempt_id=p_attempt_id AND state<>'complete';
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_begin_link(p_id uuid, p_revision integer, p_request_id uuid, p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT m FROM public.staff_memberships WHERE id=p_id FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'actor',auth.uid())::text,'UTF8')),'hex');
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.kind<>'link' OR r.actor_id<>auth.uid() OR r.request_hash<>fingerprint THEN RAISE EXCEPTION 'This link request reference was already used.' USING ERRCODE='40001'; END IF;
  IF r.state='complete' THEN RETURN jsonb_build_object('complete',true); END IF;
  IF r.lease_until>now() THEN RAISE EXCEPTION 'A setup link is being processed. Wait a minute before retrying.' USING ERRCODE='55P03'; END IF;
 ELSE
  IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Membership changed. Refresh first.' USING ERRCODE='40001'; END IF;
  IF m.last_invite_at>now()-interval '60 seconds' THEN RAISE EXCEPTION 'Wait a minute before requesting another setup link.' USING ERRCODE='55P03'; END IF;
 END IF;
 IF NOT m.active OR m.ends_at<=now() OR (m.role='bod_member' AND NOT public.committee_bod_enabled()) THEN RAISE EXCEPTION 'Activate a current eligible membership before sending a setup link.'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id;
 IF u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'The committee account could not be verified.'; END IF;
 IF r.id IS NULL THEN INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,auth_user_id,membership_id) VALUES(p_request_id,'link',auth.uid(),u.email,'{}',fingerprint,u.id,m.id); END IF;
 UPDATE public.committee_account_requests SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds',error=null WHERE id=p_request_id;
 UPDATE public.staff_memberships SET last_invite_at=clock_timestamp(),revision=revision+1 WHERE id=m.id;
 RETURN jsonb_build_object('complete',false,'userId',u.id,'email',u.email,'confirmed',u.email_confirmed_at IS NOT NULL);
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_finish_link(p_request_id uuid, p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.committee_account_requests%ROWTYPE;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request_id AND kind='link' FOR UPDATE;
 IF r.actor_id<>auth.uid() OR r.attempt_id IS DISTINCT FROM p_attempt_id THEN RAISE EXCEPTION 'This setup link request changed.' USING ERRCODE='40001'; END IF;
 IF r.state='complete' THEN RETURN jsonb_build_object('success',true); END IF;
 UPDATE public.committee_account_requests SET state='complete',lease_until=null,result='{"success":true}' WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-setup-link',r.membership_id::text,'success',jsonb_build_object('requestId',r.id));
 RETURN jsonb_build_object('success',true);
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_review_state(p_application_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; state jsonb; cycles jsonb; events jsonb; candidates jsonb; final jsonb; stage_value text;
BEGIN
 IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id;
 SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id;
 state:=public.private_application_verification_state(a.id);stage_value:=public.committee_application_stage(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'stage',c.stage,'cycle',c.cycle_no,'packetVersion',c.packet_version,'status',c.status,'outcome',c.outcome,
  'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,'bodRequired',c.bod_required,'routingReason',c.routing_reason,'createdAt',c.created_at,
  'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'membershipId',x.membership_id,'name',coalesce(d.reviewer_name,nullif(u.raw_user_meta_data->>'full_name',''),u.email),'signatoryRole',x.signatory_role,'committeeMemberNumber',x.member_number,'confirmationReference',d.id,'confirmationText',d.confirmation_text,'confirmationMethod',d.confirmation_method,
   'state',x.state,'revision',x.revision,'decision',d.decision,'reason',d.reason,'decidedAt',d.created_at) ORDER BY x.assigned_at),'[]')
   FROM public.review_assignments x JOIN auth.users u ON u.id=x.reviewer_auth_id LEFT JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=c.id))
  ORDER BY c.cycle_no DESC,c.created_at DESC),'[]') INTO cycles FROM public.application_review_cycles c WHERE c.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',e.actor_name,'reason',e.reason,'createdAt',e.created_at,'assignmentId',e.assignment_id) ORDER BY e.created_at DESC),'[]')
 INTO events FROM public.committee_review_events e WHERE e.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'role',m.role,'committeeSeat',m.committee_seat,'committeeMemberNumber',m.member_number,'title',m.title) ORDER BY u.email),'[]')
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
$function$;
CREATE OR REPLACE FUNCTION public.committee_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE assignments jsonb; history jsonb; access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() THEN RAISE EXCEPTION 'Active committee membership is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'applicant',c.packet_snapshot->'summary'->>'applicant','memberNumber',c.packet_snapshot->'summary'->>'memberNumber','loanType',c.packet_snapshot->'summary'->>'loanType',
  'amount',(c.packet_snapshot->'summary'->>'amount')::numeric,'stage',c.stage,'signatoryRole',a.signatory_role,'committeeMemberNumber',a.member_number,'cycle',c.cycle_no,'packetVersion',c.packet_version,'assignedAt',a.assigned_at,'dueAt',a.due_at,'state',a.state,
  'responded',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state='decision_recorded'),
  'assigned',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state NOT IN ('cancelled','reassigned'))) ORDER BY a.assigned_at DESC),'[]')
 INTO assignments FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE public.committee_assignment_eligible(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'assignmentId',d.assignment_id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'cycle',c.cycle_no,'packetVersion',d.packet_version,'decision',d.decision,'signatoryRole',d.signatory_role,'committeeMemberNumber',d.member_number,'reason',d.reason,'createdAt',d.created_at,'accessAvailable',public.committee_assignment_eligible(a.id)) ORDER BY d.created_at DESC),'[]')
 INTO history FROM public.individual_review_decisions d JOIN public.review_assignments a ON a.id=d.assignment_id JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 WHERE d.reviewer_auth_id=auth.uid();
 RETURN jsonb_build_object('assignments',assignments,'history',history,'counts',jsonb_build_object('assigned',jsonb_array_length(assignments),
  'pending',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='assigned'),
  'waiting',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='decision_recorded' AND (x->>'responded')::integer<(x->>'assigned')::integer),
  'clarification',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='awaiting_clarification'),'completed',jsonb_array_length(history)));
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_review_packet(p_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.application_review_cycles%ROWTYPE; a public.review_assignments%ROWTYPE; state jsonb; assignment jsonb; own_decision jsonb; thread jsonb; app_revision integer;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned case.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.review_assignments WHERE id=p_assignment_id;
 SELECT * INTO STRICT c FROM public.application_review_cycles WHERE id=a.review_cycle_id;
 state:=public.private_application_verification_state(c.application_id);
 SELECT revision INTO app_revision FROM public.application_verifications WHERE application_id=c.application_id;
 SELECT x INTO assignment FROM jsonb_array_elements(public.committee_workspace()->'assignments')x WHERE x->>'id'=p_assignment_id::text;
 SELECT jsonb_build_object('id',id,'decision',decision,'reason',reason,'createdAt',created_at,'reviewer',reviewer_name,'confirmation',confirmation_text,'method',confirmation_method,'signatoryRole',signatory_role,'committeeMemberNumber',member_number) INTO own_decision FROM public.individual_review_decisions WHERE assignment_id=a.id AND reviewer_auth_id=auth.uid();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'actor',actor_name,'reason',reason,'createdAt',created_at,'assignmentId',assignment_id) ORDER BY created_at),'[]') INTO thread
 FROM public.committee_review_events WHERE assignment_id=a.id AND action IN ('clarify','reply','recuse');
 RETURN jsonb_build_object('assignment',assignment,'summary',c.packet_snapshot->'summary','findings',coalesce(c.packet_snapshot->>'staffFindings',''),
  'consentSummary',coalesce(c.packet_snapshot->>'consentSummary',''),'documents',(SELECT coalesce(jsonb_agg(x-'storagePath'-'contentType'),'[]') FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x),
  'appRevision',app_revision,'stateHash',state->>'stateHash','stale',c.status='open' AND NOT public.committee_packet_is_current(c.id),'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,
  'canRespond',c.status='open' AND a.state='assigned' AND public.committee_packet_is_current(c.id) AND NOT EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=c.application_id),
  'myDecision',own_decision,'thread',thread,'cycleStatus',c.status,'outcome',c.outcome);
END;
$function$;
CREATE OR REPLACE FUNCTION public.portal_session_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u auth.users%ROWTYPE; m public.staff_memberships%ROWTYPE; portal_role_value text; eligible boolean;
BEGIN
 SELECT * INTO u FROM auth.users WHERE id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Sign in to continue.' USING ERRCODE='42501'; END IF;
 portal_role_value:=u.raw_app_meta_data->>'role';
 IF portal_role_value IN ('super_admin','admin','coop_admin') THEN
  RETURN jsonb_build_object('allowed',public.document_staff_access(),'role',CASE WHEN portal_role_value='super_admin' THEN portal_role_value ELSE 'admin' END,'setupRequired',false,'reason',CASE WHEN public.document_staff_access() THEN NULL ELSE 'This account is inactive.' END,'membershipId',null,'name',public.document_actor_label(),'email',u.email);
 END IF;
 IF portal_role_value NOT IN ('crecom_member','bod_member') OR portal_role_value IS NULL THEN
  RETURN jsonb_build_object('allowed',false,'role',null,'setupRequired',false,'reason','This account does not have administrative or committee access.','membershipId',null,'name','','email','');
 END IF;
 SELECT * INTO m FROM public.staff_memberships WHERE auth_user_id=u.id AND staff_memberships.role=portal_role_value ORDER BY active DESC,starts_at DESC,id LIMIT 1;
 eligible:=public.committee_membership_eligible(m.id);
 RETURN jsonb_build_object('allowed',eligible,'role',portal_role_value,'setupRequired',m.setup_completed_at IS NULL AND public.committee_membership_eligible(m.id,true,true),
  'reason',CASE WHEN eligible THEN NULL WHEN portal_role_value='bod_member' AND NOT public.committee_bod_enabled() THEN 'BOD access is not enabled by an approved workflow policy.'
    WHEN m.active AND m.starts_at>now() THEN 'Your committee membership has not started yet.'
    ELSE 'Your committee membership is inactive, expired, or not available.' END,
  'membershipId',m.id,'committeeSeat',m.committee_seat,'committeeMemberNumber',m.member_number,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'email',u.email,'startsAt',m.starts_at,'endsAt',m.ends_at);
END;
$function$;
CREATE OR REPLACE FUNCTION public.committee_assignment_eligible(p_assignment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 JOIN public.staff_memberships m ON m.id=a.membership_id WHERE a.id=p_assignment_id AND a.reviewer_auth_id=auth.uid()
 AND m.auth_user_id=a.reviewer_auth_id AND public.committee_membership_eligible(m.id)
 AND a.signatory_role=CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='member' THEN 'crecom_member' END
 AND (a.member_number IS NULL OR a.member_number IS NOT DISTINCT FROM m.member_number)
 AND m.role=CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
 AND a.state NOT IN ('cancelled','reassigned') AND c.status IN ('open','completed'));
$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
