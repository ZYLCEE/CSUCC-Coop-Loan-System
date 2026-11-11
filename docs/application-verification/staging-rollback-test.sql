BEGIN;
-- Minimal prerequisites on an otherwise empty staging public schema. Always rolled back.
CREATE TABLE public.members(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),member_id varchar NOT NULL,first_name varchar NOT NULL,last_name varchar NOT NULL DEFAULT '',membership_type varchar,status varchar DEFAULT 'active',role varchar DEFAULT 'Member',must_change_password boolean NOT NULL DEFAULT false);
CREATE TABLE public.loan_applications(id uuid PRIMARY KEY,application_id varchar NOT NULL,member_id uuid REFERENCES public.members(id),member_name varchar,loan_type varchar,amount numeric,status varchar,date_submitted date);
CREATE TABLE public.loan_documents(id uuid PRIMARY KEY,loan_application_id uuid REFERENCES public.loan_applications(id),user_id uuid REFERENCES auth.users(id),kind text,storage_path text UNIQUE,original_name text,content_type text,size_bytes bigint,created_at timestamptz DEFAULT now());
CREATE TABLE public.admin_activity_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid REFERENCES auth.users(id),action_name text,target_id text,result text,details jsonb,created_at timestamptz DEFAULT now());
GRANT SELECT ON public.members,public.loan_applications,public.loan_documents TO authenticated;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_member ON public.members FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY own_document ON public.loan_documents FOR SELECT TO authenticated USING(user_id=auth.uid());
INSERT INTO storage.buckets(id,name,public) VALUES('loan-documents','loan-documents',false) ON CONFLICT DO NOTHING;
CREATE POLICY owner_file ON storage.objects FOR SELECT TO authenticated USING(bucket_id='loan-documents' AND (storage.foldername(name))[1]=auth.uid()::text);

ALTER TABLE public.loan_applications ADD COLUMN purpose text,ADD COLUMN tenure_months integer,ADD COLUMN monthly_payment numeric;
CREATE TABLE public.loan_policy_settings(singleton boolean PRIMARY KEY DEFAULT true,collateral_required_above numeric NOT NULL,base_interest_rate numeric DEFAULT 2,updated_at timestamptz DEFAULT now(),updated_by uuid);
INSERT INTO public.loan_policy_settings(singleton,collateral_required_above) VALUES(true,50000);
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id),title varchar NOT NULL,message text NOT NULL,type varchar NOT NULL,read boolean DEFAULT false,created_at timestamptz DEFAULT now());
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.notifications TO authenticated;
CREATE POLICY read_own_notification ON public.notifications FOR SELECT TO authenticated USING(user_id=auth.uid());

-- Forward addition only. Existing loan submissions and loan approval are unchanged.

CREATE TABLE IF NOT EXISTS public.loan_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.loan_documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 2),
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  uploaded_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(document_id, version),
  UNIQUE(id, document_id)
);
CREATE TABLE IF NOT EXISTS public.loan_document_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.loan_documents(id) ON DELETE CASCADE,
  version_id uuid,
  status text NOT NULL CHECK (status IN ('verified','needs_replacement')),
  reason text CHECK (length(reason) <= 2000),
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  reviewer_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(version_id, document_id) REFERENCES public.loan_document_versions(id, document_id),
  CHECK (status <> 'needs_replacement' OR coalesce(length(btrim(reason)),0) > 0)
);
CREATE INDEX IF NOT EXISTS loan_document_reviews_latest_idx ON public.loan_document_reviews(document_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.shared_documents (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  category text NOT NULL CHECK (category IN ('Forms','Guides','Checklists','Other')),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  audience text NOT NULL CHECK (audience IN ('all','selected')),
  status text NOT NULL CHECK (status IN ('draft','published')),
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  uploaded_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.shared_document_recipients (
  document_id uuid NOT NULL REFERENCES public.shared_documents(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id),
  PRIMARY KEY(document_id, member_id)
);
CREATE INDEX IF NOT EXISTS shared_document_recipient_member_idx ON public.shared_document_recipients(member_id, document_id);
CREATE INDEX IF NOT EXISTS shared_document_created_idx ON public.shared_documents(created_at DESC, id);

CREATE OR REPLACE FUNCTION public.document_staff_access(p_privilege text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
    AND u.raw_app_meta_data->>'role' IN ('admin','coop_admin','super_admin')
    AND coalesce(u.raw_app_meta_data->>'account_status','active') = 'active'
    AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND NOT EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=u.id AND m.status IS DISTINCT FROM 'active')
    AND (p_privilege IS NULL OR u.raw_app_meta_data->>'role' = 'super_admin'
      OR coalesce(u.raw_app_meta_data->'admin_privileges','[]'::jsonb) ? p_privilege));
$$;
CREATE OR REPLACE FUNCTION public.document_member_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users u JOIN public.members m ON m.user_id=u.id
    WHERE u.id=auth.uid() AND u.raw_app_meta_data->>'role'='member'
      AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
      AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND m.status='active' AND m.must_change_password=false);
$$;
CREATE OR REPLACE FUNCTION public.document_actor_label()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),u.email,'Administrator')
  FROM auth.users u WHERE u.id=auth.uid();
$$;
CREATE OR REPLACE FUNCTION public.can_read_shared_document(p_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.shared_documents d
    WHERE d.id=p_document_id AND d.deleted_at IS NULL AND
    (public.document_staff_access() OR (d.status='published' AND public.document_member_active()
      AND (d.audience='all' OR EXISTS(SELECT 1 FROM public.shared_document_recipients r
        JOIN public.members m ON m.id=r.member_id
        WHERE r.document_id=d.id AND m.user_id=auth.uid())))));
$$;
CREATE OR REPLACE FUNCTION public.document_workspace_capabilities()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('version',1,'canReview',public.document_staff_access('documents.review'));
END;
$$;

CREATE OR REPLACE FUNCTION public.search_document_recipients(p_search text)
RETURNS TABLE(id uuid,member_id text,first_name text,last_name text,membership_type text,status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE term text:=btrim(coalesce(p_search,''));
BEGIN
  IF NOT public.document_staff_access('documents.upload') THEN RAISE EXCEPTION 'Document upload permission is required.' USING ERRCODE='42501'; END IF;
  IF length(term)<2 THEN RETURN; END IF;
  IF length(term)>100 THEN RAISE EXCEPTION 'Search must be at most 100 characters.'; END IF;
  -- strpos treats wildcard characters as literal user input.
  RETURN QUERY SELECT m.id,m.member_id::text,m.first_name::text,m.last_name::text,m.membership_type::text,m.status::text
    FROM public.members m WHERE m.status='active' AND lower(m.role::text)='member'
    AND (strpos(lower(concat_ws(' ',m.first_name,m.last_name)),lower(term))>0 OR strpos(lower(m.member_id::text),lower(term))>0)
    ORDER BY m.last_name,m.first_name,m.id LIMIT 20;
END;
$$;

ALTER TABLE public.loan_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_document_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_document_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loan_document_versions,public.loan_document_reviews,public.shared_documents,public.shared_document_recipients FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.loan_document_versions,public.loan_document_reviews,public.shared_documents,public.shared_document_recipients TO authenticated;
GRANT ALL ON public.loan_document_versions,public.loan_document_reviews,public.shared_documents,public.shared_document_recipients TO service_role;
DROP POLICY IF EXISTS "Read owned document versions" ON public.loan_document_versions;
CREATE POLICY "Read owned document versions" ON public.loan_document_versions FOR SELECT TO authenticated
USING (public.document_staff_access() OR EXISTS(SELECT 1 FROM public.loan_documents d WHERE d.id=document_id AND d.user_id=auth.uid() AND public.document_member_active()));
DROP POLICY IF EXISTS "Read owned document reviews" ON public.loan_document_reviews;
CREATE POLICY "Read owned document reviews" ON public.loan_document_reviews FOR SELECT TO authenticated
USING (public.document_staff_access() OR EXISTS(SELECT 1 FROM public.loan_documents d WHERE d.id=document_id AND d.user_id=auth.uid() AND public.document_member_active()));
DROP POLICY IF EXISTS "Read authorized shared documents" ON public.shared_documents;
CREATE POLICY "Read authorized shared documents" ON public.shared_documents FOR SELECT TO authenticated
USING (public.can_read_shared_document(id));
DROP POLICY IF EXISTS "Read authorized recipient assignments" ON public.shared_document_recipients;
CREATE POLICY "Read authorized recipient assignments" ON public.shared_document_recipients FOR SELECT TO authenticated
USING (public.document_staff_access() OR (public.document_member_active()
  AND public.can_read_shared_document(document_id) AND EXISTS(SELECT 1 FROM public.members m WHERE m.id=shared_document_recipients.member_id AND m.user_id=auth.uid())));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('coop-shared-documents','coop-shared-documents',false,10485760,
  ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'])
ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS "Read scoped shared document files" ON storage.objects;
CREATE POLICY "Read scoped shared document files" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='coop-shared-documents' AND EXISTS(SELECT 1 FROM public.shared_documents d
  WHERE d.storage_path=name AND public.can_read_shared_document(d.id)));
DROP POLICY IF EXISTS "Stage authorized shared document files" ON storage.objects;
CREATE POLICY "Stage authorized shared document files" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='coop-shared-documents' AND (storage.foldername(name))[1]=auth.uid()::text AND public.document_staff_access('documents.upload'));
DROP POLICY IF EXISTS "Review registered document replacement files" ON storage.objects;
CREATE POLICY "Review registered document replacement files" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='loan-documents' AND public.document_staff_access() AND EXISTS(
  SELECT 1 FROM public.loan_document_versions v WHERE v.storage_path=name));
-- A registered replacement must be protected just like the original attachment.
DROP POLICY IF EXISTS "Members can remove only their unsubmitted document drafts" ON storage.objects;
CREATE POLICY "Members can remove only their unsubmitted document drafts" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='loan-documents' AND public.document_member_active() AND (storage.foldername(name))[1]=auth.uid()::text
  AND NOT EXISTS(SELECT 1 FROM public.loan_documents d WHERE d.storage_path=name)
  AND NOT EXISTS(SELECT 1 FROM public.loan_document_versions v WHERE v.storage_path=name));

CREATE OR REPLACE FUNCTION public.record_document_review(
  p_document_id uuid,p_version_id uuid,p_expected_review_id uuid,p_status text,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.loan_documents%ROWTYPE; latest_version uuid; last_review uuid; app_status text; event_id uuid;
BEGIN
  IF NOT public.document_staff_access('documents.review') THEN RAISE EXCEPTION 'Document review permission is required.' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('verified','needs_replacement') OR length(coalesce(p_reason,''))>2000
    OR (p_status='needs_replacement' AND length(btrim(coalesce(p_reason,'')))=0)
    THEN RAISE EXCEPTION 'Choose a valid review and provide a replacement reason when needed.'; END IF;
  SELECT * INTO STRICT d FROM public.loan_documents WHERE id=p_document_id FOR UPDATE;
  SELECT v.id INTO latest_version FROM public.loan_document_versions v WHERE v.document_id=d.id ORDER BY v.version DESC LIMIT 1;
  IF latest_version IS DISTINCT FROM p_version_id THEN RAISE EXCEPTION 'This file has a newer version. Refresh before reviewing.' USING ERRCODE='40001'; END IF;
  SELECT r.id INTO last_review FROM public.loan_document_reviews r WHERE r.document_id=d.id AND r.version_id IS NOT DISTINCT FROM latest_version ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
  IF last_review IS DISTINCT FROM p_expected_review_id THEN RAISE EXCEPTION 'Another reviewer updated this file. Refresh before saving.' USING ERRCODE='40001'; END IF;
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
  IF review_status IS DISTINCT FROM 'needs_replacement' OR app_status IS NULL OR app_status NOT IN ('pending','under review')
    THEN RAISE EXCEPTION 'A replacement can be submitted only for a requested file while the application is Pending or Under Review.'; END IF;
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

CREATE OR REPLACE FUNCTION public.save_shared_document(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE doc_id uuid; saved public.shared_documents%ROWTYPE; recipients uuid[]; metadata jsonb; publishing boolean;
BEGIN
  IF NOT public.document_staff_access('documents.upload') THEN RAISE EXCEPTION 'Document upload permission is required.' USING ERRCODE='42501'; END IF;
  doc_id:=(p_payload->>'id')::uuid; publishing:=coalesce((p_payload->>'publish')::boolean,false);
  SELECT coalesce(array_agg(DISTINCT value::uuid),'{}'::uuid[]) INTO recipients FROM jsonb_array_elements_text(coalesce(p_payload->'recipient_ids','[]'::jsonb));
  IF p_payload->>'audience'='all' THEN recipients:='{}'::uuid[]; END IF;
  IF doc_id IS NULL OR p_payload->>'title' IS NULL OR length(btrim(p_payload->>'title')) NOT BETWEEN 1 AND 160
    OR p_payload->>'category' NOT IN ('Forms','Guides','Checklists','Other')
    OR length(coalesce(p_payload->>'description',''))>2000 OR p_payload->>'audience' NOT IN ('all','selected')
    OR cardinality(recipients)>100 OR (publishing AND p_payload->>'audience'='selected' AND cardinality(recipients)=0)
    OR (SELECT count(*) FROM public.members m WHERE m.id=ANY(recipients) AND lower(m.role::text)='member' AND m.status='active')<>cardinality(recipients)
    THEN RAISE EXCEPTION 'Choose a title, category and valid active member recipients.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text,0));
  SELECT * INTO saved FROM public.shared_documents WHERE id=doc_id;
  IF FOUND THEN
    IF saved.created_by=auth.uid() AND saved.request_fingerprint=p_payload->>'fingerprint' AND saved.deleted_at IS NULL THEN RETURN jsonb_build_object('id',saved.id); END IF;
    RAISE EXCEPTION 'This upload reference has already been used.' USING ERRCODE='40001';
  END IF;
  IF p_payload->>'storage_path' IS NULL OR left(p_payload->>'storage_path',length(auth.uid()::text)+1)<>auth.uid()::text||'/'
    OR length(coalesce(p_payload->>'original_name','')) NOT BETWEEN 1 AND 255
    OR p_payload->>'content_type' NOT IN ('application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR (p_payload->>'size_bytes')::bigint NOT BETWEEN 1 AND 10485760 OR length(coalesce(p_payload->>'fingerprint',''))<>64
    THEN RAISE EXCEPTION 'The uploaded document metadata is invalid.'; END IF;
  SELECT o.metadata INTO metadata FROM storage.objects o WHERE o.bucket_id='coop-shared-documents' AND o.name=p_payload->>'storage_path';
  IF metadata IS NULL OR (metadata->>'size')::bigint IS DISTINCT FROM (p_payload->>'size_bytes')::bigint
    OR metadata->>'mimetype' IS DISTINCT FROM p_payload->>'content_type' THEN RAISE EXCEPTION 'The uploaded file is unavailable or does not match its metadata.'; END IF;
  INSERT INTO public.shared_documents(id,title,category,description,audience,status,storage_path,original_name,content_type,size_bytes,request_fingerprint,created_by,uploaded_by_name,published_at)
  VALUES(doc_id,btrim(p_payload->>'title'),p_payload->>'category',coalesce(p_payload->>'description',''),p_payload->>'audience',
    CASE WHEN publishing THEN 'published' ELSE 'draft' END,p_payload->>'storage_path',p_payload->>'original_name',
    p_payload->>'content_type',(p_payload->>'size_bytes')::bigint,p_payload->>'fingerprint',auth.uid(),public.document_actor_label(),CASE WHEN publishing THEN clock_timestamp() END);
  INSERT INTO public.shared_document_recipients SELECT doc_id,unnest(recipients);
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
  VALUES(auth.uid(),CASE WHEN publishing THEN 'share-document' ELSE 'save-document-draft' END,doc_id::text,'success',
    jsonb_build_object('audience',p_payload->>'audience','recipient_count',cardinality(recipients)));
  RETURN jsonb_build_object('id',doc_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_shared_document(p_id uuid,p_expected_updated_at timestamptz,p_audience text,p_recipient_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.shared_documents%ROWTYPE; recipients uuid[];
BEGIN
  IF NOT public.document_staff_access('documents.upload') THEN RAISE EXCEPTION 'Document upload permission is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT d FROM public.shared_documents WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
  IF d.status<>'draft' OR d.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'This draft has changed. Refresh before publishing.' USING ERRCODE='40001'; END IF;
  SELECT coalesce(array_agg(DISTINCT value),'{}'::uuid[]) INTO recipients FROM unnest(coalesce(p_recipient_ids,'{}'::uuid[])) AS value;
  IF p_audience='all' THEN recipients:='{}'::uuid[]; END IF;
  IF p_audience IS NULL OR p_audience NOT IN ('all','selected') OR cardinality(recipients)>100
    OR (p_audience='selected' AND cardinality(recipients)=0)
    OR (SELECT count(*) FROM public.members m WHERE m.id=ANY(recipients) AND lower(m.role::text)='member' AND m.status='active')<>cardinality(recipients)
    THEN RAISE EXCEPTION 'Select valid active member recipients before publishing.'; END IF;
  DELETE FROM public.shared_document_recipients WHERE document_id=d.id;
  INSERT INTO public.shared_document_recipients SELECT d.id,unnest(recipients);
  UPDATE public.shared_documents SET audience=p_audience,status='published',published_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=d.id;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
  VALUES(auth.uid(),'publish-document',d.id::text,'success',jsonb_build_object('audience',p_audience,'recipient_count',cardinality(recipients)));
  RETURN jsonb_build_object('id',d.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_shared_document(p_id uuid,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.shared_documents%ROWTYPE;
BEGIN
  IF NOT public.document_staff_access('documents.delete') THEN RAISE EXCEPTION 'Document deletion permission is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT d FROM public.shared_documents WHERE id=p_id FOR UPDATE;
  IF d.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('id',d.id); END IF;
  IF d.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'This document changed. Refresh before deleting.' USING ERRCODE='40001'; END IF;
  UPDATE public.shared_documents SET deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=d.id;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
  VALUES(auth.uid(),'delete-shared-document',d.id::text,'success',jsonb_build_object('title',d.title));
  RETURN jsonb_build_object('id',d.id,'storage_path',d.storage_path);
END;
$$;

REVOKE ALL ON FUNCTION public.document_staff_access(text),public.document_member_active(),public.document_actor_label(),public.can_read_shared_document(uuid),
  public.document_workspace_capabilities(),public.search_document_recipients(text),public.record_document_review(uuid,uuid,uuid,text,text),
  public.submit_document_replacement(uuid,uuid,text,text,text,bigint),public.save_shared_document(jsonb),
  public.publish_shared_document(uuid,timestamptz,text,uuid[]),public.delete_shared_document(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.document_staff_access(text),public.document_member_active(),public.document_actor_label(),public.can_read_shared_document(uuid),
  public.document_workspace_capabilities(),public.search_document_recipients(text),public.record_document_review(uuid,uuid,uuid,text,text),
  public.submit_document_replacement(uuid,uuid,text,text,text,bigint),public.save_shared_document(jsonb),
  public.publish_shared_document(uuid,timestamptz,text,uuid[]),public.delete_shared_document(uuid,timestamptz) TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';

-- Phase 1: opt-in application verification and policy foundation.
-- No live applications are enrolled or approved by this migration.

CREATE TABLE IF NOT EXISTS public.staff_memberships(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL CHECK(role IN ('crecom_member','bod_member')),active boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),ends_at timestamptz,
  assigned_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS staff_membership_actor_idx ON public.staff_memberships(auth_user_id,role);

CREATE TABLE IF NOT EXISTS public.approval_workflow_policies(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version bigint GENERATED BY DEFAULT AS IDENTITY UNIQUE,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
  authorization_reference text NOT NULL DEFAULT '' CHECK(length(authorization_reference)<=500),
  effective_at timestamptz,approved_by uuid REFERENCES auth.users(id),approved_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(status<>'approved' OR (length(btrim(authorization_reference))>0 AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND effective_at IS NOT NULL)),
  CONSTRAINT approval_policy_complete_for_approval CHECK(CASE WHEN status='approved' THEN coalesce((
    config->>'reviewerCount' ~ '^([1-9][0-9]?|100)$'
    AND length(btrim(config->>'quorumRule'))>0 AND config->>'crecomAuthority' IN ('recommendation','binding_decision')
    AND config->>'bodMode' IN ('none','conditional','required')
    AND (config->>'bodMode'='none' OR length(btrim(config->>'bodCriteria'))>0)
    AND length(btrim(config->>'finalAuthority'))>0 AND length(btrim(config->>'requirementsReference'))>0
    AND jsonb_typeof(config->'borrowerConsentRequired')='boolean' AND jsonb_typeof(config->'coMakerConsentRequired')='boolean'
    AND config->>'witnessCount' ~ '^(0|[1-9][0-9]?|100)$'
    AND CASE WHEN jsonb_typeof(config->'allowedConsentMethods')='array' THEN
      jsonb_array_length(config->'allowedConsentMethods') BETWEEN 1 AND 2 AND config->'allowedConsentMethods' <@ '["otp","paper"]'::jsonb
      ELSE false END
  ),false) ELSE true END)
);
CREATE TABLE IF NOT EXISTS public.application_verifications(
  application_id uuid PRIMARY KEY REFERENCES public.loan_applications(id),
  stage text NOT NULL DEFAULT 'needs_verification' CHECK(stage IN ('needs_verification','returned_for_requirements','ready_for_committee')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  checks jsonb NOT NULL DEFAULT '{"identity":false,"eligibility":false,"terms":false}',
  notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
  policy_id uuid REFERENCES public.approval_workflow_policies(id),
  verified_state_hash text,verified_snapshot jsonb,verified_by uuid REFERENCES auth.users(id),verified_at timestamptz,
  updated_by uuid NOT NULL REFERENCES auth.users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Evidence is written only by a future trusted consent integration. A staff checkbox
-- cannot create a borrower/co-maker signature, OTP receipt or witness attestation.
CREATE TABLE IF NOT EXISTS public.application_consent_evidence(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES public.loan_applications(id),
  kind text NOT NULL CHECK(kind IN ('borrower','co_maker','witness')),subject_reference text NOT NULL CHECK(length(btrim(subject_reference)) BETWEEN 1 AND 255),
  subject_user_id uuid REFERENCES auth.users(id),method text NOT NULL CHECK(method IN ('otp','paper')),
  evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 1 AND 500),
  packet_hash text NOT NULL CHECK(length(packet_hash)=64),occurred_at timestamptz NOT NULL,
  expires_at timestamptz,invalidated_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(expires_at IS NULL OR expires_at>occurred_at)
);
CREATE INDEX IF NOT EXISTS consent_packet_idx ON public.application_consent_evidence(application_id,packet_hash);
CREATE TABLE IF NOT EXISTS public.application_workflow_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES public.loan_applications(id),
  request_id uuid NOT NULL UNIQUE,request_hash text NOT NULL,actor_id uuid NOT NULL REFERENCES auth.users(id),
  actor_name text NOT NULL,action text NOT NULL CHECK(action IN ('start','save_draft','mark_verified','return')),
  details jsonb NOT NULL DEFAULT '{}',result jsonb NOT NULL,notification_id uuid REFERENCES public.notifications(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS application_workflow_history_idx ON public.application_workflow_events(application_id,created_at DESC,id DESC);

ALTER TABLE public.staff_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflow_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_consent_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_workflow_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_memberships,public.approval_workflow_policies,public.application_verifications,public.application_consent_evidence,public.application_workflow_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.staff_memberships,public.approval_workflow_policies,public.application_verifications,public.application_consent_evidence,public.application_workflow_events TO authenticated;
GRANT ALL ON public.staff_memberships,public.approval_workflow_policies,public.application_verifications,public.application_consent_evidence,public.application_workflow_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.approval_workflow_policies_version_seq TO service_role;
DROP POLICY IF EXISTS "Read committee membership foundation" ON public.staff_memberships;
CREATE POLICY "Read committee membership foundation" ON public.staff_memberships FOR SELECT TO authenticated USING(public.document_staff_access() OR auth_user_id=auth.uid());
DROP POLICY IF EXISTS "Read approval policy foundation" ON public.approval_workflow_policies;
CREATE POLICY "Read approval policy foundation" ON public.approval_workflow_policies FOR SELECT TO authenticated USING(public.document_staff_access());
DROP POLICY IF EXISTS "Read staff application verification" ON public.application_verifications;
CREATE POLICY "Read staff application verification" ON public.application_verifications FOR SELECT TO authenticated USING(public.document_staff_access());
DROP POLICY IF EXISTS "Read staff consent evidence" ON public.application_consent_evidence;
CREATE POLICY "Read staff consent evidence" ON public.application_consent_evidence FOR SELECT TO authenticated USING(public.document_staff_access());
DROP POLICY IF EXISTS "Read staff workflow history" ON public.application_workflow_events;
CREATE POLICY "Read staff workflow history" ON public.application_workflow_events FOR SELECT TO authenticated USING(public.document_staff_access());

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
    'financialPolicy',financial,'documents',manifest)::text,'UTF8')),'hex');
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
    AND (e.kind<>'co_maker' OR (e.subject_user_id IS DISTINCT FROM m.user_id AND e.subject_reference<>m.member_id));
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
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; m public.members%ROWTYPE; state jsonb; history jsonb; returned jsonb; stale boolean:=false;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id;
  SELECT * INTO m FROM public.members WHERE id=a.member_id;
  SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id;
  state:=public.private_application_verification_state(a.id);
  stale:=w.stage='ready_for_committee' AND (w.verified_state_hash IS DISTINCT FROM state->>'stateHash' OR jsonb_array_length(state->'blockers')>0);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',e.actor_name,'createdAt',e.created_at,'details',e.details) ORDER BY e.created_at DESC,e.id DESC),'[]') INTO history FROM public.application_workflow_events e WHERE e.application_id=a.id;
  SELECT jsonb_build_object('reason',e.details->>'reason','category',e.details->>'category','createdAt',e.created_at) INTO returned
    FROM public.application_workflow_events e WHERE e.application_id=a.id AND e.action='return' ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
  RETURN (state-'documents')||jsonb_build_object(
    'documents',(SELECT coalesce(jsonb_agg(value-'storagePath'-'size'-'contentType'),'[]') FROM jsonb_array_elements(state->'documents')),
    'applicationId',a.application_id,'applicationUuid',a.id,'memberName',coalesce(nullif(btrim(concat_ws(' ',m.first_name,m.last_name)),''),a.member_name),
    'memberNumber',coalesce(m.member_id,'Not recorded'),'loanType',a.loan_type,'loanStatus',a.status,
    'stage',CASE WHEN w.application_id IS NULL THEN 'not_started' WHEN stale THEN 'needs_verification' ELSE w.stage END,
    'enrolled',w.application_id IS NOT NULL,'revision',coalesce(w.revision,0),'stale',coalesce(stale,false),
    'checks',coalesce(w.checks,'{"identity":false,"eligibility":false,"terms":false}'),'notes',coalesce(w.notes,''),
    'history',history,'lastReturned',returned,'canEnroll',a.status IN ('pending','under review'),
    'permissions',jsonb_build_object('verify',public.document_staff_access('applications.verify'),'return',public.document_staff_access('applications.return'),'policyManage',public.document_staff_access('workflow.policy.manage')));
END;
$$;

CREATE OR REPLACE FUNCTION public.application_workflow_summaries()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',a.application_id,'enrolled',true,'revision',v.revision,
    'stage',CASE WHEN v.stage='ready_for_committee' AND (v.verified_state_hash IS DISTINCT FROM s.state->>'stateHash' OR jsonb_array_length(s.state->'blockers')>0) THEN 'needs_verification' ELSE v.stage END,
    'stale',v.stage='ready_for_committee' AND (v.verified_state_hash IS DISTINCT FROM s.state->>'stateHash' OR jsonb_array_length(s.state->'blockers')>0)) ORDER BY a.application_id),'[]') INTO rows
    FROM public.application_verifications v JOIN public.loan_applications a ON a.id=v.application_id
    CROSS JOIN LATERAL(SELECT public.private_application_verification_state(a.id) AS state)s;
  RETURN rows;
END;
$$;

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
    IF w.application_id IS NULL THEN RAISE EXCEPTION 'Start verification before saving this action.'; END IF;
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
      UPDATE public.application_verifications SET stage='returned_for_requirements',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;
      INSERT INTO public.notifications(user_id,title,message,type,read)
        VALUES(recipient,'Application requires correction',a.application_id||': '||btrim(p_payload->>'reason'),'warning',false) RETURNING id INTO notification;
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

CREATE OR REPLACE FUNCTION public.get_approval_workflow_policies()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE policies jsonb;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'status',p.status,'config',p.config,
    'authorizationReference',p.authorization_reference,'createdAt',p.created_at,'createdBy',p.created_by_name) ORDER BY p.version DESC),'[]') INTO policies FROM public.approval_workflow_policies p;
  RETURN jsonb_build_object('policies',policies,'canManage',public.document_staff_access('workflow.policy.manage'));
END;
$$;
CREATE OR REPLACE FUNCTION public.save_approval_policy_draft(p_expected_latest_id uuid,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE latest_id uuid; policy_id uuid; c jsonb; field text; actor uuid:=auth.uid(); fingerprint text; prior jsonb; created_version bigint;
BEGIN
  IF NOT public.document_staff_access('workflow.policy.manage') THEN RAISE EXCEPTION 'Workflow policy draft permission is required.' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Complete the policy draft.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('coop-approval-policy-draft',0));
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',actor,'payload',p_payload,'expectedId',p_expected_latest_id)::text,'UTF8')),'hex');
  SELECT details INTO prior FROM public.admin_activity_logs WHERE action_name='workflow-policy-draft' AND target_id=p_request_id::text ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    IF prior->>'fingerprint'=fingerprint THEN RETURN jsonb_build_object('id',prior->>'id'); END IF;
    RAISE EXCEPTION 'This draft request reference was already used.' USING ERRCODE='40001';
  END IF;
  SELECT id INTO latest_id FROM public.approval_workflow_policies ORDER BY version DESC LIMIT 1;
  IF latest_id IS DISTINCT FROM p_expected_latest_id THEN RAISE EXCEPTION 'The policy draft changed. Reload before saving.' USING ERRCODE='40001'; END IF;
  c:=p_payload->'config';
  IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 160 OR jsonb_typeof(c) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payload->'authorizationReference') IS DISTINCT FROM 'string' OR length(p_payload->>'authorizationReference')>500
    OR c->>'crecomAuthority' IS NULL OR c->>'crecomAuthority' NOT IN ('pending','recommendation','binding_decision')
    OR c->>'bodMode' IS NULL OR c->>'bodMode' NOT IN ('pending','none','conditional','required')
    THEN RAISE EXCEPTION 'Enter a valid policy name and draft configuration.'; END IF;
  FOREACH field IN ARRAY ARRAY['quorumRule','bodCriteria','finalAuthority','requirementsReference'] LOOP
    IF jsonb_typeof(c->field) IS DISTINCT FROM 'string' OR length(c->>field)>2000 THEN RAISE EXCEPTION 'Policy descriptions must be at most 2,000 characters.'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['borrowerConsentRequired','coMakerConsentRequired'] LOOP
    IF jsonb_typeof(c->field) IS NULL OR jsonb_typeof(c->field) NOT IN ('boolean','null') THEN RAISE EXCEPTION 'Choose valid consent requirements or leave them pending.'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['reviewerCount','witnessCount'] LOOP
    IF jsonb_typeof(c->field) IS NULL OR jsonb_typeof(c->field) NOT IN ('number','null') THEN RAISE EXCEPTION 'Choose valid reviewer and witness counts.'; END IF;
    IF jsonb_typeof(c->field)='number' AND ((c->>field)::numeric<>trunc((c->>field)::numeric) OR (c->>field)::numeric<CASE WHEN field='reviewerCount' THEN 1 ELSE 0 END OR (c->>field)::numeric>100)
      THEN RAISE EXCEPTION 'Choose valid reviewer and witness counts.'; END IF;
  END LOOP;
  IF jsonb_typeof(c->'allowedConsentMethods') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'allowedConsentMethods')>2
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'allowedConsentMethods') m WHERE m NOT IN ('otp','paper')) THEN RAISE EXCEPTION 'Choose valid consent evidence methods.'; END IF;
  INSERT INTO public.approval_workflow_policies(name,config,authorization_reference,created_by,created_by_name)
    VALUES(btrim(p_payload->>'name'),c,btrim(p_payload->>'authorizationReference'),actor,public.document_actor_label()) RETURNING id,version INTO policy_id,created_version;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    VALUES(actor,'workflow-policy-draft',p_request_id::text,'success',jsonb_build_object('id',policy_id,'version',created_version,'fingerprint',fingerprint));
  RETURN jsonb_build_object('id',policy_id,'version',created_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_enrolled_application_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected','released','completed')
    AND EXISTS(SELECT 1 FROM public.application_verifications v WHERE v.application_id=OLD.id) THEN
    RAISE EXCEPTION 'This application uses the verification workflow. Committee review and final authorization must be completed before a final loan decision or release.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_enrolled_application_decision ON public.loan_applications;
CREATE TRIGGER guard_enrolled_application_decision BEFORE UPDATE OF status ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.guard_enrolled_application_decision();

CREATE OR REPLACE FUNCTION public.member_application_corrections()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT public.document_member_active() THEN RAISE EXCEPTION 'Active member access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',a.application_id,'stage',v.stage,
    'reason',e.details->>'reason','affectedKinds',e.details->'affectedKinds','createdAt',e.created_at) ORDER BY e.created_at DESC),'[]') INTO rows
    FROM public.application_verifications v JOIN public.loan_applications a ON a.id=v.application_id
    JOIN public.members m ON m.id=a.member_id
    CROSS JOIN LATERAL(SELECT details,created_at FROM public.application_workflow_events e WHERE e.application_id=a.id AND e.action='return' ORDER BY created_at DESC,id DESC LIMIT 1)e
    WHERE m.user_id=auth.uid() AND v.stage='returned_for_requirements';
  RETURN rows;
END;
$$;

REVOKE ALL ON FUNCTION public.private_application_verification_state(uuid),public.guard_enrolled_application_decision() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_application_verification(text),public.application_workflow_summaries(),
  public.mutate_application_verification(text,text,integer,text,jsonb,uuid),public.get_approval_workflow_policies(),public.save_approval_policy_draft(uuid,jsonb,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.member_application_corrections() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_application_verification(text),public.application_workflow_summaries(),
  public.mutate_application_verification(text,text,integer,text,jsonb,uuid),public.get_approval_workflow_policies(),public.save_approval_policy_draft(uuid,jsonb,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.member_application_corrections() TO authenticated,service_role;
NOTIFY pgrst,'reload schema';

CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END$$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'Expected rejection: %',command;
END$$;
CREATE FUNCTION pg_temp.act(action text,payload jsonb DEFAULT '{}',application text DEFAULT 'APP-VERIFY') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE state jsonb;
BEGIN
 state:=public.get_application_verification(application);
 RETURN public.mutate_application_verification(application,action,(state->>'revision')::integer,state->>'stateHash',payload,gen_random_uuid());
END$$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES
 ('10000000-0000-0000-0000-000000000001','workflow-super@example.invalid','{"role":"super_admin","account_status":"active"}','{"full_name":"Synthetic coordinator"}'),
 ('10000000-0000-0000-0000-000000000002','workflow-reader@example.invalid','{"role":"admin","account_status":"active","admin_privileges":[]}','{}'),
 ('10000000-0000-0000-0000-000000000003','workflow-member@example.invalid','{"role":"member","account_status":"active"}','{}'),
 ('10000000-0000-0000-0000-000000000004','workflow-co-maker@example.invalid','{"role":"member","account_status":"active"}','{}'),
 ('10000000-0000-0000-0000-000000000005','workflow-reviewer@example.invalid','{"role":"crecom_member","account_status":"active"}','{}');
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,membership_type) VALUES
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','TEST-3','Synthetic','Borrower','Regular'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','TEST-4','Synthetic','Co-maker','Regular');
INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted,tenure_months,monthly_payment) VALUES
 ('30000000-0000-0000-0000-000000000001','APP-VERIFY','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',1000,'pending',current_date,12,100),
 ('30000000-0000-0000-0000-000000000002','APP-LEGACY','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',1000,'approved',current_date,12,100);
INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','validId','owner/id.pdf','id.pdf','application/pdf',10),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','payslip','owner/payslip.pdf','payslip.pdf','application/pdf',10);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(public.get_application_verification('APP-VERIFY')->>'stage'='not_started','read-only staff sees stage');
SELECT pg_temp.denied($q$SELECT pg_temp.act('start')$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.save_approval_policy_draft(null,'{}',gen_random_uuid())$q$,'42501');
SELECT pg_temp.denied($q$INSERT INTO public.application_consent_evidence(application_id,kind) VALUES('30000000-0000-0000-0000-000000000001','borrower')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT pg_temp.act('start','{}','APP-LEGACY')$q$,'P0001');
DO $$
DECLARE state jsonb; request uuid:=gen_random_uuid(); result jsonb;
BEGIN
 state:=public.get_application_verification('APP-VERIFY');
 result:=public.mutate_application_verification('APP-VERIFY','start',0,state->>'stateHash','{}',request);
 PERFORM pg_temp.assert_true(result=public.mutate_application_verification('APP-VERIFY','start',0,state->>'stateHash','{}',request),'start retry returns saved result');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.application_workflow_events),'enrollment is exactly once');
 PERFORM pg_temp.denied(format('SELECT public.mutate_application_verification(''APP-VERIFY'',''start'',0,%L,''{}'',%L)',state->>'stateHash',gen_random_uuid()),'40001');
END$$;
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
SELECT pg_temp.act('save_draft','{"checks":{"identity":true,"eligibility":true,"terms":true},"notes":"INTERNAL_ONLY"}');
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
SELECT pg_temp.assert_true((public.get_application_verification('APP-VERIFY')->'evidence'->>'borrower')::int=0,'staff checks do not manufacture borrower consent');
SELECT public.save_approval_policy_draft(null,'{"name":"DEMO ONLY synthetic policy","authorizationReference":"","status":"approved","config":{"reviewerCount":null,"quorumRule":"","crecomAuthority":"pending","bodMode":"pending","bodCriteria":"","finalAuthority":"","borrowerConsentRequired":null,"coMakerConsentRequired":null,"witnessCount":null,"allowedConsentMethods":[],"requirementsReference":""}}',gen_random_uuid());
SELECT pg_temp.assert_true((SELECT status='draft' FROM public.approval_workflow_policies),'policy draft cannot self-activate');
SELECT pg_temp.denied($q$UPDATE public.approval_workflow_policies SET status='approved'$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.save_approval_policy_draft(null,'{}',gen_random_uuid())$q$,'40001');
SELECT pg_temp.denied($q$SELECT pg_temp.act('return','{"category":"documents","reason":" ","affectedKinds":["validId"]}')$q$,'P0001');
DO $$
DECLARE state jsonb; request uuid:=gen_random_uuid(); payload jsonb:='{"category":"documents","reason":"Please replace the blurred ID photo.","affectedKinds":["validId"]}'; result jsonb;
BEGIN
 state:=public.get_application_verification('APP-VERIFY');
 result:=public.mutate_application_verification('APP-VERIFY','return',(state->>'revision')::int,state->>'stateHash',payload,request);
 PERFORM pg_temp.assert_true(result=public.mutate_application_verification('APP-VERIFY','return',(state->>'revision')::int,state->>'stateHash',payload,request),'correction retry does not duplicate delivery');
 PERFORM pg_temp.denied(format('SELECT public.mutate_application_verification(''APP-VERIFY'',''save_draft'',%s,%L,''{}'',%L)',state->>'revision',state->>'stateHash',gen_random_uuid()),'40001');
END$$;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.loan_document_reviews WHERE status='needs_replacement'),'selected file is actionable in member replacement flow');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.member_application_corrections())=1,'affected borrower sees correction');
SELECT pg_temp.assert_true(public.member_application_corrections()::text NOT LIKE '%INTERNAL_ONLY%','internal notes never sent to member');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications),'one safe correction inbox item');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.application_workflow_events),'member cannot read staff event history');
SELECT pg_temp.denied($q$SELECT public.get_application_verification('APP-VERIFY')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.member_application_corrections())=0,'other member cannot read correction');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.denied($q$SELECT public.application_workflow_summaries()$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.act('save_draft','{"checks":{"identity":true,"eligibility":true,"terms":true},"notes":"Reviewed again"}');
RESET ROLE;
-- A synthetic approved configuration/evidence is injected by the test owner only.
-- The production feature has no policy activation or consent-forging endpoint.
SELECT pg_temp.denied($q$UPDATE public.approval_workflow_policies SET status='approved',authorization_reference='DEMO ONLY',approved_by='10000000-0000-0000-0000-000000000001',approved_at=now(),effective_at=now()$q$,'23514');
UPDATE public.approval_workflow_policies SET status='approved',authorization_reference='DEMO ONLY test authorization',
 approved_by='10000000-0000-0000-0000-000000000001',approved_at=now(),effective_at=now(),
 config='{"reviewerCount":3,"quorumRule":"Synthetic test rule","crecomAuthority":"recommendation","bodMode":"none","bodCriteria":"","finalAuthority":"Synthetic designated officer","borrowerConsentRequired":true,"coMakerConsentRequired":true,"witnessCount":1,"allowedConsentMethods":["paper"],"requirementsReference":"DEMO ONLY"}';
INSERT INTO public.loan_document_reviews(document_id,status,reviewer_id,reviewer_name) SELECT id,'verified','10000000-0000-0000-0000-000000000001','Synthetic coordinator' FROM public.loan_documents;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act('save_draft','{"checks":{"identity":true,"eligibility":true,"terms":true},"notes":"All staff checks complete"}');
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
RESET ROLE;
INSERT INTO public.application_consent_evidence(application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at)
SELECT '30000000-0000-0000-0000-000000000001',kind,subject,subject_id,'paper','Synthetic evidence fixture',
 public.private_application_verification_state('30000000-0000-0000-0000-000000000001')->>'packetHash',now()
FROM (VALUES('borrower','TEST-3','10000000-0000-0000-0000-000000000003'::uuid),('co_maker','TEST-4','10000000-0000-0000-0000-000000000004'::uuid),('witness','EXTERNAL-WITNESS',null::uuid)) AS e(kind,subject,subject_id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act('mark_verified');
SELECT pg_temp.assert_true(public.get_application_verification('APP-VERIFY')->>'stage'='ready_for_committee','complete verified packet becomes ready');
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.loan_applications WHERE application_id='APP-VERIFY'),'verification preserves canonical loan status');
RESET ROLE;
SELECT pg_temp.denied($q$UPDATE public.loan_applications SET status='approved' WHERE application_id='APP-VERIFY'$q$,'42501');
UPDATE public.loan_applications SET status='released' WHERE application_id='APP-LEGACY';
SELECT pg_temp.assert_true((SELECT status='released' FROM public.loan_applications WHERE application_id='APP-LEGACY'),'unenrolled legacy servicing remains available');
INSERT INTO public.loan_document_versions(document_id,version,storage_path,original_name,content_type,size_bytes,uploaded_by,uploaded_by_name)
VALUES('40000000-0000-0000-0000-000000000001',2,'owner/replacement.pdf','replacement.pdf','application/pdf',10,'10000000-0000-0000-0000-000000000003','Synthetic borrower');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.get_application_verification('APP-VERIFY')->>'stage'='needs_verification','replacement invalidates readiness');
SELECT pg_temp.assert_true((public.get_application_verification('APP-VERIFY')->>'stale')::boolean,'stale verification is explicit');
SELECT pg_temp.assert_true((public.application_workflow_summaries()->0->>'stage')='needs_verification','table filter uses effective current stage');
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data='{"role":"admin","account_status":"active","admin_privileges":["applications.verify"]}' WHERE id='10000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.act('save_draft','{"checks":{"identity":false,"eligibility":true,"terms":true},"notes":"Delegated verification"}');
SELECT pg_temp.denied($q$SELECT pg_temp.act('return','{"category":"information","reason":"Correct details.","affectedKinds":[]}')$q$,'42501');
RESET ROLE;
SELECT 'PASS: enrollment, draft permissions, consent provenance, correction privacy, policy drafts, idempotency, stale versions, legacy servicing and approval guard' AS result;

ROLLBACK;
