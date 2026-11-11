# Role-specific activity notifications

Notifications now opens an **Activity inbox** for incoming operational updates. **Send to members** and **Sent messages** remain separate and appear only with the existing sending privilege. **Demonstration** shows manually recorded sample committee actions from this browser and never represents them as live loan notifications.

## Events

| Source | Recorded alerts |
| --- | --- |
| Member/account records | New accounts, pending approval, activation/status changes, profile/role/membership changes and removal |
| Loan applications | New requests, review/status transitions, changed application terms, release, overdue and completion |
| Verification | Recorded verification actions and requirements returns |
| Committee review | Every individual approval/rejection, clarification, recusal, forwarding, reassignment, reply, reopening and final decision |
| Documents | Member uploads, replacement versions, review outcomes and cooperative library changes |
| Consent evidence | Recording and invalidation of borrower, co-maker or witness evidence |
| Payments | Posted payments and reversals |
| Announcements | Recorded creation/status/title changes |
| Other trusted audit actions | Account management, workflow configuration, settings and other recorded system actions; raw audit details are never copied |

The workflow's existing personal final-decision and reviewer-assignment notices remain. Final committee decisions use the explicit final-review event instead of duplicating that staff alert from the underlying loan status update. Known corresponding audit entries are skipped where row/workflow events already provide the notice. Notification reads do not create notifications or new activity events.

## Recipients and permissions

- Active Admin and Super Admin accounts receive operational updates. Ordinary Admin does not need notification-sending privileges to read its incoming inbox.
- System-management and sensitive security/account-management audit alerts go to Super Admin. Blocked/inactive staff do not receive new activity alerts.
- Members receive their own relevant application, document, consent, payment and account notices. Their versions exclude internal staff actor details and private notes.
- Active reviewers receive notices for their own assigned cases, with assignment links. Their portal inbox and bell refresh when recipient notifications change.
- Each delivered notice has an independent recipient/read state. Even a legacy broad Admin SELECT policy cannot expose another recipient's inbox rows.
- Browser accounts can select their authorized notices and update only `read`. They cannot rewrite titles/messages, insert notices or call the event publishing helper.

## Persistence and updates

New activity is captured by trusted database triggers in the same transaction as the action. Failed or rolled-back actions do not create successful activity alerts. The immutable `portal_activity_events` ledger preserves the event independently of a notification being marked read. Source keys and the event/recipient unique index prevent duplicate fan-out on retries.

The deployed migrations do not replay old actions, fabricate historical approvals or alter accounts, loan decisions, amounts or payment balances. Existing old notices remain available, with legacy unclassified notices under **Other**.

The `notifications` table is added to the Realtime publication. Admin and committee clients subscribe only to INSERT/UPDATE events filtered by the current recipient; existing RLS still applies. The Admin bell/inbox also uses foreground/online refresh and a 30-second recovery poll. The member Flutter notification screen uses the same recipient filter, foreground refresh, debouncing and cleanup. See the [Supabase Postgres Changes documentation](https://supabase.com/docs/guides/realtime/postgres-changes) for publication and RLS behavior.

The main inbox supports search, read/category filters, newest/oldest order, page size, numbered pages, individual/bulk read actions, Philippine date/time, actor labels and links to related portal sections. It does not accept arbitrary destinations supplied through notification JSON.

## Files and deployment

Deployed migrations, synchronized with the sibling backend repository:

- `20261111_portal_activity_notifications.sql`
- `20261111_portal_consent_notifications.sql`
- `20261111_notification_read_permissions.sql`

The last migration corrects older table-wide UPDATE grants: granting UPDATE(read) alone did not remove the older ability to edit notification text. The corrected deployment permits read/unread updates only.

Member app change: `C:/Users/zylcee/Desktop/COOP/coop_frontend_client/lib/bellicon.dart`. Existing member database methods already update only `read` and remain compatible with the narrowed permissions.

## Checks

- `scripts/prepare-portal-activity-sql-test.mjs` builds a synthetic integration transaction ending in ROLLBACK. It runs the existing four-position committee workflow plus account, loan, document, consent, payment, announcement and system alerts; blocked recipients; source idempotency; immutable history; forged-write rejection; and recipient RLS, including a simulated old broad Admin-read policy.
- 48 Node tests passed across notification access, realtime filters/cleanup, outgoing contracts, independent demo read state, reviewer account security and review APIs.
- `COOP_ACTIVITY_QA=1 node scripts/action-dialogs.test.mjs` tests the real inbox components with isolated fixtures: category/search filters, repeated search, numbered pagination, individual/bulk read, simulated realtime insertion, safe links, ordinary Admin read access and mobile bounds. Browser images are fictional fixtures.
- Existing committee browser regression tests, TypeScript, targeted ESLint and optimized Next.js build passed.
- The member notification screen is formatted and checked with the installed Flutter analyzer. Live service delivery is configured and the publication/permissions are verified; SQL tests roll back and the browser realtime test is simulated, avoiding test messages to real recipients.
- `verify-deployment.sql` reads live configuration and authenticated Admin listing behavior without exposing personal messages.

The original four preconfigured demonstration accounts remain isolated from live database actions. Their sample review activity is visible in **Notifications → Demonstration**, and their own sample inboxes have separate read state for each identity.
