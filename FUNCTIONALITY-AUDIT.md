# Portal functionality audit — 29 October 2026

## Implemented and checked

| Area | Change | Verification |
| --- | --- | --- |
| Dashboard / loan applications | View Details opens persisted application fields, recorded payments and document access instead of a disabled control / placeholder alert. | TypeScript, lint, production build; existing loan/document permissions retained. |
| Active Loans | Replaced the empty fixture with paginated database reads for approved, released and overdue applications; search, submission-date filter, pagination, CSV download and details. | API tests include multiple service pages and exclusion of completed loans. |
| Audit Logs | Replaced the empty fixture and fabricated totals/pages with stored activity records; search/date filtering, details, pagination and CSV download. | Protected read API and build checks. |
| Documents | Private uploads, list/search, temporary download URLs, explicit deletion confirmation, loading/error feedback. Configured extension and size limits are enforced on the server; hard maximum 10 MB. | Live private-bucket upload and signed download passed; temporary test object removed. API role and path checks tested. |
| Reports | Loan summaries, membership registry and recorded payment history from database records; daily/weekly/monthly/yearly ranges; CSV export and print/save-as-PDF. | Tests cover leap years, year boundaries, exclusive end dates and invalid periods/dates. |
| My Profile | Loads the signed-in user's linked profile, saves editable profile fields, verifies current password before changing password, clears password fields after success. | TypeScript/lint/build. Personal profile/password mutations were not performed during verification. |
| General settings | Cooperative name and document extension/size limits persist in private storage. Sidebar name updates; uploads read and enforce saved limits. | API validation and private-storage persistence tests. |
| Session security | Sign out the current administrator's other sessions using Supabase Auth. | SDK integration/build; no personal sessions were revoked during verification. |
| Data snapshot | Download actual member/loan/payment/audit/settings records as JSON. Clearly identified as a data export, excluding Auth credentials, stored file bytes and schema. | Role-protected read paths; no claims of full database backup or encryption. |
| Content Manager | Each tab loads and persists its own portal catalog. New/edit/duplicate/activate/deactivate/delete and search operate on saved entries. | TypeScript/lint/build and resource authorization/validation. |
| Announcements | Added categories, RLS, concurrency-checked management RPC, draft/publish/archive/restore/delete lifecycle, scheduled publication and member inbox fan-out. | Local PostgreSQL lifecycle/permission tests; user applied migration; live authenticated reads return four categories. |
| Member notifications | Added outgoing history fields, transactional recipient inbox delivery and scheduled-delivery worker. Counts are derived from actual eligible linked profiles; repeated delivery updates do not duplicate inbox messages. Composer checks service capabilities. | Local PostgreSQL delivery/count/idempotency tests; user applied migration; live schema read passed. No messages were sent to real members during verification. |
| Schedulers | Two one-minute Supabase Cron jobs for due announcements and notifications. | User confirmed both named jobs active after applying scheduler migration. |
| Navigation / build | Added the missing role-prefixed Members route aliases. Excluded separately deployed Deno functions from the Next.js TypeScript project. | Production build succeeds. |

## Scope and remaining limits

- Protected account changes and loan review/approval still use the existing deployed
  `secure-admin-action` Edge Function and its password/confirmation workflow.
  We did not perform live block/delete/approve operations to test them. Their
  successful persistence must not be inferred from compilation or unit tests.
- The checked-in `supabase/functions/secure-admin-action/index.ts` contains legacy
  placeholder account handlers and an in-memory grant store. It is **not an
  implementation to deploy over the existing live function**. The separate shared
  backend referenced by `list-admin-accounts/index.ts` is absent from this checkout.
  Auditing/replacing those deployed implementations requires their actual source.
- Content entries are persisted portal catalogs. Publishing those changes into the
  separate member application requires its code/backend integration, which is not
  present here. Catalog loan descriptions do not modify the database's accepted
  loan-type constraint or the operational Loan Policy settings.
- SMTP credentials, provider password/OTP policies, full database backup/restore
  and creation of new authorization roles are Supabase/provider operations. The
  replacement Settings screen links to the appropriate console or shows the
  actual enforced roles; it does not pretend to save unsupported controls.
- Existing Admin view-only restrictions remain. Signing in as a Member does not
  grant administrative access; protected writes require Super Admin.
- Payments lack settlement/reversal fields. Reports identify them as recorded
  payments; confirmed collections and actual balances are not fabricated.
- Browser interaction tests were not performed: the user selected code/API checks.
  Export/print dialogs and visual interactions should be checked in the signed-in
  portal. Several former placeholder pages now use simpler functional tables/forms.
- Some legacy components remain as unused source, with their original placeholder
  handlers. The active routes now import their functional replacements.

## Checks run

- All **54** tests under `src` and `scripts` passed.
- Local PostgreSQL migration checks passed: announcement creation/publication,
  member inbox delivery, stale-write rejection, non-admin denial, notification
  recipient counts and duplicate-delivery protection.
- Changed frontend/server feature files passed ESLint.
- `npm run build` completed successfully, including TypeScript and page generation.
- Live anonymous/member requests to the new admin resource API returned 401/403.
- Live private-storage upload/signed-download check passed; the test object was removed.
- Live reads confirmed deployed announcement/category/notification schema availability.

## Applied SQL files

1. `supabase/migrations/20261029_announcements.sql`
2. `supabase/migrations/20261029_notification_delivery.sql`
3. `supabase/migrations/20261029_enable_schedulers.sql`

The server-only service key and local demo credential file remain ignored by Git.
No browser bundle should contain that key; the resource API reads it only on the server.
