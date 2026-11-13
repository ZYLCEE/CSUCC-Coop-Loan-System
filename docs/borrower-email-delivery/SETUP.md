# Borrower notification email delivery

In-app application notices are normalized and queued by
`20261113091000_portal_borrower_notifications.sql`. The
`send-borrower-notification-emails` Edge Function drains that queue through
Gmail SMTP. It sends only to the application's verified borrower email address;
staff and committee notifications are not sent by this worker.

Use Gmail SMTP for application notification copies. Supabase Auth's built-in
email service is a separate path for OTP, password-reset, and account emails;
it is not an application notification relay and its built-in sender restricts
recipients. If co-makers need to receive Auth OTP messages at their registered
addresses, configure Gmail as Supabase Auth's custom SMTP provider as well.
This routes Auth messages through Gmail; it does not send duplicate copies.

## Gmail configuration

Use a project mailbox, enable Google's 2-Step Verification, and create an app
password for it. Keep that password server-side. The authenticated SMTP account
and `SMTP_FROM` address must be the same Gmail address.

For local Edge Function development, copy
`supabase/functions/.env.example` to `supabase/functions/.env`, fill in the
values locally, and serve the function with that file. The member app's root
`.env` is bundled into the Flutter application and must not contain SMTP
credentials.

For hosted Supabase Functions, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `COOP_MEMBER_APP_URL`, and
`COOP_EMAIL_WORKER_TOKEN` in **Edge Function Secrets**. Supabase supplies the
project URL and service role key to the function. Use the worker token only for
the scheduled invocation; never place it in client code.

Supabase Auth custom SMTP is configured separately in **Authentication → SMTP
Settings**. The Edge Function secrets do not configure Auth, and Auth SMTP
settings do not automatically configure Edge Functions.

## Queue and retries

The Edge Function requires the queue schema and RPCs from
`20261113091000_portal_borrower_notifications.sql`. Production migration history
and live workflow definitions need reconciliation before applying that
migration; do not apply it piecemeal or run an ordinary `supabase db push`
against the ambiguous migration history.

After schema reconciliation and function deployment, invoke the function on a
schedule with Supabase Cron. Monitor queued, sent, and failed outbox states and
the Edge Function logs. A stable Message-ID helps identify a retried message,
but SMTP does not provide the same provider-side idempotency guarantee as an
email API. A connection lost after Gmail accepts a message can leave delivery
ambiguous; review provider history before manually retrying such a job.

Use only one worker to drain the outbox at a time. Do not run the optional Node
Resend worker alongside the Edge Function, since both could send the same
queued notices.

## Wording review

The current application email uses the requested subject, member greeting,
application number, loan type, current stage, Philippine timestamp, action
guidance, View Details link, and automated-message footer. The SQL notification
templates already cover individual CRECOM progress, the completed third CRECOM
approval, BOD review, final approval or rejection, and release.

The co-maker decline flow does not currently collect a member-facing reason, so
its message should say to review the response and available next steps rather
than promise a recorded reason. Keep approval, final approval, and release as
separate statuses. Emails inform the recipient; consent decisions and workflow
actions still occur in the app.
