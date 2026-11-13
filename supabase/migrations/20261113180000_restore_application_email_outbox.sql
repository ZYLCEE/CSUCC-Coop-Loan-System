-- Restore the base email queue when a hosted database is missing it.
-- Earlier installations may already have this table from the workflow migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.application_email_outbox(
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

DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='application_email_outbox'
      AND policyname='staff_read_application_email_outbox'
  ) THEN
    CREATE POLICY staff_read_application_email_outbox
      ON public.application_email_outbox
      FOR SELECT TO authenticated
      USING(public.document_staff_access('applications.return'));
  END IF;
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
