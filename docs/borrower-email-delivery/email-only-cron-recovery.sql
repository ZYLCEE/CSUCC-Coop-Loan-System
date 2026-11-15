-- Stops only the borrower email schedule. Vault secrets are retained until
-- the operator confirms no queued pg_net request still references them.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'send-borrower-notification-emails';
