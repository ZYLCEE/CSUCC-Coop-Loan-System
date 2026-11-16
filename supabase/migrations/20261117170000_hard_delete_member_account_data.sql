BEGIN;

-- Committee history remains immutable in ordinary operation. A verified
-- service-role account purge is the single exception needed to erase all rows
-- that belong to a deleted member's loan applications.
CREATE OR REPLACE FUNCTION public.committee_decision_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('request.jwt.claim.role', true) = 'service_role'
     AND current_setting('coop.member_account_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Committee decision history is immutable. Use a new authorized review cycle.' USING ERRCODE = '42501';
END;
$function$;

-- This RPC is only callable by the trusted account-management edge function.
-- It removes a member's loan records and private loan files' metadata in one DB
-- transaction, then returns storage object paths for the edge function to purge.
CREATE OR REPLACE FUNCTION public.purge_member_account_data(p_member_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  member_row public.members%ROWTYPE;
  application_ids uuid[];
  linked_request_ids uuid[];
  object_paths text[];
BEGIN
  IF p_member_id IS NULL OR btrim(p_member_id) = '' THEN
    RAISE EXCEPTION 'A member ID is required.';
  END IF;

  SELECT * INTO member_row
  FROM public.members
  WHERE member_id = btrim(p_member_id)
  FOR UPDATE;
  IF NOT FOUND OR member_row.user_id IS NULL THEN
    RAISE EXCEPTION 'The member account could not be found.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = member_row.user_id
      AND coalesce(u.raw_app_meta_data->>'role', 'member') <> 'member'
  ) THEN
    RAISE EXCEPTION 'Only member accounts can be permanently deleted here.';
  END IF;

  SELECT coalesce(array_agg(id), '{}'::uuid[])
  INTO application_ids
  FROM public.loan_applications
  WHERE member_id = member_row.id;

  -- Keep other borrowers' loan and accepted co-maker consent records intact.
  -- An administrator must resolve an external co-maker link before deleting
  -- this member's identity.
  IF EXISTS (
    SELECT 1 FROM public.loan_applications a
    WHERE a.member_id <> member_row.id
      AND a.co_maker_member_id = member_row.id
  ) OR EXISTS (
    SELECT 1 FROM public.co_maker_requests r
    WHERE r.borrower_member_id <> member_row.id
      AND r.co_maker_member_id = member_row.id
  ) OR EXISTS (
    SELECT 1 FROM public.application_consent_evidence e
    WHERE e.kind = 'co_maker'
      AND e.application_id <> ALL(application_ids)
      AND (e.subject_user_id = member_row.user_id
        OR e.subject_reference IN (member_row.member_id, member_row.id::text))
  ) THEN
    RAISE EXCEPTION 'This member is linked as a co-maker on another member''s loan. Resolve that link before deleting this account.';
  END IF;

  SELECT coalesce(array_agg(id), '{}'::uuid[])
  INTO linked_request_ids
  FROM public.co_maker_requests
  WHERE borrower_member_id = member_row.id;

  SELECT coalesce(array_agg(path), '{}'::text[])
  INTO object_paths
  FROM (
    SELECT d.storage_path AS path
    FROM public.loan_documents d
    WHERE d.loan_application_id = ANY(application_ids)
    UNION
    SELECT v.storage_path
    FROM public.loan_document_versions v
    JOIN public.loan_documents d ON d.id = v.document_id
    WHERE d.loan_application_id = ANY(application_ids)
    UNION
    SELECT a.co_maker_id_document_path
    FROM public.loan_applications a
    WHERE a.id = ANY(application_ids) AND a.co_maker_id_document_path IS NOT NULL
    UNION
    SELECT r.co_maker_id_document_path
    FROM public.co_maker_requests r
    WHERE r.id = ANY(linked_request_ids) AND r.co_maker_id_document_path IS NOT NULL
  ) paths
  WHERE path IS NOT NULL AND btrim(path) <> '';

  DELETE FROM public.shared_document_recipients
  WHERE member_id = member_row.id;

  -- Remove application-scoped workflow and committee records before deleting
  -- the application rows; these tables intentionally have restrictive FKs.
  PERFORM set_config('coop.member_account_purge', 'on', true);
  DELETE FROM public.committee_notification_links l
  USING public.review_assignments ra, public.application_review_cycles c
  WHERE l.assignment_id = ra.id AND ra.review_cycle_id = c.id
    AND c.application_id = ANY(application_ids);
  DELETE FROM public.individual_review_decisions d
  USING public.review_assignments ra, public.application_review_cycles c
  WHERE d.assignment_id = ra.id AND ra.review_cycle_id = c.id
    AND c.application_id = ANY(application_ids);
  DELETE FROM public.committee_review_events WHERE application_id = ANY(application_ids);
  DELETE FROM public.application_final_decisions WHERE application_id = ANY(application_ids);
  DELETE FROM public.review_assignments ra
  USING public.application_review_cycles c
  WHERE ra.review_cycle_id = c.id AND c.application_id = ANY(application_ids);
  DELETE FROM public.application_review_cycles WHERE application_id = ANY(application_ids);
  DELETE FROM public.portal_action_requests WHERE application_id = ANY(application_ids);
  DELETE FROM public.portal_rejection_requests WHERE application_id = ANY(application_ids);
  DELETE FROM public.application_email_outbox WHERE application_id = ANY(application_ids);
  DELETE FROM public.application_workflow_events WHERE application_id = ANY(application_ids);
  DELETE FROM public.application_consent_evidence WHERE application_id = ANY(application_ids);
  DELETE FROM public.application_verifications WHERE application_id = ANY(application_ids);
  DELETE FROM public.loan_submission_agreements WHERE application_id = ANY(application_ids);
  -- Remove requests submitted by this member. External co-maker links were
  -- rejected above so another borrower's consent evidence is never removed.
  DELETE FROM public.co_maker_requests WHERE id = ANY(linked_request_ids);

  -- Loan payments, loan documents/versions/reviews, and savings accounts are
  -- removed by the declared ON DELETE CASCADE relationships.
  DELETE FROM public.loan_applications WHERE id = ANY(application_ids);

  -- Keep unrelated accounts intact if this user originally created them.
  UPDATE public.members SET created_by = NULL WHERE created_by = member_row.user_id;
  DELETE FROM public.members WHERE id = member_row.id;

  RETURN jsonb_build_object(
    'member_id', member_row.member_id,
    'user_id', member_row.user_id,
    'storage_paths', to_jsonb(object_paths),
    'loan_applications_deleted', cardinality(application_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_member_account_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_member_account_data(text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
