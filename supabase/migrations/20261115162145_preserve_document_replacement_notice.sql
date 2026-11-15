BEGIN;

-- Keep a member's existing replacement notice if the activity-to-review
-- lookup is unavailable. The triggering notification already has its
-- application reference and the review reason in the message.
CREATE OR REPLACE FUNCTION public.portal_prepare_borrower_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  -- This trigger may not be able to resolve activity metadata for older or
  -- alternate review paths. Preserve the original recipient notification.
  IF document_kind IS NULL THEN RETURN NEW;END IF;
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

COMMIT;
