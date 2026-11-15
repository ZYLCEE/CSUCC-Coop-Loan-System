  BEGIN;

  -- Keep the same borrower ownership, requested-review, version, storage-object,
  -- MIME type, and size checks. Returned-for-requirements applications can submit
  -- the specifically requested document only while that return stage is active.
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
    IF review_status IS DISTINCT FROM 'needs_replacement'
      OR app_status IS NULL
      OR app_status NOT IN ('pending','under review','returned','returned_for_requirements')
      OR (app_status='returned_for_requirements' AND NOT EXISTS(
        SELECT 1 FROM public.application_verifications v
        WHERE v.application_id=d.loan_application_id AND v.stage='returned_for_requirements'
      ))
      THEN RAISE EXCEPTION 'A replacement can be submitted only for a requested file while the application is Pending, Under Review, or actively returned for requirements.'; END IF;
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
    -- The new version starts unreviewed; old versions and review history remain.
    RETURN jsonb_build_object('id',created_id,'version',coalesce(current_number,1)+1);
  END;
  $$;

  NOTIFY pgrst,'reload schema';
  COMMIT;
