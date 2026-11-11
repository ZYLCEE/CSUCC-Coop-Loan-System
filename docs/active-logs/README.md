# Active Logs

Implemented in the existing Next.js 16 / React 19 / TypeScript / Tailwind / Supabase stack. The Church Management reference supplies the filter, table, badge, and pagination layout; no PHP runtime or Church authentication is copied.

## Review

- Super Admin: `/super-admin/active-logs`
- Admin: `/admin/active-logs`
- CRECOM: `/crecom/active-logs`
- BOD: `/bod/active-logs`
- Member Flutter app: drawer → Active Logs.
- Existing `audit-logs` page bookmarks still open this workspace.
- The legacy audit resource endpoint redirects to the scoped Active Logs API.

The table has the nine reference columns: ID Number, Name, Role, Action, Browser / OS, Time In, Time Out, IP Address, and Details. Search, role, inclusive Philippine date filters, and 10/25/50-row pagination run on the server. Narrow screens scroll the table horizontally.

## What is recorded

Successful entry to an authorized staff or member portal creates one Login record per genuine Supabase Auth session. Completed internal operations are captured using an explicit action allowlist, including account management, profile changes, document operations, requirements verification, committee review, final decisions, release, payments, policies, notifications, and announcement changes. Member loan submissions, application updates, profile changes, document uploads/replacements, and consent submissions are captured from committed feature events in the member's own admitted session.

Failed requests, password checks, grants, pre-authorization events, cancelled operations, unknown action names, demo sessions, background jobs, and activity without an admitted staff session are excluded. A successfully recorded application rejection, payment reversal, or account block is a completed business action and remains visible.

Existing raw audit history is retained. No old activity is backfilled with invented browser, device, session, or IP information. New collection starts when a real authorized user enters the updated portal. Unavailable metadata is shown as a dash. Passwords, raw access tokens, and raw action grants are not written to these tables.

## Sessions and updates

The server verifies the bearer token and portal admission before creating or touching a session. Identity and role come from the authenticated account; device details come from the request. Proxy IP headers are trusted only on Vercel or when `COOP_TRUST_PROXY_HEADERS=true` is configured behind a trusted proxy.

Trusted user interactions extend the 15-minute inactivity period. Reloads and background checks do not extend it. Explicit logout closes the current session; account, membership, role, and Auth-session revocation hooks close affected sessions. Idle closure is computed from the stored expiry even when the browser has gone away. Expired sessions require signing in again.

Supabase Realtime watches log inserts and session changes. A 15-second polling fallback and focus/reconnect refresh keep expiry and connection recovery current. Filters and pagination survive updates. Missing or denied backend access returns an error instead of a fabricated empty page or untracked session.

## Authorization and persistence

Both new tables have RLS. The same visibility rule applies to direct table reads, Realtime, and the paginated reader:

| Viewer | Visible activity |
| --- | --- |
| Super Admin | Super Admin, Admin, Member, CRECOM, BOD |
| Admin | Admin, Member, CRECOM, BOD |
| Member | Own account only |
| CRECOM | Own account only |
| BOD | Own account only |

Role filters cannot widen this scope. Member and reviewer privacy is based on the authenticated actor UUID, so other people holding the same role remain hidden. Inactive accounts and memberships cannot read logs. Clients cannot insert, update, or delete log rows. Activity entries are immutable. General session and receipt writers remain executable only by the service role. The member-only session RPC derives the actor and session ID from the caller's JWT, verifies active member admission and a genuine Auth session, and accepts no actor override. Stable audit IDs and hashed execution receipts prevent duplicates.

The shared account presentation module supplies badges to All Accounts, Committee Accounts, and Active Logs: Super Admin gold, Admin blue, Member green, CRECOM purple, and BOD teal. Legacy numeric IDs display as `CSUCC-YYYY-NNNN`, matching current account creation; already prefixed IDs stay unchanged. Missing IDs remain a dash. Stored IDs and operation targets are not rewritten.

The existing hosted `secure-admin-action` function retains its password, grant, privilege, and execution rules. The authenticated Next.js proxy records only its confirmed successful execution response. It stores a SHA-256 receipt of the grant, not the grant. A logging error after a committed operation is reported as a warning without misreporting the completed operation as failed.

## Database installation and validation

`supabase/migrations/20261111200000_portal_active_logs.sql` was applied to the connected COOP database on November 11, 2026. Both tables, their RLS policies, service-only writer privileges, and Realtime publication membership were verified after installation. Installation left the new session and entry tables empty; synthetic validation rows were rolled back.

The follow-up `20261111213000_active_log_role_visibility.sql` was also applied on November 11. `role-visibility-rollback.sql` tested all five reader/RLS scopes, isolation between two actors with the same role, canonical ID display, member completed-event capture, unknown-event exclusion, and private writer privileges. Synthetic rows were rolled back and their absence was verified after deployment.

The member integration lives in the existing sibling `coop_frontend_client` Flutter project. Its drawer entry, responsive own-activity screen, Realtime subscription/polling, tracked portal entry, real-interaction heartbeat, expiry handling, and explicit signout use Supabase directly with the member's JWT. Native device IP is unavailable in this RPC path and remains a dash. Restart/rebuild the member app to include the new Dart code. Prepared source and pre-edit backups are retained under `member-client/` for review.

Before installation, `scripts/prepare-active-logs-sql-test.mjs` generated `rollback-validation.sql`. Its transaction checked successful-only capture, session attribution, immutable entries, duplicate prevention, receipt retries, expired-session exclusion, role/search pagination, and access privileges without changing real accounts or loan records.

Validation also covered:

- Active Logs API/filter/session/protected-action unit checks.
- Existing profile, privileges, notification, committee, and application-workflow API regressions.
- Browser checks for nine columns, roles, Philippine date filters, pagination, live inserts, session closure, preserved filters, error retry, and mobile overflow.
- Existing five-step application-processing and protected-action dialog browser regressions.
- TypeScript, production build, and targeted ESLint checks.
- Five member activity tests, including near-expiry interaction, no idle extension from background checks, expiry, signout/retry, old-session response isolation, and the responsive own-activity screen; existing member login and quick-access regressions also passed.
- Clean static analysis of the new Flutter files and a standard Flutter web build.

The screenshots in `screenshots/` use synthetic browser fixtures only. Those names and actions were never added to the live database.
