# Borrower email delivery change review

Target: production Supabase project `CSUCC-Coop-Loan-System`
(`jhgsqvxlvwhrwpcekvpq`). No member-app, consent, committee, approval,
application-verification, or existing activity function is changed by the SQL
change below.

## Forward change

1. Apply `email-only-supabase-change.sql` to add only email lease/retry fields,
   email-specific trigger functions, and three service-role-only queue RPCs.
2. The existing `application_email_outbox` RLS, policies, grants, constraints,
   and staff-read access remain in place. The new trigger queues only notices
   tied to a borrower-owned application with a verified, active Auth account.
3. Existing queue rows default to `email_eligible = false`. The eight pending
   rows observed on 2026-11-15 will not be sent by the worker. New qualifying
   notifications are eligible.
4. Only `send-borrower-notification-emails` is deployed; it is version 3. Each
   invocation claims at most five messages. A missing member-app URL omits the
   link and tells the borrower to sign in to the app.
5. Configure the function's SMTP and URL secrets, then apply
   `email-only-cron-setup.sql` with the generated worker token substituted.
   The schedule runs every five minutes and calls only this email function.

## Required secrets

Set these in Supabase Dashboard → Edge Functions → Secrets:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=465`
- `SMTP_SECURE=true`
- `SMTP_USERNAME=csuccermpc@gmail.com`
- `SMTP_FROM=csuccermpc@gmail.com`
- `SMTP_PASSWORD` = the Gmail app password (never commit or paste into chat)
- `COOP_EMAIL_WORKER_TOKEN` = the random token in the ignored local `.env.local`

`COOP_MEMBER_APP_URL` is optional; if configured, use the borrower's publicly
reachable HTTPS app URL.

Supabase provides `SUPABASE_URL` and its server secret to Edge Functions.

## Recovery

1. Run `email-only-cron-recovery.sql` to unschedule
   `send-borrower-notification-emails`.
2. Remove the two `coop_email_*` Vault secrets and the two matching function
   secrets in the Dashboard.
3. Run `email-only-supabase-recovery.sql`. It removes only the email triggers
   and queue RPCs and disables pending sends. It intentionally retains queue
   metadata and delivery history so sent/ambiguous messages remain auditable.
4. Leave the already deployed function in place or delete only that function
   from the Supabase Dashboard. No other deployed function is changed.

No email should be sent until the forward SQL, secrets, cron, and a single
operator-triggered verification are all ready. The existing eight queued
notifications are excluded from automatic sending.
