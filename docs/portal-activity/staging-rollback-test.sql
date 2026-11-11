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

-- Phase 3. No policies, accounts, assignments or loan decisions are seeded.

CREATE TABLE public.committee_policy_rules(
 policy_id uuid PRIMARY KEY REFERENCES public.approval_workflow_policies(id),
 crecom_approvals integer NOT NULL CHECK(crecom_approvals BETWEEN 1 AND 100),
 bod_reviewers integer CHECK(bod_reviewers BETWEEN 1 AND 100),bod_approvals integer CHECK(bod_approvals BETWEEN 1 AND bod_reviewers),
 final_mode text NOT NULL CHECK(final_mode='super_admin'),
 allow_override boolean NOT NULL,bod_authority text NOT NULL CHECK(bod_authority IN ('pending','recommendation','binding_decision')),
 all_responses boolean NOT NULL CHECK(all_responses),rule_reference text NOT NULL CHECK(length(btrim(rule_reference)) BETWEEN 1 AND 500),
 activated_by uuid NOT NULL REFERENCES auth.users(id),activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.application_review_cycles ADD COLUMN required_approvals integer CHECK(required_approvals>0),
 ADD COLUMN reviewer_target integer CHECK(reviewer_target>0),ADD COLUMN outcome text CHECK(outcome IN ('approve','reject')),
 ADD COLUMN bod_required boolean NOT NULL DEFAULT false,ADD COLUMN routing_reason text NOT NULL DEFAULT '',ADD COLUMN closed_at timestamptz;
ALTER TABLE public.review_assignments ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.individual_review_decisions ADD COLUMN reviewer_name text,
 ADD COLUMN confirmation_text text,ADD COLUMN confirmation_method text CHECK(confirmation_method='account_password');
CREATE TABLE public.committee_review_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,request_hash text NOT NULL,
 application_id uuid NOT NULL REFERENCES public.loan_applications(id),cycle_id uuid REFERENCES public.application_review_cycles(id),
 assignment_id uuid REFERENCES public.review_assignments(id),actor_id uuid NOT NULL REFERENCES auth.users(id),actor_name text NOT NULL,
 action text NOT NULL CHECK(action IN ('forward','forward_bod','approve','reject','clarify','recuse','reply','reassign','reopen','finalize')),
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.application_final_decisions(
 application_id uuid PRIMARY KEY REFERENCES public.loan_applications(id),policy_id uuid NOT NULL REFERENCES public.approval_workflow_policies(id),
 decision text NOT NULL CHECK(decision IN ('approve','reject')),mode text NOT NULL CHECK(mode='super_admin'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),state_hash text NOT NULL,cycle_ids uuid[] NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.committee_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committee_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_final_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_policy_rules,public.committee_review_events,public.application_final_decisions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.committee_policy_rules,public.committee_review_events,public.application_final_decisions TO authenticated;
GRANT ALL ON public.committee_policy_rules,public.committee_review_events,public.application_final_decisions TO service_role;
CREATE POLICY staff_read_policy_rules ON public.committee_policy_rules FOR SELECT TO authenticated USING(public.document_staff_access());
CREATE POLICY staff_read_review_events ON public.committee_review_events FOR SELECT TO authenticated USING(public.document_staff_access());
CREATE POLICY staff_read_final_decisions ON public.application_final_decisions FOR SELECT TO authenticated USING(public.document_staff_access());
CREATE TRIGGER immutable_final_decision BEFORE UPDATE OR DELETE ON public.application_final_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();
CREATE TRIGGER immutable_execution_rules BEFORE UPDATE OR DELETE ON public.committee_policy_rules FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();
CREATE TRIGGER immutable_review_events BEFORE UPDATE OR DELETE ON public.committee_review_events FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();

CREATE FUNCTION public.committee_reviewer_available(p_membership uuid,p_application uuid,p_stage text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  JOIN public.loan_applications a ON a.id=p_application JOIN public.members borrower ON borrower.id=a.member_id
  WHERE m.id=p_membership AND m.role=CASE WHEN p_stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
  AND m.active AND m.starts_at<=now() AND (m.ends_at IS NULL OR m.ends_at>now()) AND m.setup_completed_at IS NOT NULL
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
  AND (m.role='crecom_member' OR public.committee_bod_enabled())
  AND m.auth_user_id IS DISTINCT FROM borrower.user_id
  AND NOT EXISTS(SELECT 1 FROM public.members b WHERE b.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.members cm WHERE cm.id::text=to_jsonb(a)->>'co_maker_member_id' AND cm.user_id=u.id));
$$;
CREATE FUNCTION public.committee_packet_is_current(p_cycle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.application_review_cycles c JOIN public.application_verifications v ON v.application_id=c.application_id
 CROSS JOIN LATERAL(SELECT public.private_application_verification_state(c.application_id) AS state)s
 WHERE c.id=p_cycle AND c.status IN ('open','completed') AND v.stage='ready_for_committee'
 AND v.policy_id=c.policy_id AND v.verified_state_hash=c.packet_snapshot->>'stateHash'
 AND c.packet_snapshot->>'stateHash'=s.state->>'stateHash' AND jsonb_array_length(s.state->'blockers')=0);
$$;
CREATE FUNCTION public.committee_application_stage(p_application uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; d public.application_final_decisions%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 IF FOUND THEN RETURN CASE WHEN d.decision='approve' THEN 'final_approved' ELSE 'final_rejected' END; END IF;
 SELECT * INTO c FROM public.application_review_cycles WHERE application_id=p_application AND status<>'superseded' ORDER BY cycle_no DESC,CASE WHEN stage='BOD' THEN 0 ELSE 1 END LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT public.committee_packet_is_current(c.id) THEN RETURN 'review_stale'; END IF;
 IF c.status='open' THEN
  IF EXISTS(SELECT 1 FROM public.review_assignments WHERE review_cycle_id=c.id AND state IN ('awaiting_clarification','recused')) THEN RETURN 'review_attention'; END IF;
  RETURN CASE WHEN c.stage='CRECOM' THEN 'crecom_review' ELSE 'bod_review' END;
 END IF;
 IF c.stage='CRECOM' AND c.bod_required THEN RETURN 'ready_for_bod'; END IF;
 RETURN 'ready_for_final';
END;
$$;
CREATE FUNCTION public.committee_record_final(p_application uuid,p_decision text,p_mode text,p_reason text)
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
 recommendation:=c.outcome;chosen_cycles:=ARRAY[c.id];
 IF c.bod_required THEN
  SELECT * INTO b FROM public.application_review_cycles WHERE application_id=a.id AND cycle_no=c.cycle_no AND stage='BOD' AND status='completed';
  IF b.id IS NULL OR b.outcome IS NULL OR NOT public.committee_packet_is_current(b.id) THEN RAISE EXCEPTION 'Complete the required current BOD review first.'; END IF;
  chosen_cycles:=array_append(chosen_cycles,b.id);
  IF b.outcome='reject' THEN recommendation:='reject'; END IF;
 END IF;
 IF p_mode IS DISTINCT FROM r.final_mode OR p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Choose the authorized final decision and enter its reason.'; END IF;
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' OR p_mode<>'super_admin' THEN RAISE EXCEPTION 'Super Admin final authority is required.' USING ERRCODE='42501'; END IF;
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

CREATE FUNCTION public.committee_activate_policy(p_policy_id uuid,p_rules jsonb,p_request_id uuid)
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
  OR p_rules->>'finalMode' IS DISTINCT FROM 'super_admin' OR p_rules->>'allowOverride' IS DISTINCT FROM 'false'
  OR length(btrim(coalesce(p_rules->>'ruleReference',''))) NOT BETWEEN 1 AND 500
  OR length(btrim(p.authorization_reference))=0 THEN RAISE EXCEPTION 'Complete the approved voting, final-authority and authorization references.'; END IF;
 IF p.config->>'bodMode'<>'none' AND (bn IS NULL OR bn NOT BETWEEN 1 AND 100 OR ba IS NULL OR ba NOT BETWEEN 1 AND bn OR coalesce(p_rules->>'bodAuthority','pending') NOT IN ('recommendation','binding_decision')) THEN RAISE EXCEPTION 'Complete BOD reviewer counts, approval threshold and authority.'; END IF;
 UPDATE public.approval_workflow_policies SET status='approved',effective_at=now(),approved_at=clock_timestamp(),approved_by=auth.uid() WHERE id=p.id;
 INSERT INTO public.committee_policy_rules(policy_id,crecom_approvals,bod_reviewers,bod_approvals,final_mode,allow_override,bod_authority,all_responses,rule_reference,activated_by)
 VALUES(p.id,ca,CASE WHEN p.config->>'bodMode'='none' THEN NULL ELSE bn END,CASE WHEN p.config->>'bodMode'='none' THEN NULL ELSE ba END,
 p_rules->>'finalMode',(p_rules->>'allowOverride')::boolean,CASE WHEN p.config->>'bodMode'='none' THEN 'pending' ELSE p_rules->>'bodAuthority' END,true,btrim(p_rules->>'ruleReference'),auth.uid());
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'workflow-policy-activate',p_request_id::text,'success',jsonb_build_object('policyId',p.id,'version',p.version,'rules',p_rules,'fingerprint',fingerprint));
 RETURN jsonb_build_object('success',true,'policyId',p.id);
END;
$$;
CREATE FUNCTION public.committee_mutate_review(p_application_id text,p_action text,p_revision integer,p_state_hash text,p_payload jsonb,p_request_id uuid)
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
  FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers') LOOP
   IF NOT public.committee_reviewer_available(candidate,a.id,stage_name) THEN RAISE EXCEPTION 'A selected reviewer is inactive, not set up, conflicted or no longer eligible.' USING ERRCODE='40001'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT auth_user_id) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')))<>target_count THEN RAISE EXCEPTION 'Each reviewer must be a different person.'; END IF;
  INSERT INTO public.application_review_cycles(application_id,cycle_no,stage,packet_version,packet_snapshot,policy_id,created_by,required_approvals,reviewer_target,bod_required,routing_reason)
   VALUES(a.id,cycle_number,stage_name,CASE WHEN p_action='forward_bod' THEN parent.packet_version ELSE w.revision END,packet,p.id,auth.uid(),approvals_needed,target_count,bod_needed,route_reason) RETURNING * INTO c;
  event_cycle:=c.id;
  FOR membership IN SELECT * FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) LOOP
   INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,due_at) VALUES(c.id,membership.auth_user_id,membership.id,(p_payload->>'dueAt')::timestamptz) RETURNING id INTO new_assignment;
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
  IF p_action IN ('approve','reject','clarify','recuse') AND NOT public.committee_assignment_eligible(assignment.id) THEN RAISE EXCEPTION 'This case is not assigned to your active membership.' USING ERRCODE='42501'; END IF;
  IF p_action<>'approve' AND length(reason) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a reason or clarification.'; END IF;
  IF p_action NOT IN ('recuse','reassign') AND NOT public.committee_packet_is_current(c.id) THEN RAISE EXCEPTION 'The packet changed or evidence expired. Staff must return it to verification before new decisions.' USING ERRCODE='40001'; END IF;
  IF p_action IN ('approve','reject') THEN
   IF assignment.state<>'assigned' THEN RAISE EXCEPTION 'Wait for staff to resolve the clarification, or for reassignment.'; END IF;
   IF p_payload->>'confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirm your decision for this exact application packet.'; END IF;
   INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,packet_version,decision,reason,reviewer_name,confirmation_text,confirmation_method)
   VALUES(assignment.id,auth.uid(),c.packet_version,p_action,nullif(reason,''),public.document_actor_label(),
    format('I record %s for %s, packet version %s.',p_action,a.application_id,c.packet_version),'account_password');
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
   IF NOT public.committee_reviewer_available(candidate,a.id,c.stage) OR EXISTS(SELECT 1 FROM public.review_assignments x JOIN public.staff_memberships m ON m.id=candidate WHERE x.review_cycle_id=c.id AND x.reviewer_auth_id=m.auth_user_id) THEN RAISE EXCEPTION 'Choose a different eligible reviewer who has not reviewed this cycle.'; END IF;
   UPDATE public.review_assignments SET state='reassigned',revision=revision+1 WHERE id=assignment.id;
   SELECT * INTO STRICT membership FROM public.staff_memberships WHERE id=candidate;
   INSERT INTO public.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,due_at) VALUES(c.id,membership.auth_user_id,membership.id,assignment.due_at) RETURNING id INTO new_assignment;
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
$$;

CREATE FUNCTION public.committee_rules_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('crecomApprovals',crecom_approvals,'bodReviewers',bod_reviewers,'bodApprovals',bod_approvals,
  'finalMode',final_mode,'allowOverride',allow_override,'bodAuthority',bod_authority,'allResponses',all_responses,'ruleReference',rule_reference)
 FROM public.committee_policy_rules WHERE policy_id=p_id;
$$;
CREATE FUNCTION public.committee_review_state(p_application_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.loan_applications%ROWTYPE; w public.application_verifications%ROWTYPE; state jsonb; cycles jsonb; events jsonb; candidates jsonb; final jsonb; stage_value text;
BEGIN
 IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.loan_applications WHERE application_id=p_application_id;
 SELECT * INTO w FROM public.application_verifications WHERE application_id=a.id;
 state:=public.private_application_verification_state(a.id);stage_value:=public.committee_application_stage(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'stage',c.stage,'cycle',c.cycle_no,'packetVersion',c.packet_version,'status',c.status,'outcome',c.outcome,
  'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,'bodRequired',c.bod_required,'routingReason',c.routing_reason,'createdAt',c.created_at,
  'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'membershipId',x.membership_id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'state',x.state,'revision',x.revision,'decision',d.decision,'reason',d.reason,'decidedAt',d.created_at) ORDER BY x.assigned_at),'[]')
   FROM public.review_assignments x JOIN auth.users u ON u.id=x.reviewer_auth_id LEFT JOIN public.individual_review_decisions d ON d.assignment_id=x.id WHERE x.review_cycle_id=c.id))
  ORDER BY c.cycle_no DESC,c.created_at DESC),'[]') INTO cycles FROM public.application_review_cycles c WHERE c.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',e.actor_name,'reason',e.reason,'createdAt',e.created_at,'assignmentId',e.assignment_id) ORDER BY e.created_at DESC),'[]')
 INTO events FROM public.committee_review_events e WHERE e.application_id=a.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'role',m.role,'title',m.title) ORDER BY u.email),'[]')
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
$$;
CREATE OR REPLACE FUNCTION public.committee_review_packet(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; a public.review_assignments%ROWTYPE; state jsonb; assignment jsonb; own_decision jsonb; thread jsonb; app_revision integer;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned case.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.review_assignments WHERE id=p_assignment_id;
 SELECT * INTO STRICT c FROM public.application_review_cycles WHERE id=a.review_cycle_id;
 state:=public.private_application_verification_state(c.application_id);
 SELECT revision INTO app_revision FROM public.application_verifications WHERE application_id=c.application_id;
 SELECT x INTO assignment FROM jsonb_array_elements(public.committee_workspace()->'assignments')x WHERE x->>'id'=p_assignment_id::text;
 SELECT jsonb_build_object('id',id,'decision',decision,'reason',reason,'createdAt',created_at,'reviewer',reviewer_name,'confirmation',confirmation_text,'method',confirmation_method) INTO own_decision FROM public.individual_review_decisions WHERE assignment_id=a.id AND reviewer_auth_id=auth.uid();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'actor',actor_name,'reason',reason,'createdAt',created_at,'assignmentId',assignment_id) ORDER BY created_at),'[]') INTO thread
 FROM public.committee_review_events WHERE assignment_id=a.id AND action IN ('clarify','reply','recuse');
 RETURN jsonb_build_object('assignment',assignment,'summary',c.packet_snapshot->'summary','findings',coalesce(c.packet_snapshot->>'staffFindings',''),
  'consentSummary',coalesce(c.packet_snapshot->>'consentSummary',''),'documents',(SELECT coalesce(jsonb_agg(x-'storagePath'-'contentType'),'[]') FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x),
  'appRevision',app_revision,'stateHash',state->>'stateHash','stale',c.status='open' AND NOT public.committee_packet_is_current(c.id),'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,
  'canRespond',c.status='open' AND a.state='assigned' AND public.committee_packet_is_current(c.id) AND NOT EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=c.application_id),
  'myDecision',own_decision,'thread',thread,'cycleStatus',c.status,'outcome',c.outcome);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_document_location(p_assignment_id uuid,p_document_id uuid,p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; item jsonb;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned document.' USING ERRCODE='42501'; END IF;
 SELECT c1.* INTO STRICT c FROM public.review_assignments a JOIN public.application_review_cycles c1 ON c1.id=a.review_cycle_id WHERE a.id=p_assignment_id;
 SELECT x INTO item FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x
 WHERE x->>'documentId'=p_document_id::text AND (x->>'versionId')::uuid IS NOT DISTINCT FROM p_version_id;
 IF item IS NULL OR nullif(item->>'storagePath','') IS NULL OR NOT EXISTS(SELECT 1 FROM public.loan_documents WHERE id=p_document_id AND loan_application_id=c.application_id) THEN RAISE EXCEPTION 'This file version is not part of your assigned packet.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('path',item->>'storagePath','name',item->>'name','contentType',item->>'contentType');
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_can_read_loan_object(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x
 JOIN public.loan_documents d ON d.id=(x->>'documentId')::uuid AND d.loan_application_id=c.application_id
 WHERE public.committee_assignment_eligible(a.id) AND x->>'storagePath'=p_name);
$$;

CREATE FUNCTION public.committee_review_action(p_actor_id uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true); result jsonb;
BEGIN
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id) THEN RAISE EXCEPTION 'A verified account is required.' USING ERRCODE='42501'; END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF p_operation='activate_policy' THEN result:=public.committee_activate_policy((p_args->>'policyId')::uuid,p_args->'rules',(p_args->>'requestId')::uuid);
 ELSE result:=public.committee_mutate_review(p_args->>'applicationId',p_operation,(p_args->>'revision')::integer,p_args->>'stateHash',p_args->'payload',(p_args->>'requestId')::uuid);
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RAISE;
END;
$$;
CREATE FUNCTION public.committee_transition_allowed(p_application uuid,p_old text,p_new text,p_caller name)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.application_final_decisions%ROWTYPE;
BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.document_staff_access()
  AND NOT EXISTS(SELECT 1 FROM public.loan_applications a JOIN public.members m ON m.id=a.member_id WHERE a.id=p_application AND m.user_id=auth.uid()) THEN RETURN false; END IF;
 IF p_new IS NOT DISTINCT FROM p_old OR NOT EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application) THEN RETURN true; END IF;
 -- Final changes and servicing transitions must come through trusted procedures,
 -- never a direct authenticated table update that bypasses their checks.
 IF p_caller NOT IN ('postgres','supabase_admin','service_role') THEN RETURN false; END IF;
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 IF d.application_id IS NOT NULL AND (
  (p_new=CASE WHEN d.decision='approve' THEN 'approved' ELSE 'rejected' END AND p_old IN ('pending','under review'))
  OR (d.decision='approve' AND ((p_old='approved' AND p_new='released') OR (p_old IN ('released','overdue') AND p_new IN ('overdue','completed'))))
 ) THEN RETURN true; END IF;
 RETURN false;
END;
$$;
CREATE OR REPLACE FUNCTION public.guard_enrolled_application_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF public.committee_transition_allowed(OLD.id,OLD.status,NEW.status,current_user) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'This enrolled application requires the authorized committee, final-decision and servicing procedures.' USING ERRCODE='42501';
END;
$$;
CREATE FUNCTION public.committee_final_terms_locked(p_application uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.application_final_decisions f JOIN public.loan_applications a ON a.id=f.application_id
 JOIN public.members m ON m.id=a.member_id WHERE f.application_id=p_application AND (public.document_staff_access() OR m.user_id=auth.uid()));
$$;
CREATE FUNCTION public.committee_guard_final_terms()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role')
 AND (NEW.amount,NEW.member_id,NEW.loan_type,NEW.purpose,NEW.tenure_months,NEW.monthly_payment)
 IS DISTINCT FROM (OLD.amount,OLD.member_id,OLD.loan_type,OLD.purpose,OLD.tenure_months,OLD.monthly_payment)
 AND public.committee_final_terms_locked(OLD.id) THEN RAISE EXCEPTION 'Final approved or rejected packet terms cannot be edited directly.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER committee_guard_final_terms BEFORE UPDATE OF amount,member_id,loan_type,purpose,tenure_months,monthly_payment ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.committee_guard_final_terms();
CREATE FUNCTION public.committee_guard_verification_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.stage,NEW.checks,NEW.notes,NEW.policy_id,NEW.verified_state_hash) IS DISTINCT FROM (OLD.stage,OLD.checks,OLD.notes,OLD.policy_id,OLD.verified_state_hash)
 AND EXISTS(SELECT 1 FROM public.application_review_cycles WHERE application_id=OLD.application_id AND status<>'superseded')
 THEN RAISE EXCEPTION 'Return this case to verification before editing its checks or requirements.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER committee_guard_verification_edit BEFORE UPDATE ON public.application_verifications FOR EACH ROW EXECUTE FUNCTION public.committee_guard_verification_edit();
CREATE FUNCTION public.committee_guard_approved_policy()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.status='approved' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved workflow policies are immutable. Create a new draft version.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER committee_guard_approved_policy BEFORE UPDATE OR DELETE ON public.approval_workflow_policies FOR EACH ROW EXECUTE FUNCTION public.committee_guard_approved_policy();
-- Updated read models and consent binding.
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
    'coMakerMemberId',to_jsonb(a)->>'co_maker_member_id','financialPolicy',financial,'documents',manifest)::text,'UTF8')),'hex');
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
    AND (e.kind<>'co_maker' OR (e.subject_user_id IS DISTINCT FROM m.user_id AND e.subject_reference<>m.member_id AND EXISTS(SELECT 1 FROM public.members cm WHERE cm.id::text=to_jsonb(a)->>'co_maker_member_id' AND ((cm.user_id IS NOT NULL AND cm.user_id=e.subject_user_id) OR (e.method='paper' AND cm.user_id IS NULL AND e.subject_user_id IS NULL AND e.subject_reference IN (cm.member_id,cm.id::text))))));
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
    'memberNumber',coalesce(m.member_id,'Not recorded'),'loanType',a.loan_type,'loanStatus',a.status,
    'stage',coalesce(review_stage,CASE WHEN w.application_id IS NULL THEN 'not_started' WHEN stale THEN 'needs_verification' ELSE w.stage END),
    'enrolled',w.application_id IS NOT NULL,'revision',coalesce(w.revision,0),'stale',coalesce(stale,false),
    'checks',coalesce(w.checks,'{"identity":false,"eligibility":false,"terms":false}'),'notes',coalesce(w.notes,''),
    'history',history,'lastReturned',returned,'canEnroll',a.status IN ('pending','under review') AND NOT EXISTS(SELECT 1 FROM public.application_review_cycles WHERE application_id=a.id AND status<>'superseded'),
    'permissions',jsonb_build_object('verify',public.document_staff_access('applications.verify'),'return',public.document_staff_access('applications.return'),'policyManage',public.document_staff_access('workflow.policy.manage')));
END;
$$;

CREATE OR REPLACE FUNCTION public.application_workflow_summaries()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('applicationId',a.application_id,'enrolled',true,'revision',v.revision,
    'stage',coalesce(public.committee_application_stage(a.id),CASE WHEN v.stage='ready_for_committee' AND (v.verified_state_hash IS DISTINCT FROM s.state->>'stateHash' OR jsonb_array_length(s.state->'blockers')>0) THEN 'needs_verification' ELSE v.stage END),
    'stale',v.stage='ready_for_committee' AND (v.verified_state_hash IS DISTINCT FROM s.state->>'stateHash' OR jsonb_array_length(s.state->'blockers')>0)) ORDER BY a.application_id),'[]') INTO rows
    FROM public.application_verifications v JOIN public.loan_applications a ON a.id=v.application_id
    CROSS JOIN LATERAL(SELECT public.private_application_verification_state(a.id) AS state)s;
  RETURN rows;
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
  'cycle',c.cycle_no,'packetVersion',d.packet_version,'decision',d.decision,'reason',d.reason,'createdAt',d.created_at,'accessAvailable',public.committee_assignment_eligible(a.id)) ORDER BY d.created_at DESC),'[]')
 INTO history FROM public.individual_review_decisions d JOIN public.review_assignments a ON a.id=d.assignment_id JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 WHERE d.reviewer_auth_id=auth.uid();
 RETURN jsonb_build_object('assignments',assignments,'history',history,'counts',jsonb_build_object('assigned',jsonb_array_length(assignments),
  'pending',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='assigned'),
  'waiting',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='decision_recorded' AND (x->>'responded')::integer<(x->>'assigned')::integer),
  'clarification',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='awaiting_clarification'),'completed',jsonb_array_length(history)));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_approval_workflow_policies()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE policies jsonb;
BEGIN
  IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'status',p.status,'config',p.config,
    'authorizationReference',p.authorization_reference,'createdAt',p.created_at,'createdBy',p.created_by_name,'executionRules',public.committee_rules_json(p.id)) ORDER BY p.version DESC),'[]') INTO policies FROM public.approval_workflow_policies p;
  RETURN jsonb_build_object('policies',policies,'canManage',public.document_staff_access('workflow.policy.manage'));
END;
$$;
REVOKE ALL ON FUNCTION public.committee_reviewer_available(uuid,uuid,text),public.committee_packet_is_current(uuid),public.committee_application_stage(uuid),public.committee_record_final(uuid,text,text,text),public.committee_activate_policy(uuid,jsonb,uuid),public.committee_mutate_review(text,text,integer,text,jsonb,uuid),public.committee_rules_json(uuid),public.committee_review_action(uuid,text,jsonb),public.committee_guard_verification_edit(),public.committee_guard_approved_policy() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.committee_review_action(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.committee_review_state(text),public.committee_transition_allowed(uuid,text,text,name),public.committee_final_terms_locked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.committee_review_state(text),public.committee_transition_allowed(uuid,text,text,name),public.committee_final_terms_locked(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';

-- Four signatory positions confirmed from the manual form. No accounts or policies activated.

ALTER TABLE public.staff_memberships ADD COLUMN committee_seat text NOT NULL DEFAULT 'member' CHECK(committee_seat IN ('member','chairperson'));
ALTER TABLE public.review_assignments ADD COLUMN signatory_role text CHECK(signatory_role IN ('crecom_member','crecom_chairperson','bod_chairperson'));
ALTER TABLE public.individual_review_decisions ADD COLUMN signatory_role text CHECK(signatory_role IN ('crecom_member','crecom_chairperson','bod_chairperson'));
ALTER TABLE public.committee_policy_rules ADD COLUMN signatory_layout text NOT NULL DEFAULT 'manual_form_v1' CHECK(signatory_layout='manual_form_v1');
-- Legacy records are not relabelled as chairperson confirmations. New records need a trusted position.
CREATE FUNCTION public.committee_guard_signatory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected text;
BEGIN
 IF TG_TABLE_NAME='review_assignments' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW.signatory_role IS DISTINCT FROM OLD.signatory_role OR NEW.membership_id<>OLD.membership_id OR NEW.reviewer_auth_id<>OLD.reviewer_auth_id OR NEW.review_cycle_id<>OLD.review_cycle_id THEN RAISE EXCEPTION 'The assigned signatory position is immutable. Use reassignment.'; END IF;
  ELSE
   SELECT CASE WHEN c.stage='CRECOM' AND m.role='crecom_member' THEN CASE WHEN m.committee_seat='chairperson' THEN 'crecom_chairperson' ELSE 'crecom_member' END
     WHEN c.stage='BOD' AND m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' END INTO expected
   FROM public.staff_memberships m JOIN public.application_review_cycles c ON c.id=NEW.review_cycle_id WHERE m.id=NEW.membership_id AND m.auth_user_id=NEW.reviewer_auth_id;
   IF expected IS NULL OR NEW.signatory_role IS DISTINCT FROM expected THEN RAISE EXCEPTION 'The assigned position must match the trusted committee membership.'; END IF;
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
    WHERE a.id=NEW.assignment_id AND a.reviewer_auth_id=NEW.reviewer_auth_id AND a.signatory_role=NEW.signatory_role AND c.packet_version=NEW.packet_version) THEN RAISE EXCEPTION 'The confirmation must preserve the assigned signatory position and packet version.'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_assigned_signatory BEFORE INSERT OR UPDATE ON public.review_assignments FOR EACH ROW EXECUTE FUNCTION public.committee_guard_signatory();
CREATE TRIGGER confirm_assigned_signatory BEFORE INSERT ON public.individual_review_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_guard_signatory();
CREATE FUNCTION public.committee_signatories_complete(p_cycle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT CASE WHEN c.stage='CRECOM' THEN c.reviewer_target=3 AND c.required_approvals=3
    AND count(*)=3 AND count(*) FILTER(WHERE a.signatory_role='crecom_member')=2 AND count(*) FILTER(WHERE a.signatory_role='crecom_chairperson')=1
   ELSE c.reviewer_target=1 AND c.required_approvals=1 AND count(*)=1 AND count(*) FILTER(WHERE a.signatory_role='bod_chairperson')=1 END
  AND count(DISTINCT a.reviewer_auth_id)=count(*) AND bool_and(a.state='decision_recorded' AND d.id IS NOT NULL AND d.signatory_role=a.signatory_role AND d.packet_version=c.packet_version AND d.reviewer_auth_id=a.reviewer_auth_id)
 FROM public.application_review_cycles c JOIN public.review_assignments a ON a.review_cycle_id=c.id
 LEFT JOIN public.individual_review_decisions d ON d.assignment_id=a.id
 WHERE c.id=p_cycle AND c.status='completed' AND a.state NOT IN ('cancelled','reassigned') GROUP BY c.id),false);
$$;
REVOKE ALL ON FUNCTION public.committee_guard_signatory(),public.committee_signatories_complete(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.committee_membership_eligible(p_id uuid,p_allow_setup boolean DEFAULT false,p_allow_future boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.id=p_id AND m.auth_user_id=auth.uid() AND m.active
  AND (p_allow_future OR m.starts_at<=now()) AND (m.ends_at IS NULL OR m.ends_at>now())
  AND (p_allow_setup OR m.setup_completed_at IS NOT NULL)
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
  AND (m.role='crecom_member' OR (m.committee_seat='chairperson' AND public.committee_bod_enabled()))
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
  'membershipId',m.id,'committeeSeat',m.committee_seat,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'email',u.email,'startsAt',m.starts_at,'endsAt',m.ends_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_assignment_eligible(p_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 JOIN public.staff_memberships m ON m.id=a.membership_id WHERE a.id=p_assignment_id AND a.reviewer_auth_id=auth.uid()
 AND m.auth_user_id=a.reviewer_auth_id AND public.committee_membership_eligible(m.id)
 AND a.signatory_role=CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='member' THEN 'crecom_member' END
 AND m.role=CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
 AND a.state NOT IN ('cancelled','reassigned') AND c.status IN ('open','completed'));
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
   'status',CASE WHEN NOT m.active THEN 'inactive' WHEN m.ends_at<=now() THEN 'expired' WHEN m.role='bod_member' AND NOT public.committee_bod_enabled() THEN 'policy_disabled' WHEN m.setup_completed_at IS NULL THEN 'invited' WHEN m.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'lastSignInAt',u.last_sign_in_at,'assignedCount',(SELECT count(*) FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE a.membership_id=m.id AND c.status='open' AND a.state IN ('assigned','awaiting_clarification')),
   'lastInviteAt',m.last_invite_at,'error',null) AS row FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  UNION ALL
  SELECT jsonb_build_object('id',r.id,'requestId',r.id,'userId',r.auth_user_id,'name',r.payload->>'name','email',r.email,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','title',r.payload->>'title',
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
  'stage',c.stage,'signatoryRole',a.signatory_role,'cycle',c.cycle_no,'state',a.state,'assignedAt',a.assigned_at,'dueAt',a.due_at,
  'needsReassignment',c.status='open' AND a.state IN ('assigned','awaiting_clarification') AND
    (a.signatory_role IS DISTINCT FROM CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' THEN 'crecom_member' END OR NOT m.active OR m.starts_at>now() OR m.ends_at<=now() OR m.role<>CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END))
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

 IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;
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
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-request',p_request_id::text,'success',jsonb_build_object('role',p_payload->>'role','email',invite_email,'committeeSeat',p_payload->>'committeeSeat'));
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
 IF next_role='bod_member' AND next_active AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'An approved policy must enable BOD access first.'; END IF;
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

CREATE OR REPLACE FUNCTION public.committee_reviewer_available(p_membership uuid,p_application uuid,p_stage text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  JOIN public.loan_applications a ON a.id=p_application JOIN public.members borrower ON borrower.id=a.member_id
  WHERE m.id=p_membership AND m.role=CASE WHEN p_stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
  AND m.active AND m.starts_at<=now() AND (m.ends_at IS NULL OR m.ends_at>now()) AND m.setup_completed_at IS NOT NULL
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
  AND (m.role='crecom_member' OR (m.committee_seat='chairperson' AND public.committee_bod_enabled()))
  AND m.auth_user_id IS DISTINCT FROM borrower.user_id
  AND NOT EXISTS(SELECT 1 FROM public.members b WHERE b.user_id=u.id)
  AND NOT EXISTS(SELECT 1 FROM public.members cm WHERE cm.id::text=to_jsonb(a)->>'co_maker_member_id' AND cm.user_id=u.id));
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
  OR p_rules->>'finalMode' IS DISTINCT FROM 'super_admin' OR p_rules->>'allowOverride' IS DISTINCT FROM 'false'
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
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' OR p_mode<>'super_admin' THEN RAISE EXCEPTION 'Super Admin final authority is required.' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.committee_rules_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('signatoryLayout',signatory_layout,'crecomApprovals',crecom_approvals,'bodReviewers',bod_reviewers,'bodApprovals',bod_approvals,
  'finalMode',final_mode,'allowOverride',allow_override,'bodAuthority',bod_authority,'allResponses',all_responses,'ruleReference',rule_reference)
 FROM public.committee_policy_rules WHERE policy_id=p_id;
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
  'canFinalize',public.document_staff_access() AND (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())='super_admin'
   AND stage_value='ready_for_final' AND public.committee_rules_json(w.policy_id)->>'finalMode'='super_admin');
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_review_packet(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; a public.review_assignments%ROWTYPE; state jsonb; assignment jsonb; own_decision jsonb; thread jsonb; app_revision integer;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned case.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.review_assignments WHERE id=p_assignment_id;
 SELECT * INTO STRICT c FROM public.application_review_cycles WHERE id=a.review_cycle_id;
 state:=public.private_application_verification_state(c.application_id);
 SELECT revision INTO app_revision FROM public.application_verifications WHERE application_id=c.application_id;
 SELECT x INTO assignment FROM jsonb_array_elements(public.committee_workspace()->'assignments')x WHERE x->>'id'=p_assignment_id::text;
 SELECT jsonb_build_object('id',id,'decision',decision,'reason',reason,'createdAt',created_at,'reviewer',reviewer_name,'confirmation',confirmation_text,'method',confirmation_method,'signatoryRole',signatory_role) INTO own_decision FROM public.individual_review_decisions WHERE assignment_id=a.id AND reviewer_auth_id=auth.uid();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'actor',actor_name,'reason',reason,'createdAt',created_at,'assignmentId',assignment_id) ORDER BY created_at),'[]') INTO thread
 FROM public.committee_review_events WHERE assignment_id=a.id AND action IN ('clarify','reply','recuse');
 RETURN jsonb_build_object('assignment',assignment,'summary',c.packet_snapshot->'summary','findings',coalesce(c.packet_snapshot->>'staffFindings',''),
  'consentSummary',coalesce(c.packet_snapshot->>'consentSummary',''),'documents',(SELECT coalesce(jsonb_agg(x-'storagePath'-'contentType'),'[]') FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]'))x),
  'appRevision',app_revision,'stateHash',state->>'stateHash','stale',c.status='open' AND NOT public.committee_packet_is_current(c.id),'requiredApprovals',c.required_approvals,'reviewerTarget',c.reviewer_target,
  'canRespond',c.status='open' AND a.state='assigned' AND public.committee_packet_is_current(c.id) AND NOT EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=c.application_id),
  'myDecision',own_decision,'thread',thread,'cycleStatus',c.status,'outcome',c.outcome);
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
  'amount',(c.packet_snapshot->'summary'->>'amount')::numeric,'stage',c.stage,'signatoryRole',a.signatory_role,'cycle',c.cycle_no,'packetVersion',c.packet_version,'assignedAt',a.assigned_at,'dueAt',a.due_at,'state',a.state,
  'responded',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state='decision_recorded'),
  'assigned',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state NOT IN ('cancelled','reassigned'))) ORDER BY a.assigned_at DESC),'[]')
 INTO assignments FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE public.committee_assignment_eligible(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'assignmentId',d.assignment_id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'cycle',c.cycle_no,'packetVersion',d.packet_version,'decision',d.decision,'signatoryRole',d.signatory_role,'reason',d.reason,'createdAt',d.created_at,'accessAvailable',public.committee_assignment_eligible(a.id)) ORDER BY d.created_at DESC),'[]')
 INTO history FROM public.individual_review_decisions d JOIN public.review_assignments a ON a.id=d.assignment_id JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 WHERE d.reviewer_auth_id=auth.uid();
 RETURN jsonb_build_object('assignments',assignments,'history',history,'counts',jsonb_build_object('assigned',jsonb_array_length(assignments),
  'pending',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='assigned'),
  'waiting',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='decision_recorded' AND (x->>'responded')::integer<(x->>'assigned')::integer),
  'clarification',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='awaiting_clarification'),'completed',jsonb_array_length(history)));
END;
$$;

ALTER TABLE public.loan_applications ADD COLUMN date_approved date,ADD COLUMN co_maker_member_id uuid REFERENCES public.members(id);
CREATE TABLE public.loan_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),loan_application_id uuid REFERENCES public.loan_applications(id),payment_amount numeric,receipt_number text,payment_status text,recorded_by uuid,reversed_by uuid);
CREATE TABLE public.announcements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,status text);
ALTER TABLE public.notifications ADD COLUMN send_to text;
GRANT UPDATE(read) ON public.notifications TO authenticated;
CREATE POLICY update_own_notification ON public.notifications FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
-- Incoming activity alerts. Does not backfill past actions or change loan decisions.

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


CREATE FUNCTION public.portal_record_consent_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app_label text; event_key text; title text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.invalidated_at IS NOT DISTINCT FROM OLD.invalidated_at THEN RETURN NEW; END IF;
 SELECT application_id INTO app_label FROM public.loan_applications WHERE id=NEW.application_id;
 event_key:='consent:'||NEW.id::text||CASE WHEN TG_OP='UPDATE' THEN ':invalidated:'||txid_current() ELSE '' END;
 title:=CASE WHEN NEW.invalidated_at IS NULL THEN 'Loan consent evidence recorded' ELSE 'Loan consent evidence invalidated' END;
 PERFORM public.portal_emit_activity(event_key,'documents','consent_'||CASE WHEN NEW.invalidated_at IS NULL THEN 'recorded' ELSE 'invalidated' END,title,
  app_label||' · '||replace(NEW.kind,'_',' ')||' · '||title||'.','application',app_label,coalesce(auth.uid(),NEW.subject_user_id),NEW.subject_user_id,app_label||': '||title||'.');
 RETURN NEW;
END;
$$;
CREATE TRIGGER portal_consent_activity AFTER INSERT OR UPDATE ON public.application_consent_evidence FOR EACH ROW EXECUTE FUNCTION public.portal_record_consent_activity();
REVOKE ALL ON FUNCTION public.portal_record_consent_activity() FROM PUBLIC,anon,authenticated;


-- Older Supabase defaults can leave a table-wide UPDATE grant despite UPDATE(read).
REVOKE ALL ON TABLE public.notifications FROM PUBLIC,anon,authenticated;
DO $$DECLARE columns text;BEGIN
 SELECT string_agg(quote_ident(column_name),',') INTO columns FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications';
 EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.notifications FROM PUBLIC,anon,authenticated',columns);
END$$;
GRANT SELECT,UPDATE(read) ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

-- All users, policies, notifications and decisions below are synthetic and rolled back.
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END$$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'Expected rejection: %',command;
END$$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,encrypted_password)
SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'review-'||n||'@example.invalid',
 jsonb_build_object('role',CASE WHEN n=1 THEN 'super_admin' WHEN n IN (2,3) THEN 'admin' WHEN n IN (4,5,6) THEN 'member' WHEN n=11 THEN 'bod_member' ELSE 'crecom_member' END,
  'account_status','active','admin_privileges',CASE WHEN n=2 THEN '["applications.forward","applications.verify"]'::jsonb ELSE '[]'::jsonb END),
 jsonb_build_object('full_name','Synthetic reviewer '||n),now(),'synthetic-hash' FROM generate_series(1,11)n;
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,status,must_change_password)
SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'TEST-'||n,'Synthetic','Member '||n,'active',false FROM generate_series(4,6)n;
INSERT INTO public.staff_memberships(id,auth_user_id,role,active,starts_at,setup_completed_at,assigned_by)
SELECT ('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n=11 THEN 'bod_member' ELSE 'crecom_member' END,true,now()-interval '1 day',now(),'10000000-0000-0000-0000-000000000001' FROM generate_series(7,11)n;
INSERT INTO public.approval_workflow_policies(id,name,config,authorization_reference,created_by,created_by_name)
VALUES('90000000-0000-0000-0000-000000000001','SYNTHETIC FOUR POSITIONS',
 '{"reviewerCount":3,"quorumRule":"SYNTHETIC all 3 must respond and approve","crecomAuthority":"recommendation","bodMode":"required","bodCriteria":"BOD chairperson required for every loan","finalAuthority":"Super Admin","borrowerConsentRequired":false,"coMakerConsentRequired":false,"witnessCount":0,"allowedConsentMethods":["paper"],"requirementsReference":"SYNTHETIC TEST ONLY"}',
 'SYNTHETIC TEST ONLY','10000000-0000-0000-0000-000000000001','Synthetic coordinator');
CREATE FUNCTION pg_temp.actor(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE FUNCTION pg_temp.member(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE FUNCTION pg_temp.payload_reviewers(n1 integer,n2 integer,n3 integer,bod boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('reviewers',jsonb_build_array(pg_temp.member(n1),pg_temp.member(n2),pg_temp.member(n3)),'dueAt',null,'bodRequired',bod,'routingReason','SYNTHETIC approved applicability');
$$;
CREATE FUNCTION pg_temp.send(actor integer,application text,operation text,payload jsonb,request uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE app uuid; revision integer; hash text;
BEGIN
 SELECT id INTO STRICT app FROM public.loan_applications WHERE application_id=application;
 SELECT v.revision INTO STRICT revision FROM public.application_verifications v WHERE v.application_id=app;
 hash:=public.private_application_verification_state(app)->>'stateHash';
 RETURN public.committee_review_action(pg_temp.actor(actor),operation,jsonb_build_object('applicationId',application,'revision',revision,'stateHash',hash,'payload',payload,'requestId',request));
END$$;
CREATE FUNCTION pg_temp.seed_app(label text,policy uuid DEFAULT '90000000-0000-0000-0000-000000000001')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE app uuid:=gen_random_uuid(); doc uuid; kind text; state jsonb;
BEGIN
 INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted,tenure_months,monthly_payment)
 VALUES(app,label,'20000000-0000-0000-0000-000000000004','Synthetic Borrower','Business',1000,'pending',current_date,12,100);
 FOREACH kind IN ARRAY ARRAY['validId','payslip'] LOOP
  doc:=gen_random_uuid();
  INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes)
  VALUES(doc,app,pg_temp.actor(4),kind,'synthetic/'||doc::text||'.pdf',kind||'.pdf','application/pdf',10);
  INSERT INTO public.loan_document_reviews(document_id,status,reviewer_id,reviewer_name) VALUES(doc,'verified',pg_temp.actor(1),'Synthetic verifier');
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('loan-documents','synthetic/'||doc::text||'.pdf','{"mimetype":"application/pdf","size":10}');
 END LOOP;
 INSERT INTO public.application_verifications(application_id,checks,notes,policy_id,updated_by)
 VALUES(app,'{"identity":true,"eligibility":true,"terms":true}','Synthetic staff findings',policy,pg_temp.actor(1));
 state:=public.private_application_verification_state(app);
 IF jsonb_array_length(state->'blockers')<>0 THEN RAISE EXCEPTION 'Unexpected fixture blockers: %',state->'blockers'; END IF;
 UPDATE public.application_verifications SET stage='ready_for_committee',verified_state_hash=state->>'stateHash',verified_snapshot=state WHERE application_id=app;
 RETURN app;
END$$;
CREATE FUNCTION pg_temp.assignment(application text,reviewer integer,stage_name text DEFAULT 'CRECOM') RETURNS uuid LANGUAGE sql AS $$
 SELECT x.id FROM public.review_assignments x JOIN public.application_review_cycles c ON c.id=x.review_cycle_id
 JOIN public.loan_applications a ON a.id=c.application_id WHERE a.application_id=application AND x.reviewer_auth_id=pg_temp.actor(reviewer) AND c.stage=stage_name AND c.status<>'superseded' AND x.state NOT IN ('reassigned','cancelled') ORDER BY c.cycle_no DESC LIMIT 1;
$$;
CREATE FUNCTION pg_temp.respond(reviewer integer,application text,decision text,stage_name text DEFAULT 'CRECOM') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.send(reviewer,application,decision,jsonb_build_object('assignmentId',pg_temp.assignment(application,reviewer,stage_name),'reason','Synthetic decision note','confirmed',true));
$$;

UPDATE public.staff_memberships SET committee_seat='chairperson' WHERE auth_user_id IN (pg_temp.actor(9),pg_temp.actor(10),pg_temp.actor(11));
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,encrypted_password) VALUES(pg_temp.actor(12),'review-12@example.invalid','{"role":"crecom_member","account_status":"active"}','{"full_name":"Synthetic reviewer 12"}',now(),'synthetic-hash');
INSERT INTO public.staff_memberships(id,auth_user_id,role,starts_at,setup_completed_at,assigned_by) VALUES(pg_temp.member(12),pg_temp.actor(12),'crecom_member',now()-interval '1 day',now(),pg_temp.actor(1));
CREATE FUNCTION pg_temp.seat(n integer,new_seat text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
 PERFORM public.committee_account_action(pg_temp.actor(1),'committee_change_membership',jsonb_build_object('p_id',pg_temp.member(n),'p_revision',(SELECT revision FROM public.staff_memberships WHERE id=pg_temp.member(n)),'p_action','edit','p_request_id',gen_random_uuid(),
  'p_payload',jsonb_build_object('role',CASE WHEN n=11 THEN 'bod_member' ELSE 'crecom_member' END,'committeeSeat',new_seat,'title','Synthetic position','startsAt',now()-interval '1 day','endsAt',null,'reason','Synthetic appointment change')));
END$$;
CREATE FUNCTION pg_temp.bod(application text) RETURNS jsonb LANGUAGE sql AS $$SELECT pg_temp.send(2,application,'forward_bod',jsonb_build_object('reviewers',jsonb_build_array(pg_temp.member(11)),'dueAt',null))$$;
CREATE FUNCTION pg_temp.activate(rules jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy',jsonb_build_object('policyId','90000000-0000-0000-0000-000000000001','rules',rules,'requestId',gen_random_uuid()))$$;
-- Direct authenticated calls cannot bypass personal-password service dispatch.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
SELECT pg_temp.denied($q$SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy','{}')$q$,'42501');
SELECT pg_temp.denied($q$UPDATE public.staff_memberships SET committee_seat='chairperson'$q$,'42501');
RESET ROLE;
SELECT pg_temp.denied($q$SELECT pg_temp.activate('{"crecomApprovals":3,"bodReviewers":3,"bodApprovals":3,"bodAuthority":"recommendation","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC","signatoryLayout":"manual_form_v1"}')$q$,'P0001');
UPDATE public.approval_workflow_policies SET config=jsonb_set(config,'{bodMode}','"none"');
SELECT pg_temp.denied($q$SELECT pg_temp.activate('{"crecomApprovals":3,"bodReviewers":1,"bodApprovals":1,"bodAuthority":"recommendation","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC","signatoryLayout":"manual_form_v1"}')$q$,'P0001');
UPDATE public.approval_workflow_policies SET config=jsonb_set(config,'{bodMode}','"required"');
SELECT pg_temp.activate('{"crecomApprovals":3,"bodReviewers":1,"bodApprovals":1,"bodAuthority":"recommendation","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC","signatoryLayout":"manual_form_v1"}');
SELECT pg_temp.seed_app('APP-YES');
SELECT pg_temp.denied($q$SELECT pg_temp.send(3,'APP-YES','forward',pg_temp.payload_reviewers(7,8,9))$q$,'42501');
UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{"committeeSeat":"chairperson","role":"crecom_chairperson"}'::jsonb WHERE id=pg_temp.actor(12);
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,8,12))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,9,10))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,8,9,false))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,7,9))$q$,'P0001');
SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,8,9));
SELECT pg_temp.assert_true((SELECT count(*) FILTER(WHERE signatory_role='crecom_member')=2 AND count(*) FILTER(WHERE signatory_role='crecom_chairperson')=1 FROM public.review_assignments),'exact frozen CRECOM layout');
SELECT pg_temp.denied($q$SELECT pg_temp.respond(10,'APP-YES','approve')$q$,'P0002');
SELECT pg_temp.respond(7,'APP-YES','approve');
SELECT pg_temp.send(8,'APP-YES','clarify',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',8),'reason','Explain the frozen estimate.'));
SELECT pg_temp.denied($q$SELECT pg_temp.respond(8,'APP-YES','approve')$q$,'P0001');
SELECT pg_temp.send(2,'APP-YES','reply',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',8),'reason','Synthetic clarification provided.'));
SELECT pg_temp.respond(8,'APP-YES','approve');
SELECT pg_temp.send(9,'APP-YES','recuse',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'reason','Synthetic recusal.'));
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','reassign',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'membershipId',pg_temp.member(12),'reason','Wrong replacement position.'))$q$,'P0001');
SELECT pg_temp.send(2,'APP-YES','reassign',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'membershipId',pg_temp.member(10),'reason','Replace with another appointed chairperson.'));
SELECT pg_temp.seat(10,'member');
SELECT pg_temp.denied($q$SELECT pg_temp.respond(10,'APP-YES','approve')$q$,'42501');
SELECT pg_temp.seat(10,'chairperson');
SELECT pg_temp.respond(10,'APP-YES','approve');
SELECT pg_temp.assert_true(public.committee_application_stage((SELECT id FROM public.loan_applications WHERE application_id='APP-YES'))='ready_for_bod','three CRECOM approvals require BOD next');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"Too early before BOD"}')$q$,'P0001');
-- Ordinary BOD member cannot occupy the chairperson slot or open the portal.
UPDATE public.staff_memberships SET committee_seat='member' WHERE id=pg_temp.member(11);
SELECT pg_temp.denied($q$SELECT pg_temp.bod('APP-YES')$q$,'40001');
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(11)::text,true);
SELECT pg_temp.assert_true(NOT (public.portal_session_access()->>'allowed')::boolean,'BOD member cannot replace chairperson');
UPDATE public.staff_memberships SET committee_seat='chairperson' WHERE id=pg_temp.member(11);
SELECT pg_temp.bod('APP-YES');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"Before BOD confirmation"}')$q$,'P0001');
SELECT pg_temp.respond(11,'APP-YES','approve','BOD');
SELECT pg_temp.assert_true((SELECT count(*)=4 AND count(*) FILTER(WHERE signatory_role='bod_chairperson')=1 FROM public.individual_review_decisions),'four individual account confirmations');
SELECT pg_temp.assert_true((SELECT bool_and(confirmation_text LIKE '% as %' AND confirmation_method='account_password') FROM public.individual_review_decisions),'confirmation contains frozen position and account password method');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','finalize','{"decision":"approve","reason":"Admin cannot finalize"}')$q$,'42501');
SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"All four required positions confirmed."}');
SELECT pg_temp.assert_true((SELECT status='approved' FROM public.loan_applications WHERE application_id='APP-YES'),'only final Super Admin action approves application');
SELECT pg_temp.denied($q$UPDATE public.individual_review_decisions SET signatory_role='crecom_chairperson'$q$,'42501');
SELECT pg_temp.denied($q$UPDATE public.review_assignments SET signatory_role='crecom_chairperson' WHERE signatory_role='crecom_member'$q$,'P0001');
-- Existing confirmation stays in the original position after appointment changes.
SELECT pg_temp.seat(10,'member');
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(10)::text,true);
SELECT pg_temp.assert_true(NOT public.committee_assignment_eligible(pg_temp.assignment('APP-YES',10)),'old chair packet access closes after seat change');
SELECT pg_temp.assert_true((SELECT signatory_role='crecom_chairperson' FROM public.individual_review_decisions WHERE reviewer_auth_id=pg_temp.actor(10)),'recorded position never relabelled');
SELECT pg_temp.seat(10,'chairperson');
-- A rejection still requires all responses and blocks final approval.
SELECT pg_temp.seed_app('APP-REJECT');
SELECT pg_temp.send(2,'APP-REJECT','forward',pg_temp.payload_reviewers(7,8,9));
SELECT pg_temp.respond(7,'APP-REJECT','approve');
SELECT pg_temp.respond(8,'APP-REJECT','reject');
SELECT pg_temp.respond(9,'APP-REJECT','approve');
SELECT pg_temp.bod('APP-REJECT');
SELECT pg_temp.respond(11,'APP-REJECT','approve','BOD');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-REJECT','finalize','{"decision":"approve","reason":"Cannot override rejection"}')$q$,'P0001');
SELECT pg_temp.send(1,'APP-REJECT','finalize','{"decision":"reject","reason":"Required CRECOM confirmation was rejected."}');
-- Invite validation cannot create a regular BOD voter; no mail provider is called.
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
SELECT pg_temp.denied($q$SELECT public.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),jsonb_build_object('name','Synthetic','email','other@example.invalid','role','bod_member','committeeSeat','member','title','','startsAt',now(),'endsAt',null))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.seat(11,'member')$q$,'P0001');
DO $$
DECLARE request uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); payload jsonb; result jsonb; membership uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
 payload:=jsonb_build_object('name','Synthetic new chairperson','email','new-chair@example.invalid','role','crecom_member','committeeSeat','chairperson','title','Optional display title','startsAt',now()-interval '1 day','endsAt',null);
 result:=public.committee_reserve_invite(request,attempt,payload);
 PERFORM pg_temp.assert_true(NOT (result->>'complete')::boolean,'new invitation reserves a request without creating a membership');
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,invited_at,encrypted_password)
 VALUES(pg_temp.actor(13),'new-chair@example.invalid',jsonb_build_object('role','crecom_member','account_status','active','committee_invitation_request_id',request),'{}',now(),now(),'synthetic-hash');
 result:=public.committee_finish_invite(request,attempt,pg_temp.actor(13));membership:=(result->>'membershipId')::uuid;
 PERFORM pg_temp.assert_true((SELECT committee_seat='chairperson' AND setup_completed_at IS NULL FROM public.staff_memberships WHERE id=membership),'trusted position survives invite completion, personal setup still required');
 PERFORM pg_temp.assert_true(public.committee_finish_invite(request,attempt,pg_temp.actor(13))=result,'completed invitation retry is idempotent');
END$$;
SELECT 'PASS: exact four-position workflow, mandatory BOD, same-position replacement, seat revocation, immutable confirmations, final authority and rejection gate' AS result;

SELECT set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
SELECT pg_temp.assert_true((SELECT count(*)>=4 FROM public.notifications WHERE user_id=pg_temp.actor(1) AND activity_category='approvals'),'Super Admin receives each individual committee confirmation');
SELECT pg_temp.assert_true((SELECT count(*)>=4 FROM public.notifications WHERE user_id=pg_temp.actor(2) AND activity_category='approvals'),'Admin receives committee confirmations too');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.notifications WHERE user_id=pg_temp.actor(4) AND data->>'actorName' IS NOT NULL),'member notices exclude internal actor details');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications n JOIN public.portal_activity_events e ON n.data->>'activityEventId'=e.id::text WHERE n.user_id=pg_temp.actor(1) AND e.category='approvals' AND e.action='committee_finalize' AND e.entity_key='APP-YES'),'one final approval alert per administrator');
UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{account_status}','"blocked"') WHERE id=pg_temp.actor(3);
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,status,role) VALUES('20000000-0000-0000-0000-000000000020',null,'SAMPLE-PENDING','Synthetic','Pending','pending','member');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications WHERE user_id=pg_temp.actor(2) AND title='Member account awaiting approval'),'pending accounts alert Admin');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.notifications WHERE user_id=pg_temp.actor(3) AND title='Member account awaiting approval'),'blocked Admin receives no new activity');
UPDATE public.members SET status='active' WHERE member_id='SAMPLE-PENDING';
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications n JOIN public.portal_activity_events e ON n.data->>'activityEventId'=e.id::text WHERE n.user_id=pg_temp.actor(1) AND e.action='account_status_changed' AND e.entity_key='SAMPLE-PENDING'),'activation event is persisted');
INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted) VALUES('a0000000-0000-4000-8000-000000000020','APP-NEW','20000000-0000-0000-0000-000000000004','Synthetic Borrower','Regular',1000,'pending',current_date);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications n JOIN public.portal_activity_events e ON n.data->>'activityEventId'=e.id::text WHERE n.user_id=pg_temp.actor(2) AND e.action='loan_submitted' AND e.entity_key='APP-NEW'),'new loan submission alerts ordinary Admin');
INSERT INTO public.application_consent_evidence(application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at) VALUES('a0000000-0000-4000-8000-000000000020','borrower','SYNTHETIC member',pg_temp.actor(4),'paper','SYNTHETIC paper reference',repeat('a',64),now());
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications WHERE user_id=pg_temp.actor(4) AND title='Loan consent evidence recorded'),'member receives own consent evidence receipt');
INSERT INTO public.loan_payments(loan_application_id,payment_amount,receipt_number,payment_status,recorded_by) VALUES('a0000000-0000-4000-8000-000000000020',100,'SAMPLE-R1','posted',pg_temp.actor(1));
UPDATE public.loan_payments SET payment_status='reversed',reversed_by=pg_temp.actor(1) WHERE receipt_number='SAMPLE-R1';
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.notifications n JOIN public.portal_activity_events e ON n.data->>'activityEventId'=e.id::text WHERE n.user_id=pg_temp.actor(2) AND e.category='payments'),'payments and reversals each alert Admin');
INSERT INTO public.announcements(title,status) VALUES('Synthetic announcement','draft');
UPDATE public.announcements SET status='published' WHERE title='Synthetic announcement';
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.notifications WHERE user_id=pg_temp.actor(1) AND activity_category='announcements'),'announcement draft and publish alerts');
INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(pg_temp.actor(1),'update-general-settings','system','success','{"privateSecret":"DO-NOT-COPY"}');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications n JOIN public.portal_activity_events e ON n.data->>'activityEventId'=e.id::text WHERE n.user_id=pg_temp.actor(1) AND e.action='update-general-settings'),'system settings alert Super Admin');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.notifications WHERE user_id=pg_temp.actor(2) AND activity_category='system'),'system settings are not broadcast to ordinary Admin');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.notifications WHERE message LIKE '%DO-NOT-COPY%' OR data::text LIKE '%DO-NOT-COPY%'),'audit details and secrets never copied');
DO $$DECLARE first uuid;second uuid;BEGIN
 first:=public.portal_emit_activity('TEST-RETRY','loans','test','Sample retry','Sample retry','application','APP-NEW',pg_temp.actor(1));
 second:=public.portal_emit_activity('TEST-RETRY','loans','test','Sample retry','Sample retry','application','APP-NEW',pg_temp.actor(1));
 PERFORM pg_temp.assert_true(first IS NOT NULL AND second IS NULL,'event retries are idempotent');
END$$;
SELECT pg_temp.denied($q$UPDATE public.portal_activity_events SET message='tampered'$q$,'42501');
CREATE POLICY simulated_legacy_admin_read ON public.notifications FOR SELECT TO authenticated USING(public.document_staff_access());
INSERT INTO public.notifications(user_id,title,message,type,send_to) VALUES(null,'Synthetic outgoing ledger','Synthetic outgoing ledger','info','allMembers');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(2)::text,true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.notifications WHERE user_id<>pg_temp.actor(2)),'RLS keeps other recipients private');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.notifications WHERE user_id IS NULL),'ordinary Admin without sending privilege cannot see outbox ledger');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.portal_activity_events WHERE super_admin_only),'Admin cannot read Super Admin-only event history');
SELECT pg_temp.denied($q$SELECT public.portal_emit_activity('FORGED','system','fake','fake','fake','system','x')$q$,'42501');
SELECT pg_temp.denied($q$INSERT INTO public.notifications(user_id,title,message,type) VALUES(pg_temp.actor(1),'forged','forged','info')$q$,'42501');
UPDATE public.notifications SET read=true WHERE user_id=pg_temp.actor(2);
SELECT pg_temp.denied($q$UPDATE public.notifications SET message='tampered' WHERE user_id=pg_temp.actor(2)$q$,'42501');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=pg_temp.actor(2) AND NOT read),'own read state can update');
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(4)::text,true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.notifications WHERE user_id<>pg_temp.actor(4)),'member cannot read staff or other member notices');
RESET ROLE;
SELECT 'PASS: role-specific events, per-reviewer approvals, pending accounts, loan requests, payments, announcements, system isolation, idempotence, read state and recipient RLS' AS result;

ROLLBACK;
