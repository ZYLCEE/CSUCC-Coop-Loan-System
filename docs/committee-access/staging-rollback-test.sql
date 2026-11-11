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

-- Phase 2: named committee accounts and scoped read access. No votes or forwarding.

ALTER TABLE public.staff_memberships ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz,
 ADD COLUMN IF NOT EXISTS invitation_request_id uuid,ADD COLUMN IF NOT EXISTS last_invite_at timestamptz;
CREATE TABLE IF NOT EXISTS public.committee_account_requests(
 id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('invite','link','membership')),actor_id uuid NOT NULL REFERENCES auth.users(id),
 email text NOT NULL,payload jsonb NOT NULL,request_hash text NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','failed')),
 auth_user_id uuid REFERENCES auth.users(id),membership_id uuid REFERENCES public.staff_memberships(id),
 attempt_id uuid,lease_until timestamptz,error text,result jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS committee_unique_invite_email ON public.committee_account_requests(lower(email)) WHERE kind='invite';
ALTER TABLE public.staff_memberships DROP CONSTRAINT IF EXISTS staff_membership_invitation_fk;
ALTER TABLE public.staff_memberships ADD CONSTRAINT staff_membership_invitation_fk FOREIGN KEY(invitation_request_id) REFERENCES public.committee_account_requests(id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_membership_invitation_unique ON public.staff_memberships(invitation_request_id) WHERE invitation_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.application_review_cycles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES public.loan_applications(id),
 cycle_no integer NOT NULL CHECK(cycle_no>0),stage text NOT NULL CHECK(stage IN ('CRECOM','BOD')),packet_version integer NOT NULL CHECK(packet_version>0),
 packet_snapshot jsonb NOT NULL CHECK(jsonb_typeof(packet_snapshot)='object'),policy_id uuid NOT NULL REFERENCES public.approval_workflow_policies(id),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','superseded')),
 created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(application_id,cycle_no,stage)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_committee_stage ON public.application_review_cycles(application_id,stage) WHERE status='open';
CREATE TABLE IF NOT EXISTS public.review_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_cycle_id uuid NOT NULL REFERENCES public.application_review_cycles(id),
 reviewer_auth_id uuid NOT NULL REFERENCES auth.users(id),membership_id uuid NOT NULL REFERENCES public.staff_memberships(id),
 state text NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','decision_recorded','awaiting_clarification','recused','cancelled','reassigned')),
 assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),due_at timestamptz,UNIQUE(review_cycle_id,reviewer_auth_id),UNIQUE(id,reviewer_auth_id)
);
CREATE INDEX IF NOT EXISTS review_assignment_recipient_idx ON public.review_assignments(reviewer_auth_id,review_cycle_id);
CREATE TABLE IF NOT EXISTS public.individual_review_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL UNIQUE REFERENCES public.review_assignments(id),
 reviewer_auth_id uuid NOT NULL REFERENCES auth.users(id),packet_version integer NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approve','reject')),reason text CHECK(length(reason)<=2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(assignment_id,reviewer_auth_id) REFERENCES public.review_assignments(id,reviewer_auth_id)
);
CREATE TABLE IF NOT EXISTS public.committee_notification_links(
 notification_id uuid PRIMARY KEY REFERENCES public.notifications(id),assignment_id uuid NOT NULL REFERENCES public.review_assignments(id)
);
CREATE OR REPLACE FUNCTION public.committee_decision_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'Committee decision history is immutable. Use a new authorized review cycle.' USING ERRCODE='42501'; END$$;
DROP TRIGGER IF EXISTS committee_decision_immutable ON public.individual_review_decisions;
CREATE TRIGGER committee_decision_immutable BEFORE UPDATE OR DELETE ON public.individual_review_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();

CREATE OR REPLACE FUNCTION public.committee_identity()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND raw_app_meta_data->>'role' IN ('crecom_member','bod_member'));
$$;
CREATE OR REPLACE FUNCTION public.committee_bod_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT config->>'bodMode' IN ('conditional','required') FROM public.approval_workflow_policies
 WHERE status='approved' AND effective_at<=now() ORDER BY version DESC LIMIT 1),false);
$$;
CREATE OR REPLACE FUNCTION public.committee_membership_eligible(p_id uuid,p_allow_setup boolean DEFAULT false,p_allow_future boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.id=p_id AND m.auth_user_id=auth.uid() AND m.active
  AND (p_allow_future OR m.starts_at<=now()) AND (m.ends_at IS NULL OR m.ends_at>now())
  AND (p_allow_setup OR m.setup_completed_at IS NOT NULL)
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
  AND (m.role='crecom_member' OR public.committee_bod_enabled())
  AND NOT EXISTS(SELECT 1 FROM public.members b WHERE b.user_id=u.id));
$$;
CREATE OR REPLACE FUNCTION public.portal_session_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
  'membershipId',m.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'email',u.email,'startsAt',m.starts_at,'endsAt',m.ends_at);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_assignment_eligible(p_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 JOIN public.staff_memberships m ON m.id=a.membership_id WHERE a.id=p_assignment_id AND a.reviewer_auth_id=auth.uid()
 AND m.auth_user_id=a.reviewer_auth_id AND public.committee_membership_eligible(m.id)
 AND m.role=CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
 AND a.state NOT IN ('cancelled','reassigned') AND c.status IN ('open','completed'));
$$;

ALTER TABLE public.committee_account_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.individual_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committee_notification_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_account_requests,public.application_review_cycles,public.review_assignments,public.individual_review_decisions,public.committee_notification_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.application_review_cycles,public.review_assignments,public.individual_review_decisions TO authenticated;
GRANT ALL ON public.committee_account_requests,public.application_review_cycles,public.review_assignments,public.individual_review_decisions,public.committee_notification_links TO service_role;
DROP POLICY IF EXISTS "Scoped committee assignments" ON public.review_assignments;
CREATE POLICY "Scoped committee assignments" ON public.review_assignments FOR SELECT TO authenticated USING(public.document_staff_access() OR public.committee_assignment_eligible(id));
DROP POLICY IF EXISTS "Scoped committee cycles" ON public.application_review_cycles;
CREATE POLICY "Scoped committee cycles" ON public.application_review_cycles FOR SELECT TO authenticated USING(public.document_staff_access() OR EXISTS(SELECT 1 FROM public.review_assignments a WHERE a.review_cycle_id=application_review_cycles.id AND public.committee_assignment_eligible(a.id)));
DROP POLICY IF EXISTS "Own committee decision history" ON public.individual_review_decisions;
CREATE POLICY "Own committee decision history" ON public.individual_review_decisions FOR SELECT TO authenticated USING(public.document_staff_access() OR (reviewer_auth_id=auth.uid() AND public.committee_assignment_eligible(assignment_id)));
-- Legacy administrative/member tables remain unavailable to committee identities.
DO $$DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['members','loan_applications','loan_documents','loan_document_versions','loan_document_reviews','loan_payments','admin_activity_logs','shared_documents','shared_document_recipients','approval_workflow_policies','application_verifications','application_consent_evidence','application_workflow_events'] LOOP
  IF to_regclass('public.'||table_name) IS NOT NULL THEN
   EXECUTE format('DROP POLICY IF EXISTS committee_legacy_boundary ON public.%I',table_name);
   EXECUTE format('CREATE POLICY committee_legacy_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(NOT public.committee_identity()) WITH CHECK(NOT public.committee_identity())',table_name);
  END IF;
 END LOOP;
END$$;
DROP POLICY IF EXISTS committee_inbox_boundary ON public.notifications;
CREATE POLICY committee_inbox_boundary ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated
 USING(NOT public.committee_identity() OR (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.staff_memberships m WHERE m.auth_user_id=auth.uid() AND public.committee_membership_eligible(m.id))))
 WITH CHECK(NOT public.committee_identity() OR (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.staff_memberships m WHERE m.auth_user_id=auth.uid() AND public.committee_membership_eligible(m.id))));

CREATE OR REPLACE FUNCTION public.committee_accounts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin'
  THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'email'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('id',m.id,'requestId',m.invitation_request_id,'userId',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'email',u.email,'role',m.role,'title',m.title,'startsAt',m.starts_at,'endsAt',m.ends_at,'active',m.active,'revision',m.revision,'setupCompletedAt',m.setup_completed_at,
   'status',CASE WHEN NOT m.active THEN 'inactive' WHEN m.ends_at<=now() THEN 'expired' WHEN m.role='bod_member' AND NOT public.committee_bod_enabled() THEN 'policy_disabled' WHEN m.setup_completed_at IS NULL THEN 'invited' WHEN m.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'lastSignInAt',u.last_sign_in_at,'assignedCount',(SELECT count(*) FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE a.membership_id=m.id AND c.status='open' AND a.state IN ('assigned','awaiting_clarification')),
   'lastInviteAt',m.last_invite_at,'error',null) AS row FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  UNION ALL
  SELECT jsonb_build_object('id',r.id,'requestId',r.id,'userId',r.auth_user_id,'name',r.payload->>'name','email',r.email,'role',r.payload->>'role','title',r.payload->>'title',
   'startsAt',r.payload->>'startsAt','endsAt',r.payload->>'endsAt','active',false,'revision',0,'setupCompletedAt',null,
   'status',CASE WHEN r.state='failed' THEN 'failed' ELSE 'provisioning' END,'lastSignInAt',null,'assignedCount',0,'lastInviteAt',r.created_at,'error',r.error)
   FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state<>'complete'
 )records;
 RETURN jsonb_build_object('accounts',rows,'bodEnabled',public.committee_bod_enabled());
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_account_assignments(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'stage',c.stage,'cycle',c.cycle_no,'state',a.state,'assignedAt',a.assigned_at,'dueAt',a.due_at,
  'needsReassignment',c.status='open' AND a.state IN ('assigned','awaiting_clarification') AND
    (NOT m.active OR m.starts_at>now() OR m.ends_at<=now() OR m.role<>CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END))
  ORDER BY a.assigned_at DESC),'[]') INTO rows FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
  JOIN public.staff_memberships m ON m.id=a.membership_id WHERE m.id=p_id;
 RETURN rows;
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
 IF p_payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD membership requires an approved policy enabling the BOD stage.'; END IF;
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
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-request',p_request_id::text,'success',jsonb_build_object('role',p_payload->>'role','email',invite_email));
 END IF;
 SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;
 IF FOUND AND (existing.invited_at IS NULL OR (existing.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text
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
 IF lower(u.email)<>lower(r.email) OR u.invited_at IS NULL OR u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role'
  OR u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id)
  THEN RAISE EXCEPTION 'The invited account could not be verified.'; END IF;
 IF r.payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD access is not enabled.'; END IF;
 INSERT INTO public.staff_memberships(auth_user_id,role,active,starts_at,ends_at,assigned_by,title,invitation_request_id,last_invite_at)
 VALUES(u.id,r.payload->>'role',true,(r.payload->>'startsAt')::timestamptz,(r.payload->>'endsAt')::timestamptz,auth.uid(),coalesce(r.payload->>'title',''),r.id,clock_timestamp()) RETURNING id INTO membership;
 UPDATE public.committee_account_requests SET state='complete',auth_user_id=u.id,membership_id=membership,result=jsonb_build_object('membershipId',membership),lease_until=null WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-complete',membership::text,'success',jsonb_build_object('requestId',r.id,'role',r.payload->>'role'));
 RETURN jsonb_build_object('membershipId',membership);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_request_failed(p_request_id uuid,p_attempt_id uuid,p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 UPDATE public.committee_account_requests SET state='failed',error=left(p_message,500),lease_until=null WHERE id=p_request_id AND actor_id=auth.uid() AND attempt_id=p_attempt_id AND state<>'complete';
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_change_membership(p_id uuid,p_revision integer,p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text; next_role text; starts timestamptz; ends timestamptz; next_active boolean; result jsonb;
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
 next_role:=m.role;starts:=m.starts_at;ends:=m.ends_at;next_active:=m.active;
 IF p_action='edit' THEN
  next_role:=p_payload->>'role';starts:=(p_payload->>'startsAt')::timestamptz;ends:=(p_payload->>'endsAt')::timestamptz;
  IF next_role IS NULL OR next_role NOT IN ('crecom_member','bod_member') OR starts IS NULL OR ends<=starts OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Choose valid membership details.'; END IF;
 ELSIF p_action='deactivate' THEN next_active:=false;
 ELSE next_active:=true; IF ends<=now() THEN RAISE EXCEPTION 'Update expired membership dates before reactivation.'; END IF;
 END IF;
 IF next_role='bod_member' AND next_active AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'An approved policy must enable BOD access first.'; END IF;
 UPDATE public.staff_memberships SET role=next_role,starts_at=starts,ends_at=ends,active=next_active,title=CASE WHEN p_action='edit' THEN coalesce(p_payload->>'title','') ELSE title END,revision=revision+1 WHERE id=m.id;
 IF next_role IS DISTINCT FROM m.role THEN UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}',to_jsonb(next_role)) WHERE id=u.id; END IF;
 result:=jsonb_build_object('id',m.id,'revision',m.revision+1);
 INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,state,auth_user_id,membership_id,result)
 VALUES(p_request_id,'membership',auth.uid(),u.email,p_payload,fingerprint,'complete',u.id,m.id,result);
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'committee-membership-'||p_action,m.id::text,'success',jsonb_build_object('reason',p_payload->>'reason','oldRole',m.role,'newRole',next_role,'active',next_active,'requestId',p_request_id));
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_begin_link(p_id uuid,p_revision integer,p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
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
$$;
CREATE OR REPLACE FUNCTION public.committee_finish_link(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.committee_account_requests%ROWTYPE;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request_id AND kind='link' FOR UPDATE;
 IF r.actor_id<>auth.uid() OR r.attempt_id IS DISTINCT FROM p_attempt_id THEN RAISE EXCEPTION 'This setup link request changed.' USING ERRCODE='40001'; END IF;
 IF r.state='complete' THEN RETURN jsonb_build_object('success',true); END IF;
 UPDATE public.committee_account_requests SET state='complete',lease_until=null,result='{"success":true}' WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-setup-link',r.membership_id::text,'success',jsonb_build_object('requestId',r.id));
 RETURN jsonb_build_object('success',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_complete_setup(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 SELECT * INTO m FROM public.staff_memberships WHERE auth_user_id=u.id AND role=u.raw_app_meta_data->>'role' ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;
 IF m.id IS NULL OR NOT m.active OR m.ends_at<=now() OR u.email_confirmed_at IS NULL
  OR coalesce(u.raw_app_meta_data->>'account_status','active')<>'active' OR u.banned_until>now()
  OR (m.role='bod_member' AND NOT public.committee_bod_enabled()) OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id)
  OR u.invited_at IS NULL OR length(coalesce(u.encrypted_password,''))=0 THEN RAISE EXCEPTION 'Complete a valid account invitation and password setup first.' USING ERRCODE='42501'; END IF;
 IF m.setup_completed_at IS NULL THEN
  UPDATE public.staff_memberships SET setup_completed_at=clock_timestamp(),revision=revision+1 WHERE id=m.id;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(u.id,'committee-own-setup',m.id::text,'success','{}');
 END IF;
 RETURN jsonb_build_object('success',true);
END;
$$;
-- Only the server may invoke membership mutations, after verifying the
-- Super Admin's current password. A browser session alone cannot bypass that step.
CREATE OR REPLACE FUNCTION public.committee_account_action(p_actor_id uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true); result jsonb;
BEGIN
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id AND raw_app_meta_data->>'role'='super_admin') THEN
  RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
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
$$;
CREATE OR REPLACE FUNCTION public.committee_self_activity(p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() OR p_action IS NULL OR p_action NOT IN ('profile','password') THEN RAISE EXCEPTION 'Active committee access is required.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-own-'||p_action,auth.uid()::text,'success','{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_workspace()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE assignments jsonb; history jsonb; access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() THEN RAISE EXCEPTION 'Active committee membership is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'applicant',c.packet_snapshot->'summary'->>'applicant','memberNumber',c.packet_snapshot->'summary'->>'memberNumber','loanType',c.packet_snapshot->'summary'->>'loanType',
  'amount',(c.packet_snapshot->'summary'->>'amount')::numeric,'stage',c.stage,'cycle',c.cycle_no,'packetVersion',c.packet_version,'assignedAt',a.assigned_at,'dueAt',a.due_at,'state',a.state,
  'responded',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state='decision_recorded'),
  'assigned',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state NOT IN ('cancelled','reassigned'))) ORDER BY a.assigned_at DESC),'[]')
 INTO assignments FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE public.committee_assignment_eligible(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'assignmentId',d.assignment_id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'cycle',c.cycle_no,'packetVersion',d.packet_version,'decision',d.decision,'reason',d.reason,'createdAt',d.created_at) ORDER BY d.created_at DESC),'[]')
 INTO history FROM public.individual_review_decisions d JOIN public.review_assignments a ON a.id=d.assignment_id JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 WHERE d.reviewer_auth_id=auth.uid() AND public.committee_assignment_eligible(a.id);
 RETURN jsonb_build_object('assignments',assignments,'history',history,'counts',jsonb_build_object('assigned',jsonb_array_length(assignments),
  'pending',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='assigned'),
  'waiting',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='decision_recorded' AND (x->>'responded')::integer<(x->>'assigned')::integer),
  'clarification',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='awaiting_clarification'),'completed',jsonb_array_length(history)));
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_review_packet(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; assignment jsonb; documents jsonb;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned case.' USING ERRCODE='42501'; END IF;
 SELECT c1.* INTO STRICT c FROM public.review_assignments a JOIN public.application_review_cycles c1 ON c1.id=a.review_cycle_id WHERE a.id=p_assignment_id;
 SELECT x INTO assignment FROM jsonb_array_elements(public.committee_workspace()->'assignments') x WHERE x->>'id'=p_assignment_id::text;
 SELECT coalesce(jsonb_agg(jsonb_build_object('documentId',x->>'documentId','versionId',x->>'versionId','kind',x->>'kind','name',x->>'name')),'[]') INTO documents FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]')) x;
 RETURN jsonb_build_object('assignment',assignment,'summary',c.packet_snapshot->'summary','findings',coalesce(c.packet_snapshot->>'staffFindings',''),
  'consentSummary',coalesce(c.packet_snapshot->>'consentSummary',''),'documents',documents);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_document_location(p_assignment_id uuid,p_document_id uuid,p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; d public.loan_documents%ROWTYPE; v public.loan_document_versions%ROWTYPE;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned document.' USING ERRCODE='42501'; END IF;
 SELECT c1.* INTO STRICT c FROM public.review_assignments a JOIN public.application_review_cycles c1 ON c1.id=a.review_cycle_id WHERE a.id=p_assignment_id;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]')) x WHERE x->>'documentId'=p_document_id::text AND (x->>'versionId')::uuid IS NOT DISTINCT FROM p_version_id) THEN RAISE EXCEPTION 'This file version is not part of your assigned packet.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT d FROM public.loan_documents WHERE id=p_document_id AND loan_application_id=c.application_id;
 IF p_version_id IS NULL THEN RETURN jsonb_build_object('path',d.storage_path,'name',d.original_name,'contentType',d.content_type); END IF;
 SELECT * INTO STRICT v FROM public.loan_document_versions WHERE id=p_version_id AND document_id=d.id;
 RETURN jsonb_build_object('path',v.storage_path,'name',v.original_name,'contentType',v.content_type);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_can_read_loan_object(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]')) x
 JOIN public.loan_documents d ON d.id=(x->>'documentId')::uuid AND d.loan_application_id=c.application_id
 LEFT JOIN public.loan_document_versions v ON v.id=(x->>'versionId')::uuid AND v.document_id=d.id
 WHERE public.committee_assignment_eligible(a.id)
 AND (CASE WHEN x->>'versionId' IS NULL THEN d.storage_path ELSE v.storage_path END)=p_name);
$$;
DROP POLICY IF EXISTS "Scoped committee packet files" ON storage.objects;
CREATE POLICY "Scoped committee packet files" ON storage.objects FOR SELECT TO authenticated USING(bucket_id='loan-documents' AND public.committee_can_read_loan_object(name));
DROP POLICY IF EXISTS committee_storage_read_boundary ON storage.objects;
CREATE POLICY committee_storage_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(NOT public.committee_identity() OR (bucket_id='loan-documents' AND public.committee_can_read_loan_object(name)));
DROP POLICY IF EXISTS committee_storage_insert_boundary ON storage.objects;
CREATE POLICY committee_storage_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.committee_identity());
DROP POLICY IF EXISTS committee_storage_update_boundary ON storage.objects;
CREATE POLICY committee_storage_update_boundary ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(NOT public.committee_identity()) WITH CHECK(NOT public.committee_identity());
DROP POLICY IF EXISTS committee_storage_delete_boundary ON storage.objects;
CREATE POLICY committee_storage_delete_boundary ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(NOT public.committee_identity());

CREATE OR REPLACE FUNCTION public.committee_inbox(p_read_id uuid DEFAULT NULL,p_all boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb; access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() THEN RAISE EXCEPTION 'Active committee access is required.' USING ERRCODE='42501'; END IF;
 IF p_all THEN UPDATE public.notifications SET read=true WHERE user_id=auth.uid() AND read=false;
 ELSIF p_read_id IS NOT NULL THEN UPDATE public.notifications SET read=true WHERE user_id=auth.uid() AND id=p_read_id; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'message',n.message,'read',n.read,'createdAt',n.created_at,'assignmentId',l.assignment_id,
  'accessAvailable',CASE WHEN l.assignment_id IS NULL THEN false ELSE public.committee_assignment_eligible(l.assignment_id) END) ORDER BY n.created_at DESC,n.id DESC),'[]') INTO rows
 FROM public.notifications n LEFT JOIN public.committee_notification_links l ON l.notification_id=n.id WHERE n.user_id=auth.uid();
 RETURN rows;
END;
$$;

REVOKE ALL ON FUNCTION public.committee_identity(),public.committee_bod_enabled(),public.committee_membership_eligible(uuid,boolean,boolean),
 public.committee_account_assignments(uuid),public.committee_self_activity(text),
 public.portal_session_access(),public.committee_assignment_eligible(uuid),public.committee_accounts(),public.committee_reserve_invite(uuid,uuid,jsonb),
 public.committee_finish_invite(uuid,uuid,uuid),public.committee_request_failed(uuid,uuid,text),public.committee_change_membership(uuid,integer,text,jsonb,uuid),
 public.committee_begin_link(uuid,integer,uuid,uuid),public.committee_finish_link(uuid,uuid),
 public.committee_workspace(),public.committee_review_packet(uuid),public.committee_document_location(uuid,uuid,uuid),public.committee_can_read_loan_object(text),public.committee_inbox(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.committee_identity(),public.committee_bod_enabled(),public.committee_membership_eligible(uuid,boolean,boolean),
 public.committee_account_assignments(uuid),public.committee_self_activity(text),
 public.portal_session_access(),public.committee_assignment_eligible(uuid),public.committee_accounts(),public.committee_reserve_invite(uuid,uuid,jsonb),
 public.committee_finish_invite(uuid,uuid,uuid),public.committee_request_failed(uuid,uuid,text),public.committee_change_membership(uuid,integer,text,jsonb,uuid),
 public.committee_begin_link(uuid,integer,uuid,uuid),public.committee_finish_link(uuid,uuid),
 public.committee_workspace(),public.committee_review_packet(uuid),public.committee_document_location(uuid,uuid,uuid),public.committee_can_read_loan_object(text),public.committee_inbox(uuid,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.committee_complete_setup(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.committee_complete_setup(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.committee_reserve_invite(uuid,uuid,jsonb),public.committee_finish_invite(uuid,uuid,uuid),
 public.committee_request_failed(uuid,uuid,text),public.committee_change_membership(uuid,integer,text,jsonb,uuid),
 public.committee_begin_link(uuid,integer,uuid,uuid),public.committee_finish_link(uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.committee_account_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.committee_account_action(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.committee_decision_immutable() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';

-- Test-only stand-ins for the password-verified Next.js server. Never deployed.
CREATE FUNCTION pg_temp.committee_reserve_invite(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_reserve_invite',jsonb_build_object('p_request_id',p_request_id,'p_attempt_id',p_attempt_id,'p_payload',p_payload));
$$;
CREATE FUNCTION pg_temp.committee_finish_invite(p_request_id uuid,p_attempt_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_finish_invite',jsonb_build_object('p_request_id',p_request_id,'p_attempt_id',p_attempt_id,'p_user_id',p_user_id));
$$;
CREATE FUNCTION pg_temp.committee_change_membership(p_id uuid,p_revision integer,p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_change_membership',jsonb_build_object('p_id',p_id,'p_revision',p_revision,'p_action',p_action,'p_payload',p_payload,'p_request_id',p_request_id));
$$;
CREATE FUNCTION pg_temp.committee_begin_link(p_id uuid,p_revision integer,p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_begin_link',jsonb_build_object('p_id',p_id,'p_revision',p_revision,'p_request_id',p_request_id,'p_attempt_id',p_attempt_id));
$$;
CREATE FUNCTION pg_temp.committee_finish_link(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_finish_link',jsonb_build_object('p_request_id',p_request_id,'p_attempt_id',p_attempt_id));
$$;

CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END$$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'Expected rejection: %',command;
END$$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,encrypted_password) VALUES
 ('10000000-0000-0000-0000-000000000001','committee-super@example.invalid','{"role":"super_admin","account_status":"active"}','{"full_name":"Synthetic Super Admin"}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000002','committee-admin@example.invalid','{"role":"admin","account_status":"active"}','{}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000003','committee-borrower@example.invalid','{"role":"member","account_status":"active"}','{}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000005','committee-b@example.invalid','{"role":"crecom_member","account_status":"active"}','{"full_name":"Reviewer B"}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000006','committee-bod@example.invalid','{"role":"bod_member","account_status":"active"}','{}',now(),'synthetic-hash');
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,status,role) VALUES
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','TEST-3','Synthetic','Borrower','active','Member');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.denied($q$SELECT public.committee_accounts()$q$,'42501');
SELECT pg_temp.denied($q$SELECT pg_temp.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),'{}')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT pg_temp.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),'{"name":"BOD","email":"new-bod@example.invalid","role":"bod_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":""}')$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),'{"name":"Borrower","email":"committee-borrower@example.invalid","role":"crecom_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":""}')$q$,'P0001');
SELECT pg_temp.committee_reserve_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','{"name":"Reviewer A","email":"committee-a@example.invalid","role":"crecom_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":"Committee member"}');
SELECT pg_temp.denied($q$SELECT pg_temp.committee_reserve_invite('60000000-0000-0000-0000-000000000001',gen_random_uuid(),'{"name":"Reviewer A","email":"committee-a@example.invalid","role":"crecom_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":"Committee member"}')$q$,'55P03');
RESET ROLE;
-- Synthetic account-provider response: no email is sent by this test.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,invited_at)
 VALUES('10000000-0000-0000-0000-000000000004','committee-a@example.invalid','{}','{"full_name":"Reviewer A","committee_invitation_request_id":"60000000-0000-0000-0000-000000000001"}',now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied($q$SELECT pg_temp.committee_finish_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004')$q$,'P0001');
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data='{"role":"crecom_member","account_status":"active","committee_invitation_request_id":"60000000-0000-0000-0000-000000000001"}' WHERE id='10000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.committee_finish_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004');
SELECT pg_temp.committee_finish_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.staff_memberships),'invitation retry creates one membership');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'invited account cannot enter before setup');
SELECT pg_temp.denied($q$SELECT public.committee_complete_setup('10000000-0000-0000-0000-000000000004')$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.committee_workspace()$q$,'42501');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now(),encrypted_password='synthetic-provider-updated-hash' WHERE id='10000000-0000-0000-0000-000000000004';
SELECT public.committee_complete_setup('10000000-0000-0000-0000-000000000004');
INSERT INTO public.staff_memberships(id,auth_user_id,role,active,starts_at,assigned_by,setup_completed_at) VALUES
 ('80000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','crecom_member',true,now()-interval '1 day','10000000-0000-0000-0000-000000000001',now()),
 ('80000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','bod_member',true,now()-interval '1 day','10000000-0000-0000-0000-000000000001',now());
INSERT INTO public.approval_workflow_policies(id,name,status,config,authorization_reference,effective_at,approved_by,approved_at,created_by,created_by_name)
 VALUES('90000000-0000-0000-0000-000000000001','DEMO ONLY','approved','{"reviewerCount":3,"quorumRule":"DEMO ONLY","crecomAuthority":"recommendation","bodMode":"none","bodCriteria":"","finalAuthority":"DEMO ONLY","borrowerConsentRequired":true,"coMakerConsentRequired":true,"witnessCount":0,"allowedConsentMethods":["paper"],"requirementsReference":"DEMO ONLY"}','DEMO ONLY',now()-interval '1 day','10000000-0000-0000-0000-000000000001',now(),'10000000-0000-0000-0000-000000000001','Synthetic Super Admin');
INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted) VALUES
 ('30000000-0000-0000-0000-000000000001','APP-ASSIGNED','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',2000,'pending',current_date),
 ('30000000-0000-0000-0000-000000000002','APP-UNRELATED','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',5000,'pending',current_date);
INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','validId','10000000-0000-0000-0000-000000000003/original.pdf','original.pdf','application/pdf',10),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','validId','10000000-0000-0000-0000-000000000003/unrelated.pdf','unrelated.pdf','application/pdf',10);
INSERT INTO public.loan_document_versions(id,document_id,version,storage_path,original_name,content_type,size_bytes,uploaded_by,uploaded_by_name)
 VALUES('41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',2,'10000000-0000-0000-0000-000000000003/replacement.pdf','replacement.pdf','application/pdf',10,'10000000-0000-0000-0000-000000000003','Synthetic borrower');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('loan-documents','10000000-0000-0000-0000-000000000003/original.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('loan-documents','10000000-0000-0000-0000-000000000003/replacement.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('loan-documents','10000000-0000-0000-0000-000000000003/unrelated.pdf','{"size":10,"mimetype":"application/pdf"}');
INSERT INTO public.application_review_cycles(id,application_id,cycle_no,stage,packet_version,packet_snapshot,policy_id,created_by) VALUES
 ('a0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'CRECOM',1,'{"summary":{"applicationId":"APP-ASSIGNED","applicant":"Synthetic Borrower","memberNumber":"TEST-3","loanType":"Business","amount":1000},"documents":[{"documentId":"40000000-0000-0000-0000-000000000001","versionId":null,"kind":"validId","name":"original.pdf"}],"staffFindings":"Synthetic findings"}','90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',1,'CRECOM',1,'{"summary":{"applicationId":"APP-UNRELATED","applicant":"Synthetic Borrower","memberNumber":"TEST-3","loanType":"Business","amount":5000},"documents":[]}','90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO public.review_assignments(id,review_cycle_id,reviewer_auth_id,membership_id,state)
 SELECT 'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',id,'decision_recorded' FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004';
INSERT INTO public.review_assignments(id,review_cycle_id,reviewer_auth_id,membership_id) VALUES
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','80000000-0000-0000-0000-000000000005'),
 ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','80000000-0000-0000-0000-000000000005');
INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,packet_version,decision) VALUES('b0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',1,'approve');
SELECT pg_temp.denied($q$UPDATE public.individual_review_decisions SET decision='reject'$q$,'42501');
INSERT INTO public.notifications(id,user_id,title,message,type) VALUES
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','Assigned case','APP-ASSIGNED','info'),
 ('c0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','Private other reviewer','APP-UNRELATED','info');
INSERT INTO public.committee_notification_links VALUES('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001');
-- Even a permissive legacy read policy cannot expose these tables to committee users.
CREATE POLICY synthetic_legacy_read ON public.loan_applications FOR SELECT TO authenticated USING(true);
ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_legacy_members_read ON public.members FOR SELECT TO authenticated USING(true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean,'active reviewer enters own portal');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_applications),'reviewer cannot bulk-read applications');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.members),'reviewer cannot read member directory');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_workspace()->'assignments')=1,'reviewer sees assigned cases only');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_workspace()->'history')=1,'own attributable history only');
SELECT pg_temp.assert_true(public.committee_review_packet('b0000000-0000-0000-0000-000000000001')->'summary'->>'amount'='1000','review uses frozen terms rather than mutable current loan');
SELECT pg_temp.denied($q$SELECT public.committee_review_packet('b0000000-0000-0000-0000-000000000003')$q$,'42501');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='loan-documents'),'only exact assigned file version is readable');
SELECT public.committee_document_location('b0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',null);
SELECT pg_temp.denied($q$SELECT public.committee_document_location('b0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001')$q$,'42501');
SELECT pg_temp.denied($q$INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,packet_version,decision) VALUES('b0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004',1,'approve')$q$,'42501');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_inbox())=1,'inbox is recipient scoped');
SELECT public.committee_inbox('c0000000-0000-0000-0000-000000000002',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'BOD access remains disabled without policy');
SELECT pg_temp.denied($q$SELECT public.committee_workspace()$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),2,'deactivate','{"reason":"Synthetic membership revocation"}','d0000000-0000-0000-0000-000000000001');
SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),2,'deactivate','{"reason":"Synthetic membership revocation"}','d0000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_account_assignments((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004')))=1,'deactivation preserves assignment history');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'revocation takes effect without JWT refresh');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='loan-documents'),'revoked account cannot obtain new file access');
SELECT pg_temp.denied($q$SELECT public.committee_review_packet('b0000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.individual_review_decisions),'historical decisions retained');
SELECT pg_temp.assert_true((SELECT read=false FROM public.notifications WHERE id='c0000000-0000-0000-0000-000000000002'),'cannot mark someone else notification read');
UPDATE public.approval_workflow_policies SET config=jsonb_set(jsonb_set(config,'{bodMode}','"required"'),'{bodCriteria}','"DEMO ONLY BOD rule"');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean,'BOD enabled only by approved configuration');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_workspace()->'assignments')=0,'BOD membership cannot read CRECOM queue');
RESET ROLE;
-- Current dates, optimistic revisions, and link cooldown remain enforced server-side.
UPDATE public.staff_memberships SET last_invite_at=now()-interval '2 minutes' WHERE auth_user_id='10000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied('SELECT public.'||'committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),''{}'')','42501');
SELECT pg_temp.denied($q$SELECT public.committee_account_action('10000000-0000-0000-0000-000000000001','committee_change_membership','{}')$q$,'42501');
SELECT pg_temp.denied($q$SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),1,'reactivate','{"reason":"Stale revision"}',gen_random_uuid())$q$,'40001');
SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),3,'reactivate','{"reason":"Renewed membership"}','d0000000-0000-0000-0000-000000000002');
SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),4,'edit',jsonb_build_object('role','crecom_member','startsAt',now()-interval '1 year','endsAt',now()-interval '1 day','title','Member','reason','Expired appointment'),gen_random_uuid());
SELECT pg_temp.denied($q$SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),5,'reactivate','{"reason":"Expired reactivation"}',gen_random_uuid())$q$,'P0001');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'expired appointment denies access');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),5,'edit',jsonb_build_object('role','crecom_member','startsAt',now()+interval '1 day','endsAt',null,'title','Member','reason','Future appointment'),gen_random_uuid());
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'future appointment denies early case access');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),6,'edit',jsonb_build_object('role','crecom_member','startsAt',now()-interval '1 day','endsAt',null,'title','Member','reason','Current appointment'),gen_random_uuid());
SELECT pg_temp.committee_begin_link((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),7,'e0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001');
SELECT pg_temp.denied($q$SELECT pg_temp.committee_begin_link((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),8,gen_random_uuid(),gen_random_uuid())$q$,'55P03');
SELECT pg_temp.committee_finish_link('e0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001');
SELECT pg_temp.committee_finish_link('e0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001');
SELECT pg_temp.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),8,'edit',jsonb_build_object('role','bod_member','startsAt',now()-interval '1 day','endsAt',null,'title','BOD Member','reason','Authorized committee change'),gen_random_uuid());
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.portal_session_access()->>'role'='bod_member','role changes use trusted current metadata');
SELECT pg_temp.denied($q$SELECT public.committee_review_packet('b0000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.admin_activity_logs WHERE action_name='committee-setup-link'),'completed link replay does not duplicate audit');
SELECT 'PASS: invitation provisioning, password-step boundary, membership revisions/dates, link cooldown/replay, reviewer scope, pinned files, private notifications, revocation and conditional BOD' AS result;

ROLLBACK;
