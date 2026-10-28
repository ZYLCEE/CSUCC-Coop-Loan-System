# Announcement management

## Implemented source

- `src/app/(admin)/announcements/page.tsx`: full-width toolbar, debounced server
  title/content search, preserved status filters, ten-record pages, cards, details,
  confirmed archive/restore/cancel/delete actions and real loading/error states.
- `AnnouncementsData.tsx`: persisted models, status labels, title/content limits,
  and explicit Asia/Manila schedule conversion/validation.
- `AnnouncementCard.tsx`, `AnnouncementBadge.tsx`, `Announcements.module.css`:
  compact cards and scoped styling. No global dashboard/header styles changed.
- `AnnouncementDialog.tsx`: viewport-bounded modal, internal scrolling, focus
  containment, Escape dismissal, focus restoration and unsaved-change protection
  through the editor.
- `AnnouncementEditor.tsx`, `AnnouncementPreview.tsx`: two-column form and live
  member-app preview, drafts/publishing/scheduling, publication confirmation and
  optional member-notification intent. Preview keystrokes do not make requests.
- `src/lib/announcements.ts`: authenticated queries, stored category definitions,
  service-capability checks, optimistic-concurrency versions and persisted RPC
  actions. Successful responses trigger a refetch; no client-created records or
  fake successes are inserted into the list.
- Sibling backend `supabase/migrations/024_announcement_management.sql`: announcement/category
  tables, RLS, safe member view, write RPC, scheduler entry point, audit events
  and idempotent publication notification receipts.
- `src/lib/announcements.test.mjs`: data/query/validation tests.
- `supabase/tests/announcements.test.mjs`: real migration and permission/state
  tests in an isolated PostgreSQL runtime, independent of any deployed database.
- Sibling member app `lib/announcements_screen.dart`: paginated published feed,
  refresh/retry, details and a visibility recheck before opening a record.
- Sibling member app `lib/drawer_menu.dart`: one Announcements entry for that
  feed. The Admin sidebar, top bell and Member Notifications page are unchanged.

The checked-in starting page used an empty local array. No announcement schema,
API or mobile feed existed. The user explicitly requested preparation of the
missing backend integration. These source files have **not** been applied to a
remote database. Until deployed, the page correctly reports service unavailable;
draft text can be previewed, but cannot be falsely reported as saved.

## Deployment

1. Review the new migration and apply it to the same Supabase project used by both
   applications, after the existing migrations through 023. It depends on the
   existing `members`, `notifications`, and `admin_activity_logs` contracts. It
   does not alter those tables, existing role definitions or their RLS policies.
   The tested migration is in the canonical sibling backend migration directory;
   there is no duplicate frontend migration to apply.
2. If Supabase Cron is enabled when the migration runs, it installs one named job
   `csucc_mpc_publish_announcements`, once per minute. Otherwise scheduling stays
   disabled in both the service and UI. After enabling Cron, configure:

   ```sql
   select cron.schedule(
     'csucc_mpc_publish_announcements',
     '* * * * *',
     'SELECT public.publish_due_announcements();'
   );
   ```

   See the official [Supabase Cron guide](https://supabase.com/docs/guides/cron/quickstart).
   The UI checks the configured job; this is not a guarantee of scheduler health.
   Monitor job history. Publication can occur on the next minute tick, not at the
   exact second entered by the administrator. The worker processes up to 50 due
   announcements per invocation.
3. Refresh the web page after deployment. Categories come from the database, and
   scheduling/notification options come from `announcement_service_status()`.
4. Build/run the member app with its new feed/menu entry. Both clients must use
   the same Supabase project. No service-role credentials belong in either app.

## Permissions and visibility

Existing Admin read-only page restrictions remain intact. The database permits
active Admin/Coop Admin reads and active Super Admin management, using current
server-side user metadata and membership state. Direct authenticated table writes
are denied; `manage_announcement` validates the role, fields, legal transition and
exact `updated_at` version before writing. It logs successful management actions
to the existing `admin_activity_logs`, and records feature/system events in
`announcement_events`.

Active members can read only published records with publication dates already
reached. Drafts, schedules and archives are protected by RLS, including direct
base-table queries. The member view uses `security_invoker` so its owner does not
bypass the caller's RLS. See [PostgreSQL view security](https://www.postgresql.org/docs/15/sql-createview.html).
Archiving removes visibility immediately. Restoring creates a private draft.
Only never-published drafts may be permanently deleted. Scheduling is converted
from Philippine local time to UTC; displays also use Asia/Manila. A scheduled
author who becomes inactive, loses Super Admin authorization or is deleted cannot
silently publish later: the worker returns the announcement to a private draft.

## Member notifications and remaining limitations

Notify Members is off for drafts and immutable while editing a published record.
Publication confirmation explicitly includes the notification action. The
publication transaction inserts actual `info` records in the existing member
`notifications` inbox table for active, linked Member accounts only. Each includes
an announcement reference. Unique per-announcement/per-user receipts prevent
duplicates on retries, edits, worker reruns and republication to previous
recipients. A notification insert failure rolls back both publication and its
receipts. Nothing is sent when merely composing, previewing or saving a schedule.

This reuses the persisted inbox infrastructure, not the legacy outgoing campaign
handler that could report success after a failed insert. The existing mobile
notification screen still has its own empty local data source; its ingestion and
push delivery are separate unfinished infrastructure. They were not redesigned
or presented as verified here. Members can revisit published announcements via
the new feed. The announcement reference is not an invented deep-link route.

Cover uploads remain unavailable. Enabling them requires validated image byte
content/type/size, protected storage, draft-safe object access, persisted cover
references, authorized preview reads and cleanup. No arbitrary URLs or unvalidated
files are accepted. Recommended category definitions are seeded as metadata;
there are no sample announcement or financial records.

## Validation

`node --test src/lib/announcements.test.mjs` runs the eight data-access/model tests.
For the isolated SQL test, supply an externally installed PGlite module through
`ANNOUNCEMENT_PG_MODULE` and run `node supabase/tests/announcements.test.mjs`.
The test creates an in-memory database and compatible prerequisite fixtures; it
does not connect to Supabase. No application dependency was installed for it.

Browser checks use intercepted APIs and isolated sessions, with no real messages
or announcements. They cover search/filter/pagination, live preview, persisted
request contracts, confirmation, stale-version requests, publish/edit/archive/
restore/schedule/cancel/delete, unavailable vs empty data, scheduler gating and
viewport overflow at 1440, 1024, 390 and 320px. The SQL tests exercise the actual
migration, RLS, active/inactive roles, write restrictions, read visibility,
notification deduplication and rollback, due jobs and audit records. The actual
Supabase Cron extension and remote deployment still require deployment checks.

Announcement-specific ESLint, frontend TypeScript, eight model/data-access tests,
ten isolated SQL check groups, the browser checks and targeted Flutter analysis
pass. The production bundle compiles, but the full build stops at the existing
Deno HTTPS import in the sibling backend's `list-admin-accounts/index.ts`, which
is included by the current frontend TypeScript configuration. Full-project lint
still reports existing AuditRow/Reports errors. Those unrelated files and the
compiler configuration were left unchanged.
