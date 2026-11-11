# Phase 4 feature verification matrix

**PASS** means verified within the named local scope. **FAIL** means a demonstrated defect. **PARTIAL** means important behavior remains unverified. **NOT TESTED** means no execution or adequate evidence. Severity reflects the business impact of a failed or unverified control. Evidence is static source, synthetic browser, mocked handler, or isolated SQL. Deployed coverage is recorded separately in [test results](PHASE4_TEST_RESULTS.md).

## Architecture and dependency map

Both `src/app/admin/[section]/page.tsx` and `src/app/super-admin/[section]/page.tsx` import the matching `src/app/(admin)` page. Unprefixed legacy pages use `src/app/(admin)/layout.tsx` to validate session and redirect to the actor’s role prefix. Section aliases are `members`/`all-accounts`, `communication`/ `notifications`, and `system-management`/ `documents`. Role layouts share `AdminPortalLayout`, `AdminAuthProvider`, `SecureAdminActionProvider`, and `LoginTransitionProvider`. The Admin route adds an explanatory read-only section. Client guards and role UI are presentation controls. The relevant data boundary is the Next API, Supabase policy, RPC, or Edge Function in each row.

| Page family and shared UI | Data flow and storage | Permission boundary and failure behavior |
|---|---|---|
| Dashboard · `useDashboardData`, metrics, charts, `RecentApplications` | Dashboard readers page `loan_applications` and retrieve account/finance summaries. Exact detail selected by application ID. | Admin/Super Admin read. Charts and detail distinguish unavailable values. Browser and dashboard model/data tests. |
| All Accounts · member toolbar/table/form/details, secure confirmation context | Account listing uses `src/lib/adminAccounts.ts` and `list-admin-accounts`. The portal function forwards to the sibling backend source. Secure actions use a separate function. Auth users and member profiles are distinct records. | Admin read-only, Super Admin actions. Sibling listing/RLS migrations and Edge trusted role check. Active form relies on preview, verify and execute contracts. |
| Loan Applications · toolbar/table, `RecordsView` details, secure actions | `src/lib/api.ts` reads `loan_applications`, Realtime refreshes the list. Attachments use `loan-documents`. Review/approval use Edge, release uses a separate RPC. | Admin reads/details/export, Super Admin protected mutations. Sibling migration 023 limits approval writes. Errors shown by the page/action provider. |
| Active Loans · `RecordsView`, `CounterPaymentDialog` | Resource API allowlist, loan/payment readers, SQL quote/record/reversal. | Read for both roles, payment write/reversal Super Admin via SQL checks. Active selector accepts released/overdue states. Error/empty distinctions and SQL tests. |
| Notifications · composer/history plus independent navbar inbox | Outgoing Next `/api/admin/notifications` uses outbox and member delivery records. Incoming per-user `notifications` reads and marks read. `SuperAdminLoanAlerts` handles a private Realtime channel, inbox refreshes on events/visibility. | Super Admin or individually granted Admin can send. Scheduling remains Super Admin. Inbox RLS scopes each recipient. Handler, isolated SQL and mobile browser evidence. |
| Announcements · list, previews and editor | `announcements` state and optimistic update through Supabase. Scheduler publishes due rows. Sibling `member_announcements` is read by Flutter. | Both roles read, Super Admin writes. Stale editing tested locally. Deployed job and view linkage unverified. |
| Documents · resource UI and shared dialogs | Next resources route serves cooperative uploads and application attachments, requests private buckets and issues signed links. | Both roles read, upload/delete requires Super Admin or exact grant. Loan attachments excluded from cooperative deletion. Upload validation and failure probes. |
| Reports · `ReportWorkspace` | Supabase/resource readers and Manila date windows feed on-screen and downloadable summaries. | Both roles read and export allowed report data. Date/model tests, source for completeness and error behavior. |
| Audit Logs · `RecordsView` | Resources API allows activity log reads. Privileged writers and database routines populate events. | Both roles read, client table editing absent. Deployed log coverage, RLS and redaction unverified. |
| Settings · settings page, policy and roles tabs | Resources API persists general settings privately. Privileges route updates trusted Auth metadata. Loan policy calls protected verification/backend. | General settings by Super Admin or exact Admin grant. Privileges and loan policy Super Admin. Validation and synthetic routes exercised. |
| My Profile · profile page | `/api/admin/profile` uses live Auth user, password confirmation where required, trusted metadata and own profile. | Both roles access own profile. Super Admin email change only. Actual Auth mutation and resulting session behavior unverified. |

## Role and operation matrix

`admin` and `coop_admin` normalize to Admin. `super_admin` identifies Super Admin. Member Auth policies use `app_metadata.role = 'member'` in sibling migration 016. Member classification is a separate concept from portal access. Supabase DB roles such as `authenticated` and `service_role` are transport/database identities. This table describes intended active contracts, subject to P4-01 through P4-09 and deployed verification.

| Operation | Super Admin | Admin | Member | Unauthenticated |
|---|---|---|---|---|
| Portal pages and protected data | Read | Read | Denied | Denied |
| Accounts list/details | Read | Read | Own profile via member policies | Denied |
| Create, edit roles, block, unblock, delete accounts | Protected verification | Denied | Denied | Denied |
| Approve/reject deletion requests | No active request-approval flow established. UI exposes protected direct deletion. | Denied | No verified request path | Denied |
| Loan applications, documents and CSV | Read/export | Read/export | Own authorized application/files only | Denied |
| Submit loan application with files | No member submit in portal | No member submit in portal | Own application through member RPC | Denied |
| Review, approve, release | Protected actions | Denied | Denied | Denied |
| Reject loan | Sibling protected handler. Active portal control absent. | Denied | Denied | Denied |
| Record/reverse counter payments | Protected SQL | Denied | No portal write | Denied |
| Received notifications and read status | Own | Own | Own through member app | Denied |
| Send / schedule outgoing member notices | Send and schedule | Send with `notifications.send`. Scheduling denied. | Denied | Denied |
| Announcements | Read, create, edit, publish, archive | Read | Published member view | Denied |
| Cooperative documents | Read, upload, delete | Read. Exact `documents.upload` / `documents.delete` grants for writes. | No portal document access | Denied |
| Reports and audit | Read and supported exports | Read and supported exports | Denied | Denied |
| Settings | General and loan policy, role grants | General read. `settings.manage` for allowed general writes. | Denied | Denied |
| Own profile | Own read/edit, password and email flows | Own read/edit and password flows. Email change restricted. | Separate member profile policies | Denied |

## Functional verification

| Module | Feature | Expected | Observed | Status | Severity | Evidence | Recommended action |
|---|---|---|---|---|---|---|---|
| Auth | Both role sign-ins and loading | Correct dashboard after valid auth | Both synthetic redirects and resource handoff succeeded | PASS | High | Chromium handoff | Retest live in isolated staging |
| Auth | Bad password, member, blocked/inactive and network | Remain on login, no protected dashboard | Synthetic invalid, member, inactive and network responses denied | PASS | High | Chromium handoff | Verify live blocked/revoked sessions |
| Auth | Timeout/expired session | Recover without indefinite overlay | Fixture expiry, network and slow-route recovery passed | PASS | High | Chromium handoff | Retest with real session invalidation |
| Auth | Refresh, logout, browser Back and persistence | Protected data disappears when session ends | Both role fixtures passed refresh, wrong-role navigation, logout, Back and direct-route checks | PASS | High | Chromium session probe | Retest live token revocation and blocking of a signed-in account |
| Auth | Recovery | Secure account recovery with validated redirect | No active Admin recovery route established. Legacy reset modal is unused. | NOT TESTED | High | Login and reset modal call sites | Establish verified recovery procedure |
| Access | Direct protected API and forged role | No unauthorized record read/write | Isolated resources, notification, privilege and profile tests exercised denials. Deployed RLS unverified. | PASS | High | Handler tests | Run direct-route and DB staging denials |
| Access | Privileged Edge grant and actor | Trusted active role, scoped durable single use | Development fallback admitted blocked mock, changed action/target accepted | FAIL | Critical | P4-01 | Verify deployed identity and contain |
| Dashboard | KPIs, dates, charts, exact application details | Correct values and associated record | Models, tooltip and exact recent-record fixture passed | PASS | Medium | Dashboard tests, Chromium | Reconcile with seeded staging data |
| Accounts | Search, role/status filters and pagination | Accurate views and view-only Admin | Local browser interactions passed | PASS | Medium | Accounts toolbar fixture | Test with more than one backend result page |
| Accounts | Create/edit/role/block/unblock/reset | Real authorized state and truthful result | Portal create branch reported success with no writes. Sibling writes differ. | FAIL | High | P4-03 | Contract-test the authoritative function |
| Accounts | Deletion approval workflow | Verify acting role and documented approval | Direct protected delete is wired. Separate request/approval lifecycle unverified. | PARTIAL | High | Members page and sibling Edge | Confirm intended approval policy and test Auth/profile effects |
| Loan applications | Member submission, file ownership, duplicate policy | Own loan and required attachments only | Flutter and SQL contract traced. Device and actual uploads untested. | PARTIAL | High | Sibling migrations 016–026 | Test two member identities in staging |
| Loan applications | Search, filters, sort, pagination and CSV | Correct filtered result and export | Synthetic interactions and CSV passed. Large/capped exports remain unverified. | PASS | Medium | Loan toolbar fixture | Exercise server caps and reconciled export |
| Loan applications | Review/approve | Required checks and guarded write | UI actions identified. Portal Edge lacks these handlers. Sibling has distinct handlers. | FAIL | High | P4-03 | Resolve deployment and verify state/audit |
| Loan applications | Rejection | Authorized rejection with proper persisted state | Sibling handler exists. No action in active table. | PARTIAL | High | P4-04, lifecycle | Confirm intended exposure, policy and audit |
| Release | Commit/replay and stale principal | Guarded release, one result per request | Isolated SQL checked release and retry. Browser reviewed preview only. | PASS | High | Release suite, Phase 3 fixture | Verify concurrent release and reconciliation |
| Release | Reviewed policy consistency | Exact reviewed charges committed | An isolated release committed the new fee after policy changed while principal stayed constant | FAIL | High | P4-05 | Bind confirmation to the full reviewed quote |
| Active Loans | Released and dated classification | Exclude malformed, unreleased and completed records | Undated released fixture was included | FAIL | Medium | P4-07 | Enforce and reconcile classification |
| Payments | Positive amounts, partial/overpayment, retries and reversal | Preserve reviewed allocation and balances | Isolated automatic and legacy suites plus minimum/invalid probes passed their expected assertions | PASS | High | SQL and audit probe | Verify multi-session races and receipts |
| Payments | Direct writes and review binding | All authenticated receipts use reviewed allocation | Legacy SQL accepted allocation rejected by reviewed RPC | FAIL | High | P4-02 | Restrict execution to reviewed path |
| Payments | Live cash posting, completion and reconciliation | Correct balances, traceability and closed-state behavior | No real cash transaction tested. No automatic completion established for audited receipt path. | NOT TESTED | High | Lifecycle | Use isolated ledger and explicit completion acceptance criteria |
| Notifications | Incoming ownership, read/unread and mobile popover | Per-recipient state, usable inbox | Source scopes operations to user. Browser showed compact mobile wrapping. | PARTIAL | High | Inbox and notification tests | Verify two-user live read isolation and reconnect |
| Notifications | Outgoing target, scheduling, idempotency | Respect privileges and avoid duplicate delivery | Mock handler suite passed. Legacy route separately returned false success. | PARTIAL | High | Next handler tests, P4-03 | Verify route identity, schedule and staged delivery |
| Notifications | Member receipt and private loan alert | Correct recipients, no cross-account exposure | Isolated private alert SQL passed. Device delivery and Realtime transport untested. | PARTIAL | High | Loan submission alert suite | Test staged subscriptions with two accounts |
| Announcements | Draft, publish, schedule, archive and edit conflicts | Only eligible member-visible records and safe updates | Isolated SQL passed. Applied jobs and Flutter view not verified. | PARTIAL | Medium | Announcements SQL, sibling migration 024 | Verify job/view on staging deployment |
| Documents | Read, URL, delete and traversal | Private links, authorized operation, scoped paths | Mock API exercised authorization, scoped paths and signed response | PASS | High | Resources route tests | Verify effective bucket grants and signed expiry |
| Documents | Upload content | Actual payload matches allowed type | Text bytes presented as PDF were accepted | FAIL | Medium | P4-06 | Validate contents and audit mutations |
| Reports | Period boundaries, currency and complete exports | Complete date-correct financial records | Source/model and local route reviewed. Capped data probe truncated results. | PARTIAL | High | P4-07 | Compare records, totals and exports at scale |
| Audit Logs | Complete immutable event and actor trail | Reliable records for protected actions | Source and synthetic page verified. Effective immutability and completeness untested. | PARTIAL | High | P4-08, SQL tests | Compare mutations, audit IDs and denial tests |
| Settings | General configuration and individual privileges | Validated write by exact role/grant | Isolated resource/privilege checks passed. Simultaneous edits and deployment untested. | PASS | High | Handler tests | Test concurrent changes and revoke/reload |
| Settings | Loan policy | Protected save, durable history, coherent quote | Sibling policy confirmation contract reviewed | PARTIAL | High | Sibling migrations 019, 021, 022, P4-05 | Test policy rollback and stale release |
| Profile | Own account, password/email restrictions | Own profile only, role restrictions, Auth persistence | Handler checks and browser route ran. Live changes and recovery untested. | PARTIAL | High | Profile tests and API | Test real staged Auth confirmations |
| Reliability | Layout, empty/error, focus and retry | Stable shared shell with actionable feedback | All role routes at five sizes, scoped keyboard and error scenarios passed. Whole-page outage matrix untested. | PARTIAL | Medium | Chromium suites | Run staged outage and slow-network cases |
| Deployment | Effective grants, RLS, storage, secrets and advisories | Deployed artifacts match reviewed controls | No deployed manifest, live policies or credential rotation evidence | NOT TESTED | High | P4-01, P4-06, P4-09 | Supply redacted staging and release evidence |
