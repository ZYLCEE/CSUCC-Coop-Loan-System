# Loan Application Details — implementation and visual QA

Date: November 10, 2026. Scope: the shared Loan Application View Details component and its isolated verification. Existing working-tree changes were preserved; no commits, resets, migrations, live mutations, Chrome control, or Computer Use were performed.

## Result and design reference

Replaced automatic database-column rendering with explicit presentation fields. The shared DetailDialog now has a 900px maximum width, the title **Loan Application Details**, application-ID subtitle, green section headings, subtle dividers, muted labels, dark wrapping values, existing status badges and shared footer buttons. The grid uses three columns at desktop, two at tablet, and one at mobile. The existing portal, blurred backdrop, focus handling, body scrolling, visible footer and nested-dialog behavior remain in use.

The source reference was `C:/Users/zylcee/Desktop/Church Management/admin/users.php` and `css/admin-sidebar.css`: separated header/body/actions, green information headings, rounded white surfaces, blurred overlay, soft shadow, 42px action buttons and controlled spacing. The Church files were read only. No PHP, account workflows or permissions were transferred.

## Explicit display map and source authority

**Application fields:** Application ID (`application_id`), Loan Type (`loan_type`), Requested Loan Amount (`amount`), Loan Purpose (`purpose`), Repayment Term (`tenure_months`), Date Submitted (`date_submitted`), Current Application Status (`status`). Required missing values read **Not available**; optional empty fields are omitted.

**Applicant fields:** Member Full Name (existing related member first/last name, falling back to application `member_name`), Membership Number (related `members.member_id`, never the application foreign-key UUID), Membership Type (existing normalized membership labels), Monthly Income (application `income`, pre-release only).

The read uses the same loan-application lookup and the existing `members(id, member_id, first_name, last_name, membership_type)` relationship already used in `src/lib/api.ts`. It remains subject to the existing Supabase session and RLS. No new relationship, income query, table, endpoint or permission was introduced. Missing related-member data falls back to the application name and omits unavailable membership fields. A query error is shown as an error, with retry; it is not treated as empty successful data.

| Existing status | Sections and fields shown | Review or lifecycle message | Footer |
|---|---|---|---|
| Pending | Application fields + applicant fields | This loan application is awaiting administrative review. | Close, View documents |
| Under Review | Application fields + applicant fields | This loan application is currently under review. | Close, View documents |
| Rejected | Application fields + applicant fields | Explicit rejected message; additional decision information unavailable | Close, View documents |
| Approved | Application fields + applicant fields + recorded Date Approved (`date_approved`) when valid | Approval does not indicate released funds | Close, View documents |
| Released | Loan Summary: application ID, type, original principal, status; Applicant Information: name and available membership details; Release Information: recorded release date, term, reference; Repayment Information: recorded monthly installment when present | Open existing history for available balances/transactions | Close, View documents, Open payment history |
| Completed | Same operational sections; recorded Date Completed (`date_completed`) when valid | Repayment completed | Close, View documents, Open payment history |
| Overdue | Same operational sections; no new arrears or penalty calculation | Explicit overdue message; history entry point | Close, View documents, Open payment history |

Loan Summary labels the stored `amount` as Original Principal. Monthly Installment (Recorded) displays only stored `monthly_payment`; it is not recomputed or represented as a new quote. Repayment term formatting adds the word “months” without financial calculation. Currency uses the existing `pesos` formatter. Date-only values retain their calendar day; timestamp instants use Asia/Manila. Invalid dates and empty numeric values do not become fabricated dates or zero amounts.

## Fields deliberately hidden

| Fields | Where hidden / reason |
|---|---|
| Internal loan UUID, application `member_id` foreign-key UUID, internal audit/user identifiers | All main detail views; membership number comes only from the established member relationship |
| Release request ID, idempotency keys, internal processing metadata | All main detail views |
| `created_at`, `updated_at`, unrecognized database columns and nested raw objects | All main detail views; never automatically rendered |
| Credit score | All main detail views; no established evaluation use was found in application code |
| Release date, reference, notes, released-by identities, release interest/fee rates and fee amounts | Pre-release views; Approved is not disbursed |
| Release notes, released-by identities, fee/interest snapshots | Also omitted from operational main summaries to keep them focused; existing release/ledger screens remain responsible for operational detail |
| Date completed | All except Completed |
| Monthly payment and payment-history controls | Pre-release views |
| Individual payments, payment receipts, allocation details, reversal data | All main detail views; use existing authorized ledger |
| Net proceeds, total paid, outstanding balance, next due date, overdue amount | Not derived in this view; use existing ledger where supported |

## Unsupported metadata and limitations

The inspected application shape, seed/migrations and application code establish `date_approved`, but do not establish review-start dates, reviewing administrator, administrative review notes, rejection reason/date/actor, approval actor/remarks or a distinct approved amount. These are omitted rather than inferred from `updated_at`, audit identifiers or requested amount. No new backend fields were created. If such metadata is later established through an authorized source, it must be explicitly added to the field map.

Net proceeds are returned by the existing release operation but are not an established persisted column in the detail query. No release operation is invoked to obtain them. The existing ledger's principal-remaining value is not relabeled as a total outstanding balance. No fees, arrears, allocation totals or due dates are calculated here.

## Actions, loading and security

Pre-release views show a neutral Close and green View documents. Operational views retain neutral Close/View documents and green Open payment history. No new approval, release, payment or reversal action was added. The approved-loan release entry remains in the existing table workflow. The nested CounterPaymentDialog retains its own role/status checks and server-authorized financial operations; hiding or showing a navigation button does not grant authority.

The eager `loan_payments` list query was removed because the main view no longer lists transactions. Existing payment RPCs and API contracts were not modified. Opening the ledger still goes through the existing CounterPaymentDialog and `loan_payment_ledger` service. The component refreshes its application record after the nested payment dialog closes, as before.

The complete detail view is keyed by application ID, resetting record, error and nested-dialog state immediately when applications change. Late requests are ignored after unmount. Failed reads preserve a visible error with a Try again action and hide data-dependent actions. The details view is read-only; existing nested-form unsaved-change protections were not changed.

## Entry-point inventory and verification matrix

| Entry point / component | Old presentation → new presentation | Verification |
|---|---|---|
| `/admin/loan-applications` → LoanApplicationsTable | Generic record grid → curated shared modal | Route source inspected; real component rendered with mocked Admin role; authenticated route still requires manual verification |
| `/super-admin/loan-applications` → LoanApplicationsTable | Same → same redesigned component | Route source inspected; real component rendered with mocked Super Admin role; authenticated route still requires manual verification |
| RecentApplications dashboard | Same shared details | Caller source inspected; inherits shared presentation; authenticated dashboard unverified |
| RecordsView active-loan details | Same generic details/payment list → operational sections/history entry point | Caller source inspected; Released/Completed/Overdue synthetic renders checked |
| View documents nested dialog | Existing LoanDocumentsModal retained | Real nested component test: Escape/footer close, footer bounds and focus restoration pass |
| Open payment history nested dialog | Existing CounterPaymentDialog retained only for later lifecycle statuses | Mocked Admin and Super Admin gates, read-only ledger requests, Escape and focus restore pass |
| Loan release | Existing authorized table/LoanReleaseDialog workflow retained | Source inspected, unchanged; existing isolated acknowledgement/failure/retry tests pass |
| Loading / error / retry / application switch | Spinner + error retained, retry and explicit per-application reset added | Synthetic pending request, failed response/retry, switched application and missing-value tests pass |

## Visual evidence

Open [the before/after gallery](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/index.html). There are **21 before and 37 after screenshots**: all seven statuses at 1366×768, 768×1024 and 390×844, plus after-only loading/error/missing states and scrolled mobile views for every lifecycle status. Synthetic records deliberately contain release metadata and a credit score to verify that these cannot leak into pre-release content.

Representative images:

- [Approved desktop before](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/before/approved-1366.png) → [after](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/after/approved-1366.png)
- [Pending mobile](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/after/pending-390.png)
- [Approved mobile, scrolled to review](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/after/approved-390-end.png)
- [Released tablet](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/after/released-768.png)
- [Error mobile](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/after/error-390.png)

Images were generated by the existing isolated real-React/Tailwind test harness using synthetic Supabase responses and headless Edge, with external requests blocked. Desktop, mobile top/scrolled and tablet screenshots were also visually inspected. Automated measurements check all 30 after viewport/state combinations for viewport bounds, visible footers, no horizontal overflow and width ≤900px. Data views additionally check the 3/2/1-column grid, Tab containment, Escape/focus restoration, forbidden field omission and absence of financial RPCs on details open. Metrics are saved in `before/metrics.json` and `after/metrics.json`.

**These are isolated component previews, not authenticated application screenshots.** The known Chrome-control limitation was not retried. No existing Chrome session or localhost application was controlled. Actual Admin/Super Admin data loading under live RLS, route-level permissions, real long records/documents and installed-font rendering still require manual verification in the working application at port 3000. No live approvals, releases, payments or reversals were tested.

## Validation results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed: optimized Next 16.2.12 build, 20 static pages and dynamic Admin/Super Admin routes |
| Source/SQL automated tests | 126 passed, including 11 new presentation tests and existing isolated PostgreSQL financial/authorization tests |
| `node --test scripts/action-dialogs.test.mjs` | 11 passed; confirmation/cancel, double-submit, security grants/errors/roles, release safeguards, payment validation/allocation/retry, reversal reason/identity, nested dialogs and dirty-close protection |
| `COOP_LOAN_DETAILS_PHASE=before` isolated capture | Passed: 21 viewport/status cases |
| `COOP_LOAN_DETAILS_PHASE=after` isolated capture | Passed: 30 viewport/state cases, mobile end screenshots, both mocked roles, failed read/retry, nested ledger and pending application switch |

The first sandboxed headless launch failed because Edge could not run in the Windows sandbox. It passed outside the sandbox using a fresh headless profile and mocked services. An initial broad test command accidentally included this browser test under the sandbox (126 passed, one environment failure); the corrected source/SQL run and separate headless regression run both passed. The sandboxed production build stalled during compilation and was stopped; the outside-sandbox build completed successfully. Existing Node module-type warnings appeared in source tests; no package configuration was changed for these warnings.

## Exact task changes

Production code:

- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/LoanDetailsModal.tsx`: redesigned read-only sections, status-aware footer, member relationship, retry and application-key reset.
- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/loanDetailsPresentation.ts`: explicit field/status presentation map and formatting guards.

Tests and preview tooling:

- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/src/components/loan-applications/loanDetailsPresentation.test.mjs`: seven statuses, optional/missing/invalid values, dates, normalization and member relationship tests.
- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/scripts/action-dialogs.test.mjs`: synthetic detail-record/error inputs, dedicated capture mode, updated old heading assertion.
- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/scripts/loan-details-previews.mjs`: synthetic status/viewport captures and focused interaction assertions.
- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/scripts/modal-preview-captures.mjs`: existing gallery wait updated for the new section heading.
- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/tests/fixtures/modal-previews.tsx`: isolated upstream application-switch control.
- `C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-details-qa/`: this report, gallery, before-source snapshot, before/after screenshots and metrics, and existing regression screenshots captured into a new folder.

The diff was compared against the working-tree LoanDetailsModal snapshot, not merely Git HEAD. Existing shared dialog primitives, SecureAdminActionProvider, loan approval/release/payment/reversal services, financial formulas, endpoints, schema, RLS, sessions, authentication and authorization code were not edited by this task. No workflow transitions or financial/security rules were intentionally changed.
