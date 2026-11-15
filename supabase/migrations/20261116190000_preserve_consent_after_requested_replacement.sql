BEGIN;

-- A requested document replacement changes the document packet hash. The
-- borrower's OTP-confirmed agreement and declared witnesses remain evidence
-- for the same application, so carry those exact records to the new hash only
-- when the member uploads a newer version of a file that staff requested.
CREATE OR REPLACE FUNCTION public.carry_consent_after_requested_replacement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  document_row public.loan_documents%ROWTYPE;
  app public.loan_applications%ROWTYPE;
  receipt public.loan_submission_agreements%ROWTYPE;
  member_user uuid;
  previous_version uuid;
  new_packet_hash text;
BEGIN
  SELECT * INTO document_row
  FROM public.loan_documents
  WHERE id = NEW.document_id;
  IF document_row.id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO previous_version
  FROM public.loan_document_versions
  WHERE document_id = NEW.document_id AND id <> NEW.id
  ORDER BY version DESC
  LIMIT 1;
  IF previous_version IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.loan_document_reviews review
    WHERE review.document_id = NEW.document_id
      AND review.version_id = previous_version
      AND review.status = 'needs_replacement'
      AND review.id = (
        SELECT latest.id FROM public.loan_document_reviews latest
        WHERE latest.document_id = NEW.document_id
          AND latest.version_id = previous_version
        ORDER BY latest.created_at DESC, latest.id DESC
        LIMIT 1
      )
  ) THEN RETURN NEW; END IF;

  SELECT * INTO app
  FROM public.loan_applications
  WHERE id = document_row.loan_application_id;
  SELECT user_id INTO member_user
  FROM public.members
  WHERE id = app.member_id;
  IF app.id IS NULL OR member_user IS NULL
    OR NEW.uploaded_by IS DISTINCT FROM member_user
    OR document_row.user_id IS DISTINCT FROM member_user
    OR app.status NOT IN ('pending', 'under review', 'returned', 'returned_for_requirements')
    THEN RETURN NEW;
  END IF;

  SELECT * INTO receipt
  FROM public.loan_submission_agreements
  WHERE application_id = app.id
    AND borrower_user_id = member_user
    AND terms_accepted IS TRUE
    AND information_certified IS TRUE;
  IF receipt.id IS NULL THEN RETURN NEW; END IF;

  new_packet_hash := public.private_application_verification_state(app.id)->>'packetHash';
  IF new_packet_hash IS NULL OR new_packet_hash = receipt.packet_hash THEN RETURN NEW; END IF;

  UPDATE public.loan_submission_agreements
  SET packet_hash = new_packet_hash
  WHERE id = receipt.id AND packet_hash = receipt.packet_hash;

  UPDATE public.application_consent_evidence evidence
  SET packet_hash = new_packet_hash
  WHERE evidence.application_id = app.id
    AND evidence.packet_hash = receipt.packet_hash
    AND evidence.invalidated_at IS NULL
    AND ((evidence.kind = 'borrower' AND evidence.id = receipt.id)
      OR (evidence.kind = 'witness'
        AND evidence.evidence_reference = 'Witness name submitted with OTP-confirmed borrower agreement: ' || receipt.id::text));

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.carry_consent_after_requested_replacement() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS carry_consent_after_requested_replacement ON public.loan_document_versions;
CREATE TRIGGER carry_consent_after_requested_replacement
AFTER INSERT ON public.loan_document_versions
FOR EACH ROW EXECUTE FUNCTION public.carry_consent_after_requested_replacement();

-- Repair evidence for replacement versions that were already uploaded before
-- this migration, but only when the prior version has an explicit staff
-- replacement review and the newer version belongs to the linked borrower.
DO $backfill$
DECLARE
  item record;
  new_packet_hash text;
BEGIN
  FOR item IN
    SELECT DISTINCT app.id AS application_id, member.user_id, receipt.id AS receipt_id, receipt.packet_hash AS old_packet_hash
    FROM public.loan_applications app
    JOIN public.members member ON member.id = app.member_id
    JOIN public.loan_submission_agreements receipt ON receipt.application_id = app.id
      AND receipt.borrower_user_id = member.user_id
      AND receipt.terms_accepted IS TRUE AND receipt.information_certified IS TRUE
    WHERE app.status IN ('pending', 'under review', 'returned', 'returned_for_requirements')
      AND EXISTS (
        SELECT 1
        FROM public.loan_documents doc
        JOIN public.loan_document_reviews review ON review.document_id = doc.id
          AND review.status = 'needs_replacement'
          AND review.id = (
            SELECT latest.id FROM public.loan_document_reviews latest
            WHERE latest.document_id = doc.id AND latest.version_id = review.version_id
            ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
          )
        JOIN public.loan_document_versions old_version ON old_version.id = review.version_id
        JOIN public.loan_document_versions replacement ON replacement.document_id = doc.id
          AND replacement.version > old_version.version
          AND replacement.uploaded_by = member.user_id
        WHERE doc.loan_application_id = app.id AND doc.user_id = member.user_id
      )
  LOOP
    new_packet_hash := public.private_application_verification_state(item.application_id)->>'packetHash';
    IF new_packet_hash IS NULL OR new_packet_hash = item.old_packet_hash THEN CONTINUE; END IF;

    UPDATE public.loan_submission_agreements
    SET packet_hash = new_packet_hash
    WHERE id = item.receipt_id AND packet_hash = item.old_packet_hash;

    UPDATE public.application_consent_evidence evidence
    SET packet_hash = new_packet_hash
    WHERE evidence.application_id = item.application_id
      AND evidence.packet_hash = item.old_packet_hash
      AND evidence.invalidated_at IS NULL
      AND ((evidence.kind = 'borrower' AND evidence.id = item.receipt_id)
        OR (evidence.kind = 'witness'
          AND evidence.evidence_reference = 'Witness name submitted with OTP-confirmed borrower agreement: ' || item.receipt_id::text));
  END LOOP;
END;
$backfill$;

NOTIFY pgrst, 'reload schema';
COMMIT;
