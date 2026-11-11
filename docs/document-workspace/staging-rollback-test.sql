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

CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
  RAISE EXCEPTION 'Expected rejection: %',command;
END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES
 ('10000000-0000-0000-0000-000000000001','staff-documents-test@example.invalid','{"role":"super_admin","account_status":"active"}','{"full_name":"Test reviewer"}'),
 ('10000000-0000-0000-0000-000000000002','reader-documents-test@example.invalid','{"role":"admin","account_status":"active","admin_privileges":[]}','{}'),
 ('10000000-0000-0000-0000-000000000003','member-one-documents-test@example.invalid','{"role":"member","account_status":"active"}','{}'),
 ('10000000-0000-0000-0000-000000000004','member-two-documents-test@example.invalid','{"role":"member","account_status":"active"}','{}');
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,membership_type) VALUES
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','TEST-3','Synthetic','Member One','Regular'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','TEST-4','Synthetic','Member Two','Associate');
INSERT INTO public.loan_applications VALUES('30000000-0000-0000-0000-000000000001','TEST-APP','20000000-0000-0000-0000-000000000003','Synthetic Member One','Business',1000,'pending',current_date);
INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','validId','10000000-0000-0000-0000-000000000003/original.pdf','original.pdf','application/pdf',10);
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('loan-documents','10000000-0000-0000-0000-000000000003/original.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('loan-documents','10000000-0000-0000-0000-000000000003/replacement.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('coop-shared-documents','10000000-0000-0000-0000-000000000001/selected.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('coop-shared-documents','10000000-0000-0000-0000-000000000001/all.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('coop-shared-documents','10000000-0000-0000-0000-000000000001/draft.pdf','{"size":10,"mimetype":"application/pdf"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true((public.document_workspace_capabilities()->>'canReview')::boolean=false,'read-only admin cannot review');
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'verified',null)$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.search_document_recipients('Synthetic')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.search_document_recipients('Synthetic Member One')),'full name recipient search');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.search_document_recipients('%')),'search wildcard is literal');
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'needs_replacement','  ')$q$,'P0001');
SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'needs_replacement','The ID photo is blurred. Upload a clear copy.');
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'verified',null)$q$,'40001');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.loan_document_reviews),'owner sees review reason');
SELECT public.submit_document_replacement('40000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000003/replacement.pdf','replacement.pdf','application/pdf',10);
SELECT public.submit_document_replacement('40000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000003/replacement.pdf','replacement.pdf','application/pdf',10);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.loan_document_versions),'replacement retry is idempotent');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_document_reviews WHERE version_id IS NOT NULL),'new version has no inherited review');
SELECT pg_temp.denied($q$DELETE FROM public.loan_document_versions$q$,'42501');
-- DELETE returns no rows under RLS. Submitted original and replacement remain.
SET LOCAL storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='loan-documents';
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='loan-documents'),'original and replacement cannot be deleted');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_document_versions),'other member cannot read versions');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_document_reviews),'other member cannot read reviews');
SELECT pg_temp.denied($q$SELECT public.submit_document_replacement('40000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000004/wrong.pdf','wrong.pdf','application/pdf',10)$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'verified',null)$q$,'40001');
SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',(SELECT id FROM public.loan_document_versions LIMIT 1),null,'verified',null);
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.loan_applications LIMIT 1),'verification never approves a loan');
SELECT public.save_shared_document('{"id":"50000000-0000-0000-0000-000000000001","title":"Selected test","category":"Forms","audience":"selected","recipient_ids":["20000000-0000-0000-0000-000000000003"],"publish":true,"storage_path":"10000000-0000-0000-0000-000000000001/selected.pdf","original_name":"selected.pdf","content_type":"application/pdf","size_bytes":10,"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
SELECT public.save_shared_document('{"id":"50000000-0000-0000-0000-000000000002","title":"All test","category":"Forms","audience":"all","recipient_ids":[],"publish":true,"storage_path":"10000000-0000-0000-0000-000000000001/all.pdf","original_name":"all.pdf","content_type":"application/pdf","size_bytes":10,"fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
SELECT public.save_shared_document('{"id":"50000000-0000-0000-0000-000000000003","title":"Draft test","category":"Forms","audience":"all","recipient_ids":[],"publish":false,"storage_path":"10000000-0000-0000-0000-000000000001/draft.pdf","original_name":"draft.pdf","content_type":"application/pdf","size_bytes":10,"fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.shared_documents),'chosen member sees selected plus all, not draft');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.shared_document_recipients),'member sees only own assignment');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'file storage follows same audience');
SELECT pg_temp.denied($q$SELECT public.save_shared_document('{}')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.shared_documents),'unselected member sees all-members document only');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.shared_document_recipients),'unselected member cannot enumerate recipients');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'unselected member cannot read selected or draft files');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='10000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.shared_documents),'banned member cannot read shared documents');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT public.publish_shared_document('50000000-0000-0000-0000-000000000003','2000-01-01','selected','{}')$q$,'40001');
SELECT pg_temp.denied($q$SELECT public.publish_shared_document('50000000-0000-0000-0000-000000000003',(SELECT updated_at FROM public.shared_documents WHERE id='50000000-0000-0000-0000-000000000003'),'selected','{}')$q$,'P0001');
SELECT public.publish_shared_document('50000000-0000-0000-0000-000000000003',(SELECT updated_at FROM public.shared_documents WHERE id='50000000-0000-0000-0000-000000000003'),'selected',ARRAY['20000000-0000-0000-0000-000000000003']::uuid[]);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.shared_documents),'draft becomes visible after explicit publish');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT public.delete_shared_document('50000000-0000-0000-0000-000000000001',(SELECT updated_at FROM public.shared_documents WHERE id='50000000-0000-0000-0000-000000000001'));
SELECT public.delete_shared_document('50000000-0000-0000-0000-000000000001','2000-01-01');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.shared_documents),'deletion removes member metadata access');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'deletion removes file access');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'soft deletion retains stored originals');
UPDATE public.members SET status='blocked' WHERE user_id='10000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
DELETE FROM storage.objects WHERE bucket_id='loan-documents';
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='loan-documents'),'inactive owner cannot delete retained files through hidden review metadata');
SELECT 'PASS: review permissions, concurrency, ownership, replacement retention, recipient privacy, draft publication and deletion' AS result;

ROLLBACK;
