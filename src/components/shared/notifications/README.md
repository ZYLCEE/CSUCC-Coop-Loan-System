# Administrator notification inbox and member messages

## Files

- `../Navbar.tsx`: replaces the bell's page navigation with the popover, removes
  only the redundant header logout control, and keeps the bell/profile usable at
  small widths. The sidebar logout and authentication code are unchanged.
- `NotificationPopover.tsx`: recent dropdown and in-place expanded notification
  center, keyboard/outside dismissal, search, filters and persisted read controls.
- `useNotificationInbox.ts`: recipient-scoped request lifecycle, pagination,
  refresh-on-open, persisted actions and stale-response protection.
- `src/lib/adminNotifications.ts`: existing Supabase table operations, record and
  session validation, exact unread counts, relative times and safe destinations.
- `src/lib/adminNotifications.test.mjs`: data access, privacy and read-action tests.
- `src/components/notifications/SendNotificationCard.tsx`: outgoing composer,
  connected mobile draft preview and the existing protected send/schedule flow.
- `src/components/notifications/NotificationHistoryCard.tsx` and
  `src/lib/memberNotifications.ts`: separate outgoing history, search, status
  filters, pagination and unavailable states.
- `src/app/(admin)/notifications/page.tsx`: member-notification composition and
  history layout, with a history refresh after protected requests complete.
- `src/lib/memberNotifications.test.mjs`: outgoing contracts and isolation tests.

## Existing backend capabilities reused

The `public.notifications` table in migration 004 already has `id`, `user_id`,
`title`, `message`, `type`, `read` and `created_at`. Migration 016 grants existing
authenticated reads and updates to the `read` column. Own-notification RLS exists,
but migration 005 also adds a permissive admin SELECT policy. Every inbox query
and write filters `user_id` to the current authenticated administrator.
Returned records for another user or an unassigned recipient fail validation.
No service-role credential is used in the frontend.

The bell fetches an exact unread count on mount. Opening the panel refreshes the
latest records and count without marking anything read. Lists use 20-row pages,
newest first, and Load more. Explicit read actions update only `read` and refresh
from the backend; they never optimistically pretend an unsuccessful write worked.
Mark all applies to all of that recipient's unread records, including records
outside the visible page. Failed or unavailable data is not displayed as zero.

View All Notifications opens a 620px notification center on the current page,
with an 80%-viewport height, internal scrolling and mobile viewport bounds. Search
queries titles/messages on the server; All/Unread/Read and category filters apply
to the complete paginated history. The unread badge always counts all incoming
unread alerts, independently of search/category/read filters. Loan Applications
maps only to existing `loan_approval`/`loan_rejection` types, and Payments only to
`payment_reminder`. Generic severity types do not reliably identify member,
document or system-event categories, so those filters are not fabricated.

The member page uses live member records for All Members and Specific Member
selection. The existing secure-action provider retains password verification,
confirmation and Super Admin write permissions. Scheduling validates a future
local time before sending the existing payload. Active Loan Members and Selected
Members stay visibly unavailable because no working recipient contract was
verified. Draft text updates the mobile preview without sending anything.

Outgoing history queries only null-recipient rows with outgoing `send_to`
metadata, using the fields already written by the legacy protected sender. It
never queries personal incoming rows. Only Super Admin requests outgoing history,
consistent with existing protected communication permissions; the Admin page
keeps its existing read-only restriction. Sent/Scheduled/Failed are stored service
statuses, not inferred from a successful request. Send responses refresh history
but never insert client-created receipts. The draft is retained after a response.

## Delivery gaps requiring backend work

No schema, RLS policy, endpoint, Edge Function, authentication or event workflow
was changed for this UI feature.

- The checked-in realtime publication configuration enables loan/member tables,
  not notifications. The popover therefore uses refresh-on-open rather than
  claiming live delivery. Enabling notifications realtime would require a
  separately reviewed deployment/configuration change.
- There is no verified automatic fan-out from loan submissions/updates, member
  verification, repayments, overdue events or system alerts to authorized Admin
  and Super Admin recipients. Trusted backend event handlers must persist one
  notification per authorized recipient `user_id`, applying existing roles and
  responsibility rules. The frontend cannot infer those assignments or safely
  reuse member notifications as administrator alerts.
- Unassigned/broadcast rows are not a verified administrator audience. Global
  system alerts need authorized per-recipient delivery (and independent read
  state), or a separately designed audience/access model. They are not exposed
  by widening client queries to every notification an admin policy can read.
- Current notification rows have no related application/member/payment ID or
  structured destination. Known loan-decision types open the existing Loan
  Applications page, payment reminders open Active Loans, and other types stay
  in the incoming notification center. Exact-record links require
  server-provided, authorized entity references and an existing details route.
- The broad admin SELECT policy must be reviewed/tightened in the backend to
  guarantee recipient-only database access independently of client queries.
  Client predicates and returned-row validation protect this UI, but cannot
  replace database authorization. No claim is made that the broader policy was
  removed or that live deployed role policies were verified.
- The canonical sibling backend secure-action handler does not list notification
  send/schedule actions. The legacy frontend copy does, but attempts to write
  outgoing columns absent from migration 004 and can report success after insert
  failure. No verified scheduler, delivery ledger, idempotent dispatch or
  per-member fan-out was found. The service must persist real outgoing records
  and delivery outcomes, reject failed writes and actually process scheduled jobs.
- If legacy outgoing metadata is not deployed, outgoing history displays an
  unavailable state and Retry rather than treating incoming rows as sent
  campaigns or reporting an unverified zero. No migration is auto-installed.

If the remote deployment lacks the existing table, grants or policies, the panel
shows an error and Retry. It does not install migrations or change permissions.
Alerts appear only when actual recipient-addressed records exist in that project.

## Validation

Run `node --test src/lib/adminNotifications.test.mjs src/lib/memberNotifications.test.mjs`
for recipient/outgoing isolation, session checks, counts, search/filter predicates,
pagination, unavailable data, read persistence/denial and safe destinations.
Browser checks use intercepted test responses and isolated sessions, not live
database writes. They exercise popup interactions, keyboard access, individual and
bulk read state across reloads, role isolation, unauthorized records, error/empty
states and viewport bounds down to 320px. Expanded-center checks also cover
in-place View All, complete-history search/read/category filters, global badge
counts and Admin/Super Admin isolation. Member-page checks use intercepted
outgoing records, live-draft preview changes, schedule validation and the existing
secure send confirmation; they do not send real messages or verify live delivery.

Changed-file ESLint and the frontend TypeScript check pass. The full project
TypeScript/build check still includes the existing Deno Edge Function sources,
whose HTTPS imports and Deno globals fail the Next.js type check. No unrelated
compiler configuration was changed. Full-project lint also reports existing
errors in `src/components/audit-logs/AuditRow.tsx` and
`src/components/reports/AreaChart.tsx`; these unrelated components were not edited.
