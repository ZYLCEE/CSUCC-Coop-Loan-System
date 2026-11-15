# In-app and email notification delivery

## Scope

The project already creates recipient-specific in-app notifications for loan
processing, account status and detail changes, application review, documents,
payments, announcements, and recorded system activity. The email queue added by
`20261115125005_notification_email_delivery.sql` follows those same rows.

Each new in-app notification for a confirmed Auth email is queued once and sent
by the existing `send-borrower-notification-emails` worker. Email delivery has
its own lease, retry state, and provider message ID. It does not change the
notification's read state or broaden notification recipients. The queue is not
backfilled, and failed/unconfirmed recipient emails are not sent.

Borrower-owned application notifications stay in the existing
`application_email_outbox`; the general queue skips them to avoid duplicates.
The eight legacy ineligible application messages remain ineligible.

## Credentials

The worker uses the already configured Edge Function secrets:

- `COOP_EMAIL_WORKER_TOKEN`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_FROM`

The worker token in Supabase Vault must equal the Edge Function secret because
the existing five-minute `pg_cron` job invokes the worker with that Vault value.

Supabase Auth uses its separate Auth SMTP configuration for one-time codes,
account confirmation, recovery links and password resets. Those messages are
not application inbox rows. Password-reset requests do not generate an inbox
alert because they are unauthenticated and such an alert could expose whether
an account exists.

## Application and email content

General notification email includes the in-app title and recipient-safe message,
HTML escaped, with a sign-in instruction. It does not attach files or embed
document contents, private reviewer notes, or arbitrary navigation links.
Members, reviewers and staff receive only rows that the existing in-app event
fan-out addressed to their user ID.

## Deployment

Applied to Supabase project `jhgsqvxlvwhrwpcekvpq` on November 15, 2026:

- Migration `20261115125005_notification_email_delivery` creates the isolated
  general-notification email outbox and insert trigger.
- `send-borrower-notification-emails` is active at version 22 and claims up to
  five jobs from each email queue per run.
- The existing `send-borrower-notification-emails` cron job remains active every
  five minutes.

The migration did not replay prior notifications. At deployment, the general
outbox had zero rows, zero application emails were eligible, and the eight
legacy ineligible application messages remained excluded.
