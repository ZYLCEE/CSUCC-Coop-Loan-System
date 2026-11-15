-- Stops new borrower email queuing and disables future delivery while
-- preserving outbox rows, delivery payloads, and provider outcome history.
BEGIN;

DROP TRIGGER IF EXISTS portal_queue_borrower_email ON public.notifications;
DROP TRIGGER IF EXISTS portal_capture_email_context
  ON public.application_email_outbox;

DROP FUNCTION IF EXISTS public.portal_queue_borrower_email();
DROP FUNCTION IF EXISTS public.portal_capture_email_context();
DROP FUNCTION IF EXISTS public.portal_claim_email_jobs(integer);
DROP FUNCTION IF EXISTS public.portal_prepare_email_payload(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.portal_finish_email_job(uuid, uuid, boolean, text, text);

-- Retain the additive columns and index so existing delivery records remain
-- inspectable and recoverable. Disable all unsent rows without deleting them.
UPDATE public.application_email_outbox
SET email_eligible = false
WHERE status IN ('queued', 'sending');

COMMIT;
