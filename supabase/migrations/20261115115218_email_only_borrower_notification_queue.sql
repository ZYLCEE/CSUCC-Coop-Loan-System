-- Email-only borrower notification queue integration.
-- Adds new queue metadata and private worker functions. It does not replace
-- portal_record_activity, portal_emit_activity, or any approval/verification
-- function. Existing queued rows stay ineligible; only new verified-borrower
-- notifications are added to the worker queue.
BEGIN;

ALTER TABLE public.application_email_outbox
  ADD COLUMN IF NOT EXISTS lease_id uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS application_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS delivery_payload jsonb,
  ADD COLUMN IF NOT EXISTS first_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_eligible boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS portal_email_notification_unique
  ON public.application_email_outbox(notification_id)
  WHERE notification_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.portal_capture_email_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT jsonb_build_object(
    'application_id', a.application_id,
    'member_name', a.member_name,
    'loan_type', a.loan_type,
    'status', a.status
  )
  INTO NEW.application_snapshot
  FROM public.loan_applications AS a
  WHERE a.id = NEW.application_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_capture_email_context()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portal_capture_email_context
  ON public.application_email_outbox;
CREATE TRIGGER portal_capture_email_context
  BEFORE INSERT ON public.application_email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.portal_capture_email_context();

CREATE OR REPLACE FUNCTION public.portal_queue_borrower_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  app public.loan_applications%ROWTYPE;
  email_address text;
  account_role text;
BEGIN
  IF NEW.user_id IS NULL
     OR NEW.data->>'entityType' IS DISTINCT FROM 'application'
     OR NEW.data->>'entityKey' IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.* INTO app
  FROM public.loan_applications AS a
  JOIN public.members AS m ON m.id = a.member_id
  WHERE a.application_id = NEW.data->>'entityKey'
    AND m.user_id = NEW.user_id
  LIMIT 1;
  IF app.id IS NULL THEN RETURN NEW; END IF;

  SELECT u.email, u.raw_app_meta_data->>'role'
    INTO email_address, account_role
  FROM auth.users AS u
  WHERE u.id = NEW.user_id
    AND u.email_confirmed_at IS NOT NULL
    AND coalesce(u.raw_app_meta_data->>'account_status', 'active') = 'active'
    AND (u.banned_until IS NULL OR u.banned_until <= now());

  IF email_address IS NULL
     OR account_role IN ('super_admin', 'admin', 'crecom_member', 'bod_member') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.application_email_outbox(
    application_id, member_auth_id, recipient_email, subject, message,
    request_id, notification_id, email_eligible
  ) VALUES (
    app.id, NEW.user_id, email_address, NEW.title, NEW.message,
    NEW.id, NEW.id, true
  ) ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_queue_borrower_email()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS portal_queue_borrower_email ON public.notifications;
CREATE TRIGGER portal_queue_borrower_email
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.portal_queue_borrower_email();

CREATE OR REPLACE FUNCTION public.portal_claim_email_jobs(p_limit integer DEFAULT 20)
RETURNS SETOF public.application_email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Choose a valid email batch size.';
  END IF;

  UPDATE public.application_email_outbox
  SET status = 'failed',
      last_error = 'Delivery confirmation expired. Review provider history before retrying.'
  WHERE email_eligible
    AND status IN ('sending', 'queued')
    AND first_attempt_at < now() - interval '23 hours';

  UPDATE public.application_email_outbox AS o
  SET status = 'failed',
      last_error = 'Recipient email is not currently verified for this member.'
  WHERE o.email_eligible
    AND o.status IN ('queued', 'sending')
    AND NOT EXISTS (
      SELECT 1 FROM auth.users AS u
      WHERE u.id = o.member_auth_id
        AND lower(u.email) = lower(o.recipient_email)
        AND u.email_confirmed_at IS NOT NULL
    );

  RETURN QUERY
  WITH ready AS (
    SELECT id
    FROM public.application_email_outbox
    WHERE email_eligible
      AND (
        (status = 'queued' AND next_attempt_at <= now())
        OR (status = 'sending' AND locked_at < now() - interval '10 minutes')
      )
      AND attempts < 6
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.application_email_outbox AS o
  SET status = 'sending',
      lease_id = gen_random_uuid(),
      locked_at = now(),
      attempts = attempts + 1,
      first_attempt_at = coalesce(first_attempt_at, now()),
      application_snapshot = coalesce(
        o.application_snapshot,
        (
          SELECT jsonb_build_object(
            'application_id', a.application_id,
            'member_name', a.member_name,
            'loan_type', a.loan_type,
            'status', a.status
          )
          FROM public.loan_applications AS a
          WHERE a.id = o.application_id
        )
      )
  FROM ready
  WHERE o.id = ready.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_prepare_email_payload(
  p_id uuid, p_lease uuid, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  output jsonb;
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR octet_length(p_payload::text) > 200000 THEN
    RAISE EXCEPTION 'Choose a valid email payload.';
  END IF;

  UPDATE public.application_email_outbox
  SET delivery_payload = coalesce(delivery_payload, p_payload)
  WHERE id = p_id
    AND lease_id = p_lease
    AND status = 'sending'
    AND email_eligible
    AND p_payload->'to' = jsonb_build_array(recipient_email)
  RETURNING delivery_payload INTO output;

  IF output IS NULL THEN
    RAISE EXCEPTION 'Email delivery lease changed.' USING ERRCODE = '40001';
  END IF;
  RETURN output;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_finish_email_job(
  p_id uuid, p_lease uuid, p_success boolean,
  p_provider_id text DEFAULT NULL, p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  IF p_success AND nullif(btrim(p_provider_id), '') IS NULL THEN
    RAISE EXCEPTION 'Provider acceptance must be confirmed before marking sent.';
  END IF;

  UPDATE public.application_email_outbox
  SET status = CASE
        WHEN p_success THEN 'sent'
        WHEN attempts >= 6 THEN 'failed'
        ELSE 'queued'
      END,
      sent_at = CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,
      provider_message_id = CASE WHEN p_success THEN left(p_provider_id, 200) ELSE provider_message_id END,
      last_error = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error, 'Email provider unavailable'), 500) END,
      next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, attempts)::integer)),
      lease_id = NULL,
      locked_at = NULL
  WHERE id = p_id
    AND lease_id = p_lease
    AND status = 'sending'
    AND email_eligible;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_claim_email_jobs(integer),
  public.portal_prepare_email_payload(uuid, uuid, jsonb),
  public.portal_finish_email_job(uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_claim_email_jobs(integer),
  public.portal_prepare_email_payload(uuid, uuid, jsonb),
  public.portal_finish_email_job(uuid, uuid, boolean, text, text)
  TO service_role;

COMMIT;
