-- Email delivery for recipient-addressed in-app notifications created after
-- this migration. Existing notifications are intentionally not backfilled.
-- Borrower application notices remain on application_email_outbox so their
-- existing eligibility and exclusion rules remain unchanged.
BEGIN;

CREATE TABLE public.notification_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES public.notifications(id),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email text NOT NULL CHECK (length(recipient_email) BETWEEN 3 AND 320),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  message text NOT NULL CHECK (length(message) <= 2000),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  locked_at timestamptz,
  first_attempt_at timestamptz,
  delivery_payload jsonb,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX notification_email_outbox_ready
  ON public.notification_email_outbox(status,next_attempt_at,created_at)
  WHERE status IN ('queued','sending');

ALTER TABLE public.notification_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_email_outbox FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.notification_email_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.portal_queue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient_email text;
  recipient_role text;
  email_confirmed_at timestamptz;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT u.email,u.raw_app_meta_data->>'role',u.email_confirmed_at
    INTO recipient_email,recipient_role,email_confirmed_at
  FROM auth.users AS u
  WHERE u.id=NEW.user_id;

  IF recipient_email IS NULL OR email_confirmed_at IS NULL THEN RETURN NEW; END IF;

  -- The existing borrower worker already sends these application-owner
  -- notices. Keep them there to avoid duplicate mail and retain its eligibility
  -- checks for verified, active borrower accounts.
  IF coalesce(recipient_role,'member') NOT IN ('super_admin','admin','coop_admin','crecom_member','bod_member')
     AND NEW.data->>'entityType'='application'
     AND EXISTS (
       SELECT 1
       FROM public.loan_applications AS a
       JOIN public.members AS m ON m.id=a.member_id
       WHERE a.application_id=NEW.data->>'entityKey'
         AND m.user_id=NEW.user_id
     ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_email_outbox(
    notification_id,recipient_user_id,recipient_email,subject,message
  ) VALUES (
    NEW.id,NEW.user_id,recipient_email,left(coalesce(nullif(btrim(NEW.title),''),'Portal notification'),200),left(coalesce(NEW.message,''),2000)
  ) ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_queue_notification_email()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS portal_queue_notification_email ON public.notifications;
CREATE TRIGGER portal_queue_notification_email
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.portal_queue_notification_email();

CREATE OR REPLACE FUNCTION public.portal_claim_notification_email_jobs(p_limit integer DEFAULT 20)
RETURNS SETOF public.notification_email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Choose a valid email batch size.';
  END IF;

  UPDATE public.notification_email_outbox
  SET status='failed',last_error='Delivery confirmation expired. Review provider history before retrying.',
      lease_id=NULL,locked_at=NULL
  WHERE status='sending' AND first_attempt_at < now()-interval '23 hours';

  UPDATE public.notification_email_outbox AS o
  SET status='failed',last_error='Recipient email is no longer verified for this account.',
      lease_id=NULL,locked_at=NULL
  WHERE o.status IN ('queued','sending')
    AND NOT EXISTS (
      SELECT 1 FROM auth.users AS u
      WHERE u.id=o.recipient_user_id
        AND lower(u.email)=lower(o.recipient_email)
        AND u.email_confirmed_at IS NOT NULL
    );

  RETURN QUERY
  WITH ready AS (
    SELECT id
    FROM public.notification_email_outbox
    WHERE ((status='queued' AND next_attempt_at<=now())
        OR (status='sending' AND locked_at<now()-interval '10 minutes'))
      AND attempts<6
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.notification_email_outbox AS o
  SET status='sending',lease_id=gen_random_uuid(),locked_at=now(),attempts=attempts+1,
      first_attempt_at=coalesce(first_attempt_at,now())
  FROM ready
  WHERE o.id=ready.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_prepare_notification_email_payload(
  p_id uuid,p_lease uuid,p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE output jsonb;
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR octet_length(p_payload::text)>200000 THEN
    RAISE EXCEPTION 'Choose a valid email payload.';
  END IF;

  UPDATE public.notification_email_outbox
  SET delivery_payload=coalesce(delivery_payload,p_payload)
  WHERE id=p_id AND lease_id=p_lease AND status='sending'
    AND p_payload->'to'=jsonb_build_array(recipient_email)
  RETURNING delivery_payload INTO output;

  IF output IS NULL THEN
    RAISE EXCEPTION 'Email delivery lease changed.' USING ERRCODE='40001';
  END IF;
  RETURN output;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_finish_notification_email_job(
  p_id uuid,p_lease uuid,p_success boolean,
  p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE changed integer;
BEGIN
  IF p_success AND nullif(btrim(p_provider_id),'') IS NULL THEN
    RAISE EXCEPTION 'Provider acceptance must be confirmed before marking sent.';
  END IF;

  UPDATE public.notification_email_outbox
  SET status=CASE WHEN p_success THEN 'sent' WHEN attempts>=6 THEN 'failed' ELSE 'queued' END,
      sent_at=CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,
      provider_message_id=CASE WHEN p_success THEN left(p_provider_id,200) ELSE provider_message_id END,
      last_error=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Email provider unavailable'),500) END,
      next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::integer)),
      lease_id=NULL,locked_at=NULL
  WHERE id=p_id AND lease_id=p_lease AND status='sending';

  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_claim_notification_email_jobs(integer),
  public.portal_prepare_notification_email_payload(uuid,uuid,jsonb),
  public.portal_finish_notification_email_job(uuid,uuid,boolean,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_claim_notification_email_jobs(integer),
  public.portal_prepare_notification_email_payload(uuid,uuid,jsonb),
  public.portal_finish_notification_email_job(uuid,uuid,boolean,text,text)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
