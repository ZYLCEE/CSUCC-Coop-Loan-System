# Secure Loan Application Rejection — implementation report

November 10, 2026. **Implemented and tested locally; not deployed.** The action deliberately remains hidden against a backend that does not advertise the new secure-rejection contract. No live loan decisions, SQL migrations, role changes, notifications, account operations or deployments were executed. Existing working-tree edits were preserved.

## Existing backend and validated policy

The authoritative sibling backend already contained `reject-loan` in `coop_backend/supabase/edge-functions/secure-admin-action/index.ts`. Its existing condition permitted **Pending and Under Review**, and the dispatcher required an **active Super Admin**, real account-password verification and a persistent, short-lived, single-use grant bound to actor/action/application/request fingerprint. Ordinary Admins have no delegated loan-decision privilege in the existing permission catalog.

That branch previously performed a conditional status update followed by a separate audit insert. It did not require or save a reason, save a rejection timestamp/name for detail display, or atomically commit the decision, audit and member notification. The frontend action menu did not expose it. The separate Edge Function source checked into the admin repository is an older implementation without loan-decision support; it was not treated as the authoritative rejection implementation or replaced wholesale.

| Current status | New rejection action |
|---|---|
| Pending | Allowed for active Super Admin after existing password/grant flow; supported by the existing backend policy |
| Under Review | Allowed under the same authority |
| Approved, Rejected, Released, Completed, Overdue | Denied on the server; hidden in the menu |

| Identity / access | Decision authority | Private rejection details |
|---|---|---|
| Active Super Admin | Yes, with matching security grant and eligible current application | Yes |
| Active Admin / coop_admin | No; no new delegation privilege introduced | Yes, through the restricted administrative read RPC |
| Member / unauthenticated / blocked or inactive administrator | No | No |

Existing approval behavior, including its existing Pending/Under Review eligibility, was preserved. This change does not force a new review stage or reverse an approval.

## Implemented UI

Eligible menus now present View Details, View Documents, existing review/approval actions, and a red XCircle **Reject Application** action. Pending retains Move to Under Review; Approved retains Mark as Released. There is one rejection action, gated by read-only mode, trusted frontend role and a successful backend capability check. Those conditions do not replace server authorization.

The 540px shared FormDialog shows the actual application ID, applicant, loan type, formatted requested amount and current status. It uses the existing destructive button variant, status badge, translucent blurred backdrop, header/close control, scrollable body and visible footer. The required full-width textarea, inline errors and warning follow the Church reference's separated action layout. Initial visual inspection caught a narrow inline textarea; this was corrected and is now covered by width and label-position assertions.

Workflow: **reason → existing server password verification → existing final confirmation including reason and identity → server execution → existing result dialog**. The provider remains the workflow authority. Its changes are limited to the rejection icon/destructive presentation and an optional success-title field. Grant transport, password handling, role checks and callback semantics are unchanged.

Cancel or Escape never executes rejection. Dirty reason text invokes existing unsaved-change protection. Cancelling security verification returns to the preserved form. Password errors and failed execution preserve the reason. Submit locks synchronously before asynchronous work; the existing confirmation/provider locks prevent duplicate execution. Retries with unchanged reason retain their request ID, while the server requires a new valid security grant. Success and table refresh occur only after the protected response confirms success.

## Server safeguards, storage and privacy

The canonical Edge Function now routes `reject-loan` to the service-only transactional `reject_loan_application` RPC. A read-only capability mode returns protocol version, eligible statuses and reason limit only after the existing Super Admin checks and the database capability function succeed. Older functions or missing migrations cannot silently accept the new form through the old status-only branch.

The transaction:

1. Rechecks the established `is_active_secure_admin` authority.
2. Requires a trimmed, nonblank reason, request UUID and eligible expected status.
3. Locks the application row and compares its current status with the reviewed status.
4. Rejects applications with approval, release or completion dates even if their status is inconsistent.
5. Updates only status and update timestamp; principal and all financial values are untouched.
6. Records the immutable decision in the existing private `admin_activity_logs`, including reason, previous/current status, request ID and available administrator display name. The audit row's actual timestamp supplies rejection time.
7. Inserts a generic member inbox notification in the same transaction when a linked member Auth recipient exists.

An existing request returns its original decision without another mutation, successful audit or notification. Reusing it with different actor/application/reason/expected status is denied. A unique partial audit index also prevents cross-application request-ID reuse. Notification or audit failure rolls back the rejection. The Edge dispatcher skips its former separate success audit for this operation; existing failure auditing remains available. SQL errors are translated into safe permission, conflict, validation or generic failure messages rather than exposing database internals.

The new rejection API limits reasons to **2,000 characters**, consistent with the existing payment/release note limit convention. There was no prior rejection-reason field or bound to reuse. The bound is enforced by the new backend contract and matched by the UI; it does not add a loan policy or change a financial rule.

No rejection column or duplicate history table was added. Reasons remain in the existing private audit store because members already select whole application records. The read-only `loan_rejection_details` RPC returns only the recorded reason, rejection instant and available administrator name to active administrative identities; it does not grant direct audit-table access to members. The generic protected `update-loan-status` path is prevented from obtaining a grant for `status=rejected`, requiring the dedicated decision path instead. Other status actions were not redesigned.

## Rejected details and table integration

The curated shared LoanDetailsModal now loads actual private decision metadata only for Rejected records. Its **Rejection Information** section shows the reason, date/time in Asia/Manila and recorded administrator name when available. Existing application/applicant sections and red status badge remain. Release and payment metadata stay absent. Historical rejected records without stored reasons show an honest missing-information message; failed or denied metadata reads show an explicit error and retry action, rather than being treated as successful empty history.

On confirmed success the existing `onApplicationUpdated` refresh runs. The existing loan-application query includes `rejected`; the Rejected filter and normalized status contract are unchanged. No application is deleted, duplicated or removed from storage. A record can naturally leave a Pending/Under Review filter following refresh. Existing search/sort/pagination and real-time loading mechanisms were not changed.

## Mobile and notifications

The current `coop_frontend_client` Flutter service reads the same `loan_applications` records; its loans screen recognizes and filters `rejected`. Its notification screen loads the existing user-scoped `notifications` inbox. The new generic inbox row uses the existing `loan_rejection` type and `user_id/title/message/type/read` contract. It does not use an outbox, new endpoint, scheduler or external delivery service. Existing outbox triggers bypass user-addressed inbox inserts, avoiding duplicate fan-out.

No private reason, administrator identity or risk assessment is sent to a member. Member-visible reasons remain a product-policy decision requiring an explicit approved visibility rule. A member with no linked Auth recipient cannot receive an inbox row; the decision and audit can still be recorded. Existing tracking/notification UI observes the result on its normal next fetch/refresh. Neither Flutter project was modified, and no mobile runtime test was claimed. Existing eligibility rules for a later new application remain in force; no reconsideration/unreject feature was added.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed; optimized Next.js 16.2.12 build, 20 static pages and dynamic Admin/Super Admin routes |
| Source, handler and isolated PostgreSQL tests | 144 passed; full results in `tests-source.log` |
| Existing isolated shared-dialog regression suite | 11 passed: confirmations/cancel, grants/roles/errors, approval presentation, release acknowledgement/retry, payment validation/allocation, reversal reason/identity, nested focus and unsaved changes |
| Dedicated rejection UI harness | Passed: all security/result stages at three sizes, nine role/status/capability menu scenarios, blank/whitespace validation, keyboard cycling, dirty Escape, security cancel, failure preservation, duplicate submission, retry identity and actual recorded details |
| Native Deno / deployed Edge Function | Not run; Deno CLI unavailable. Canonical handler source was TypeScript-transpiled and exercised with mocked SDK/Auth/grant transport |
| Authenticated web/mobile operation | Not run; no real decisions or live mutations |

New SQL checks exercise browser mutation denial, missing/ordinary/blocked actors, both permitted statuses, all five forbidden statuses, required reason/length, mismatched expected state, stale approval and changed review state, inconsistent release metadata, replay and conflicting request reuse, private detail access, generic member messages and notification-failure rollback. These tests run the actual migration against isolated PGlite PostgreSQL with the existing backend's active-Super-Admin helper. Row locking and conditional guards are implemented; a multi-connection production concurrency stress test was not run.

The canonical handler tests verify real password-check invocation, role/active-account denial, missing-schema capability failure, reason/UUID/state validation, action/application/reason-bound single-use grants, safe conflict feedback and refusal of generic rejection updates. The listing test exercises the existing application loader and verifies that rejected records remain available under the established status contract.

The UI harness initially needed corrected width expectations for the separate 900px Details dialog, explicit waiting for the security stage to finish, and settled table scrolling before menu interaction. A preview-only watermark also intercepted mobile clicks and was made noninteractive. The final dedicated run and regression suite pass. Existing Node module-type warnings appeared in source tests; unrelated package settings were not changed.

## Screenshots and manual verification

[Open the 33-image gallery](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-qa/index.html). It contains the action menu, reason form, validation error, password verification/error, final confirmation, submission state, server error, preserved reason, success and recorded details at **1366×768**, **768×1024** and **390×844**. All records, names and credentials in this harness are synthetic, and external requests are blocked. The captures use actual React components and the existing Tailwind/styles in a fresh headless Edge profile; Computer Use and the user's Chrome session were not used.

Representative captures:

- [Desktop reason form](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-qa/screenshots/reason-form-1366.png)
- [Mobile form](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-qa/screenshots/reason-form-390.png)
- [Mobile confirmation](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-qa/screenshots/final-confirmation-390.png)
- [Confirmed success preview](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-qa/screenshots/success-1366.png)
- [Recorded rejection details preview](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-qa/screenshots/rejection-details-1366.png)

Visual inspection covered desktop and mobile form/confirmation/result states; automated bounds, textarea layout, footer visibility and horizontal-overflow assertions cover all three sizes. These isolated previews do **not** prove that authenticated routes, remote RLS, remote grants, live table refresh/filtering or a deployed mobile inbox work. Those require controlled verification after deployment, using the application's existing approved test process.

## Deployment boundary

No database or deployment command was executed. The canonical backend runbook warns that historical migration ledgers may differ from deployed schema. Review current prerequisites and apply **only this forward addition** through the project's controlled process; do not replay old migrations or run a broad `db push` as part of this change.

The logical migration is supplied in two matching locations: backend `027_secure_loan_rejection.sql` and the admin repository's `20261110_secure_loan_rejection.sql`. They were verified byte-identical and represent the same addition, not two separate deployment steps. Deploy the canonical backend `supabase/functions/secure-admin-action/index.ts` entry point, which imports the modified `edge-functions` implementation. Do not deploy the older admin-repository function as a substitute. Verify the authenticated capability response before considering rejection enabled. The updated UI stays hidden while this support is absent.

## Files inspected

Frontend source: LoanApplicationsTable, LoanDetailsModal, loanDetailsPresentation, LoanApplicationsData, LoanDocumentsModal, LoanReleaseDialog, the Loan Applications page/Toolbar, api.ts, protectedAction.ts, adminPrivileges.ts, SecureAdminActionProvider, FormDialog, ActionDialog, ConfirmActionDialog, ActionResultDialog, Fields/Button, RecordsView and existing isolated preview/test tooling.

Backend source: canonical secure-admin-action dispatcher and wrapper; migrations 001/002/003/004/005/006/007/013/023/025/026; existing grant, audit, release and notification migrations/tests; backend README/deployment constraints and Express loan-status route. Mobile source: database services, loans screens and notification screens in both sibling Flutter projects. Church reference: `C:/Users/zylcee/Desktop/Church Management/admin/users.php` and `css/admin-sidebar.css`.

## Exact files changed by this task

Production frontend:

- [LoanApplicationsTable.tsx](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/LoanApplicationsTable.tsx) — capability-gated menu and existing refresh callback.
- [LoanRejectionDialog.tsx](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/LoanRejectionDialog.tsx) — new reason form using shared dialogs/security provider.
- [SecureAdminActionProvider.tsx](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/auth/SecureAdminActionProvider.tsx) — destructive rejection icon/tone and optional result title only.
- [loanRejection.ts](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/lib/loanRejection.ts) — validation, capability negotiation and restricted metadata reader.
- [LoanDetailsModal.tsx](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/LoanDetailsModal.tsx) — actual private metadata loading/error/retry.
- [loanDetailsPresentation.ts](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/loanDetailsPresentation.ts) — explicit Rejection Information section.

Backend and migration:

- [Canonical secure-admin-action](C:/Users/zylcee/Desktop/COOP/coop_backend/supabase/edge-functions/secure-admin-action/index.ts) — targeted transactional rejection branch, capability mode, validation and generic-rejection bypass guard; unrelated branches preserved.
- [027_secure_loan_rejection.sql](C:/Users/zylcee/Desktop/COOP/coop_backend/supabase/migrations/027_secure_loan_rejection.sql) — forward addition using existing grants helper, audit and inbox stores.
- [20261110_secure_loan_rejection.sql](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/supabase/migrations/20261110_secure_loan_rejection.sql) — identical migration mirror for this repository's tests/review.

Tests/artifacts:

- [loan-rejection.test.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/supabase/tests/loan-rejection.test.mjs)
- [loan-rejection-backend.test.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/scripts/loan-rejection-backend.test.mjs)
- [loanRejection.test.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/lib/loanRejection.test.mjs)
- [loanRejectionListing.test.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/lib/loanRejectionListing.test.mjs)
- [loanDetailsPresentation.test.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/loanDetailsPresentation.test.mjs)
- [loan-rejection-previews.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/scripts/loan-rejection-previews.mjs)
- [action-dialogs.test.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/scripts/action-dialogs.test.mjs)
- [loan-details-previews.mjs](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/scripts/loan-details-previews.mjs) — recognizes the new read-only metadata RPC in its no-financial-RPC assertion.
- [modal-previews.tsx](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/tests/fixtures/modal-previews.tsx)
- [QA folder](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-qa/index.html) — report, source-test log, backend change diff, screenshots/metrics and regression captures.

Backend edits were applied only after checking its source still matched the inspected working-tree snapshot. The targeted diff is saved as `backend-change.patch` for review. No unrelated working-tree changes were reverted. No financial formulas, allocations, balances, approval/release conditions, authentication/session code, existing grant semantics, database RLS policies or mobile submission workflows were intentionally changed.
