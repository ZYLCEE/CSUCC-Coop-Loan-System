-- One-off repair: the deployed return RPC writes an outbox row in the same transaction as the
-- in-app notice. Restore the missing base table so returns can complete.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.application_email_outbox') IS NOT NULL THEN
    RAISE EXCEPTION 'application_email_outbox already exists; reconcile its definition before applying this repair.';
  END IF;
END;
$$;

CREATE TABLE public.application_email_outbox(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.loan_applications(id),
  member_auth_id uuid NOT NULL REFERENCES auth.users(id),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  notification_id uuid REFERENCES public.notifications(id),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  last_error text
);

ALTER TABLE public.application_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_email_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.application_email_outbox TO authenticated;
GRANT ALL ON public.application_email_outbox TO service_role;
CREATE POLICY staff_read_application_email_outbox
  ON public.application_email_outbox
  FOR SELECT TO authenticated
  USING(public.document_staff_access('applications.return'));

NOTIFY pgrst,'reload schema';
COMMIT;
