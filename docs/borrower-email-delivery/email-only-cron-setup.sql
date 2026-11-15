-- Schedule only the borrower email worker. Replace the token placeholder with
-- the same random token stored in the ignored local .env.local and Supabase
-- Edge Function Secrets. This updates the Vault entry created by the initial
-- setup instead of creating a duplicate secret.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'coop_email_worker_token'
  ) THEN
    RAISE EXCEPTION 'The borrower email worker token Vault entry is missing.';
  END IF;
END;
$$;

SELECT vault.update_secret(
  (SELECT id FROM vault.secrets WHERE name = 'coop_email_worker_token'),
  'REPLACE_WITH_COOP_EMAIL_WORKER_TOKEN',
  'coop_email_worker_token',
  'Bearer token used only by the borrower notification schedule',
  NULL
);

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'send-borrower-notification-emails';

SELECT cron.schedule(
  'send-borrower-notification-emails',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'coop_email_function_url'
      ) || '/functions/v1/send-borrower-notification-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-coop-email-worker-token', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'coop_email_worker_token'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

COMMIT;
