-- Incoming activity alerts. Does not backfill past actions or change loan decisions.
BEGIN;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data jsonb;
ALTER TABLE public.notifications ADD COLUMN activity_category text GENERATED ALWAYS AS
 (CASE WHEN data->>'category' IN ('accounts','loans','approvals','documents','payments','announcements','system') THEN data->>'category'
  WHEN type IN ('loan_submitted','loan_approval','loan_rejection') THEN 'loans' WHEN type='payment_reminder' THEN 'payments' ELSE 'other' END) STORED;
CREATE UNIQUE INDEX notification_activity_recipient_unique ON public.notifications((data->>'activityEventId'),user_id) WHERE data->>'activityEventId' IS NOT NULL;
CREATE INDEX notification_recipient_category_created ON public.notifications(user_id,activity_category,created_at DESC,id DESC);
CREATE TABLE public.portal_activity_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_key text NOT NULL UNIQUE,
 category text NOT NULL CHECK(category IN ('accounts','loans','approvals','documents','payments','announcements','system')),
 action text NOT NULL,entity_type text NOT NULL,entity_key text NOT NULL,
 actor_id uuid,actor_name text NOT NULL,actor_role text NOT NULL,title text NOT NULL,message text NOT NULL,
 super_admin_only boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.portal_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_activity_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.portal_activity_events TO authenticated;
GRANT ALL ON public.portal_activity_events TO service_role;
CREATE FUNCTION public.portal_activity_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT public.document_staff_access() AND EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND raw_app_meta_data->>'role'='super_admin')$$;
REVOKE ALL ON FUNCTION public.portal_activity_super_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_activity_super_admin() TO authenticated,service_role;
CREATE POLICY staff_activity_history ON public.portal_activity_events FOR SELECT TO authenticated USING(public.document_staff_access() AND (NOT super_admin_only OR public.portal_activity_super_admin()));
CREATE FUNCTION public.portal_activity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'Activity history cannot be edited.' USING ERRCODE='42501'; END$$;
CREATE TRIGGER preserve_portal_activity BEFORE UPDATE OR DELETE ON public.portal_activity_events FOR EACH ROW EXECUTE FUNCTION public.portal_activity_immutable();

-- Private inbox rows always remain private, including where an older permissive policy exists.
DROP POLICY IF EXISTS private_loan_submission_alerts ON public.notifications;
CREATE POLICY activity_recipient_boundary ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated
 USING(user_id=auth.uid() OR (user_id IS NULL AND public.document_staff_access('notifications.send')))
 WITH CHECK(user_id=auth.uid());
CREATE POLICY authorized_outgoing_history ON public.notifications FOR SELECT TO authenticated USING(user_id IS NULL AND public.document_staff_access('notifications.send'));
GRANT SELECT,UPDATE(read) ON public.notifications TO authenticated;
DROP TRIGGER IF EXISTS notify_super_admins_of_loan_submission ON public.loan_applications;

CREATE FUNCTION public.portal_emit_activity(p_source text,p_category text,p_action text,p_title text,p_message text,p_entity_type text,p_entity_key text,
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

CREATE FUNCTION public.portal_record_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
-- Row triggers run in the action's transaction, so failed/rolled-back actions send nothing.
CREATE TRIGGER portal_member_activity AFTER INSERT OR UPDATE OR DELETE ON public.members FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_loan_activity AFTER INSERT OR UPDATE ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_document_activity AFTER INSERT ON public.loan_documents FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_document_version_activity AFTER INSERT ON public.loan_document_versions FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_document_review_activity AFTER INSERT ON public.loan_document_reviews FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_verification_activity AFTER INSERT ON public.application_workflow_events FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_committee_activity AFTER INSERT ON public.committee_review_events FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_payment_activity AFTER INSERT OR UPDATE ON public.loan_payments FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_shared_document_activity AFTER INSERT OR UPDATE ON public.shared_documents FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_announcement_activity AFTER INSERT OR UPDATE OR DELETE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
CREATE TRIGGER portal_audit_activity AFTER INSERT ON public.admin_activity_logs FOR EACH ROW EXECUTE FUNCTION public.portal_record_activity();
REVOKE ALL ON FUNCTION public.portal_emit_activity(text,text,text,text,text,text,text,uuid,uuid,text,boolean),public.portal_record_activity(),public.portal_activity_immutable() FROM PUBLIC,anon,authenticated;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; END IF;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
