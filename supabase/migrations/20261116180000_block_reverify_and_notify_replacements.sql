BEGIN;

-- A document version with an open replacement request cannot be verified.
CREATE OR REPLACE FUNCTION public.record_document_review(
  p_document_id uuid,p_version_id uuid,p_expected_review_id uuid,p_status text,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.loan_documents%ROWTYPE; latest_version uuid; last_review uuid; last_review_status text; app_status text; event_id uuid;
BEGIN
  IF NOT public.document_staff_access('documents.review') THEN RAISE EXCEPTION 'Document review permission is required.' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('verified','needs_replacement') OR length(coalesce(p_reason,''))>2000
    OR (p_status='needs_replacement' AND length(btrim(coalesce(p_reason,'')))=0)
    THEN RAISE EXCEPTION 'Choose a valid review and provide a replacement reason when needed.'; END IF;
  SELECT * INTO STRICT d FROM public.loan_documents WHERE id=p_document_id FOR UPDATE;
  SELECT v.id INTO latest_version FROM public.loan_document_versions v WHERE v.document_id=d.id ORDER BY v.version DESC LIMIT 1;
  IF latest_version IS DISTINCT FROM p_version_id THEN RAISE EXCEPTION 'This file has a newer version. Refresh before reviewing.' USING ERRCODE='40001'; END IF;
  SELECT r.id,r.status INTO last_review,last_review_status FROM public.loan_document_reviews r
    WHERE r.document_id=d.id AND r.version_id IS NOT DISTINCT FROM latest_version ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
  IF last_review IS DISTINCT FROM p_expected_review_id THEN RAISE EXCEPTION 'Another reviewer updated this file. Refresh before saving.' USING ERRCODE='40001'; END IF;
  IF p_status='verified' AND last_review_status='needs_replacement'
    THEN RAISE EXCEPTION 'The member must upload the requested replacement before this document can be verified.' USING ERRCODE='P0001'; END IF;
  SELECT status::text INTO app_status FROM public.loan_applications WHERE id=d.loan_application_id;
  IF p_status='needs_replacement' AND (app_status IS NULL OR app_status NOT IN ('pending','under review'))
    THEN RAISE EXCEPTION 'Replacement requests are available while the application is Pending or Under Review.'; END IF;
  INSERT INTO public.loan_document_reviews(document_id,version_id,status,reason,reviewer_id,reviewer_name)
  VALUES(d.id,latest_version,p_status,CASE WHEN p_status='needs_replacement' THEN btrim(p_reason) END,auth.uid(),public.document_actor_label())
  RETURNING id INTO event_id;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
  VALUES(auth.uid(),'review-document',d.id::text,'success',jsonb_build_object('review_id',event_id,'version_id',latest_version,'status',p_status));
  RETURN jsonb_build_object('id',event_id,'status',p_status);
END;
$$;

-- Provide a recipient notice even if the generic portal activity fan-out
-- cannot resolve or insert its member notification. A matching existing
-- activity-linked notice wins, preventing duplicates.
CREATE OR REPLACE FUNCTION public.portal_notify_document_replacement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app_id uuid; application_reference text; owner uuid; activity_id uuid; kind text; message_text text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'needs_replacement' THEN RETURN NEW; END IF;
  SELECT a.id,a.application_id,m.user_id,d.kind INTO app_id,application_reference,owner,kind
  FROM public.loan_documents d
  JOIN public.loan_applications a ON a.id=d.loan_application_id
  JOIN public.members m ON m.id=a.member_id
  JOIN auth.users u ON u.id=m.user_id
  WHERE d.id=NEW.document_id AND m.status='active'
    AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
    AND (u.banned_until IS NULL OR u.banned_until<=now());
  IF owner IS NULL THEN RETURN NEW; END IF;
  SELECT e.id INTO activity_id FROM public.portal_activity_events e
  WHERE e.source_key='loan_document_reviews:'||NEW.id::text;
  IF EXISTS(SELECT 1 FROM public.notifications n WHERE n.user_id=owner AND (
      n.data->>'documentReviewId'=NEW.id::text
      OR (activity_id IS NOT NULL AND n.data->>'activityEventId'=activity_id::text))) THEN RETURN NEW; END IF;
  message_text:=format('%s · %s · Document replacement requested. Reason: %s',application_reference,
    CASE kind WHEN 'validId' THEN 'Valid ID' WHEN 'payslip' THEN 'Pay Slip' WHEN 'collateral' THEN 'Collateral Document'
      WHEN 'employerCertification' THEN 'Employer Certification' ELSE 'Supporting Document' END,coalesce(NEW.reason,''));
  INSERT INTO public.notifications(user_id,title,message,type,read,data)
  VALUES(owner,'Document replacement required',message_text,'info',false,
    jsonb_strip_nulls(jsonb_build_object('activityEventId',activity_id,'documentReviewId',NEW.id,
      'category','documents','action','document_reviewed','event','document_reviewed','entityType','application',
      'entityKey',application_reference,'applicationId',app_id)))
  ON CONFLICT ((data->>'activityEventId'),user_id)
    WHERE data->>'activityEventId' IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_notify_document_replacement() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS portal_notify_document_replacement ON public.loan_document_reviews;
CREATE TRIGGER portal_notify_document_replacement
AFTER INSERT ON public.loan_document_reviews
FOR EACH ROW EXECUTE FUNCTION public.portal_notify_document_replacement();

-- Deliver notices for currently actionable requests that predate this trigger.
WITH current_requests AS (
  SELECT DISTINCT ON (r.document_id) r.id,r.reason,r.document_id,d.kind,a.id AS application_uuid,
    a.application_id,m.user_id,e.id AS activity_id
  FROM public.loan_document_reviews r
  JOIN public.loan_documents d ON d.id=r.document_id
  JOIN public.loan_applications a ON a.id=d.loan_application_id
  JOIN public.members m ON m.id=a.member_id AND m.status='active'
  JOIN auth.users u ON u.id=m.user_id AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
    AND (u.banned_until IS NULL OR u.banned_until<=now())
  JOIN LATERAL (SELECT v.id FROM public.loan_document_versions v WHERE v.document_id=d.id ORDER BY v.version DESC LIMIT 1) latest ON latest.id IS NOT DISTINCT FROM r.version_id
  JOIN LATERAL (SELECT current_review.id FROM public.loan_document_reviews current_review
    WHERE current_review.document_id=d.id AND current_review.version_id IS NOT DISTINCT FROM latest.id
    ORDER BY current_review.created_at DESC,current_review.id DESC LIMIT 1) latest_review ON latest_review.id=r.id
  LEFT JOIN public.portal_activity_events e ON e.source_key='loan_document_reviews:'||r.id::text
  WHERE r.status='needs_replacement' AND a.status IN ('pending','under review','returned')
  ORDER BY r.document_id,r.created_at DESC,r.id DESC
)
INSERT INTO public.notifications(user_id,title,message,type,read,data)
SELECT user_id,'Document replacement required',
  format('%s · %s · Document replacement requested. Reason: %s',application_id,
    CASE kind WHEN 'validId' THEN 'Valid ID' WHEN 'payslip' THEN 'Pay Slip' WHEN 'collateral' THEN 'Collateral Document'
      WHEN 'employerCertification' THEN 'Employer Certification' ELSE 'Supporting Document' END,coalesce(reason,'')),
  'info',false,jsonb_strip_nulls(jsonb_build_object('activityEventId',activity_id,'documentReviewId',id,
    'category','documents','action','document_reviewed','event','document_reviewed','entityType','application',
    'entityKey',application_id,'applicationId',application_uuid))
FROM current_requests r
WHERE NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.user_id=r.user_id AND (
  n.data->>'documentReviewId'=r.id::text OR (r.activity_id IS NOT NULL AND n.data->>'activityEventId'=r.activity_id::text)))
ON CONFLICT ((data->>'activityEventId'),user_id)
  WHERE data->>'activityEventId' IS NOT NULL DO NOTHING;

NOTIFY pgrst,'reload schema';
COMMIT;
