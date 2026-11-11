# COOP modal source audit and isolated visual QA

Date: 2026-11-10 (Asia/Manila). This review uses source inspection and headless, isolated component previews with synthetic records. Computer Use and the user's Chrome session are not used. This is not authenticated application testing.

## Source inventory

Both `src/app/admin/[section]/page.tsx` and `src/app/super-admin/[section]/page.tsx` reuse the audited shared pages. Existing route, privilege, server password/grant and financial service behavior are outside the presentation changes in this review.

| Route / entry | Action or state | Current shared presentation | Audit note |
|---|---|---|---|
| Accounts / MembersTable | View account | MemberDetailsModal → DetailDialog | Compact read-only details; shared close action |
| Accounts | Create account | MemberFormModal → FormDialog | Original validation and identity acknowledgment; then existing secure provider |
| Accounts | Edit account | MemberFormModal → FormDialog | Original fields/submission; dirty-close confirmation inherited |
| Accounts | Block / unblock / delete | SecureAdminActionProvider → ActionDialog, ConfirmActionDialog, ActionResultDialog | Original server verify → grant → execute → result; block/delete use danger |
| Accounts form | Cancel dirty edits | FormDialog → ConfirmActionDialog | Shared discard/keep-editing; no save on close |
| ResetPasswordModal | Temporary-password input | FormDialog | Unreferenced callback component; no API connection is invented |
| Loan table / dashboard recent applications | View application / loan | LoanDetailsModal → DetailDialog | Nested payment/documents; action group originally in scroll body |
| Loan table / loan detail | Attachments | LoanDocumentsModal → DetailDialog | Existing links/service; loading, error, empty and documents states |
| Loan table | Start review / approve | SecureAdminActionProvider family | Same review-loan/approve-loan requests, roles and payloads |
| Loan table | Release input / acknowledgment | LoanReleaseDialog → FormDialog | Original eligibility/date/acknowledgment and PHP values |
| Loan release | Review / recording / failure / success | ConfirmActionDialog / ActionResultDialog | Same idempotency and backend request; error retained for correction |
| Active loans / record menu / loan detail | Payment ledger / cash receipt input | CounterPaymentDialog → FormDialog | Original role/status/setup gates, receipt/date/amount fields and preview service |
| Counter payment | Allocation review / recording / error / success | ConfirmActionDialog / ActionResultDialog | Exact amount/allocation/retry identifier retained |
| Counter payment | Reverse posted receipt | Destructive ConfirmActionDialog | Original reason validation, service call and audit/refund consequences |
| Active loan / audit records | Record details | RecordsView → DetailDialog or LoanDetailsModal | Shared route/menu entry points; no stale deleted ActiveLoansTable restored |
| Announcements / cards | View | AnnouncementDialog → DetailDialog | Compatibility wrapper; no separate portal shell |
| Announcements | Create / edit / draft / publish / schedule / reschedule | AnnouncementEditor → FormDialog + ConfirmActionDialog | Existing form validation, status/version/scheduler/notification behavior |
| Announcements | Archive / restore / cancel schedule / delete draft | ConfirmActionDialog | Existing action/version API; warning/danger distinction |
| Announcements | Completed response | ActionResultDialog | From existing resolved save/action callbacks |
| Documents | Delete cooperative document / result | ConfirmActionDialog / ActionResultDialog | Upload/delete privileges and multipart/DELETE requests preserved |
| Documents | Upload / view / download | Existing file picker/links + shared feedback | File picker and links are not modal-shell exceptions |
| Profile | Discard before reload | ConfirmActionDialog | Explicit reload guard; draft preserved on cancel |
| Profile / own password / email | Inline edit / save / feedback | Inline forms + ActionFeedback | Intentional inline forms; existing server password/email checks unchanged |
| Settings privileges | Switch selection / reload dirty edits / save review | ConfirmActionDialog + ActionFeedback | Existing password/version endpoint; no new grant or permission policy |
| Loan policy | Review / save / result | SecureAdminActionProvider family + ActionSummary/Feedback | Same policy payload and security workflow |
| General settings | Save review | ConfirmActionDialog + ActionFeedback | Same permission, validation, POST and change event |
| Session settings | Sign out other sessions | ConfirmActionDialog + ActionFeedback | Same Supabase scope others call; not exercised live |
| Snapshot export | Download / feedback | Existing controls + ActionFeedback | Export is not a mutation dialog |
| Notifications | Send / schedule | SecureAdminActionProvider family | Same notification privilege/endpoint and protected stages |
| Notification bell | Recent alerts | Anchored role=dialog with aria-modal=false | Intentional nonmodal popover; retains outside-click, placement and links |
| Notification bell | Expanded history | ActionDialog | Shared modal; filters/search/read/refresh/back actions |
| Legacy Backup / Security | Restore / revoke | Disabled ConfirmActionDialog | Unreferenced service-less previews; remain unavailable |
| Legacy GeneralSettings / EmailConfiguration / FeatureToggles / ProfileForm | Local-only controls | Labeled disabled inline previews | Not connected; no fake successes or new workflows |
| RecordActionsMenu / member/loan table menus | Action selection | role=menu / existing popover controls | Menus are not modal dialogs |
| SuperAdminLoanAlerts | Realtime status/toasts | Inline role=status surfaces | Nonmodal notification surfaces, not action-result dialogs |
| Reports / records / navbar | Export, print, navigation, logout | Existing shared controls | No modal expected; session/export behavior untouched |

The complete `src` scan found no active bespoke modal shell outside the shared family. Only the recent-notifications popover has its own nonmodal dialog markup; menus and realtime status toasts are intentional exceptions. No browser-native application alert/confirm is present. FormDialog retains the native beforeunload navigation warning for unsaved data.

## Reference and preview method

Read Church Management `admin/users.php`, `admin/approvals.php`, and `css/admin-sidebar.css`: translucent slate backdrop with 4–5px blur, white rounded panels, compact confirmations around 480–520px, wider forms around 680px or as content requires, icon headings, consistent 42–44px controls, structured detail summaries, separators and secondary/semantic action footers. COOP keeps its existing green and semantic warning/danger tokens.

The existing `scripts/action-dialogs.test.mjs` harness is extended rather than adding an application preview route. It bundles real components, uses fake transport modules, serves on an ephemeral loopback port, blocks external requests, and provides synthetic account/loan/receipt/document data. The preview page explicitly labels itself synthetic. No production credentials, sessions, API endpoints or data are used. A missing UTF-8 declaration in the old test HTML was corrected before keeping the baseline screenshots; it was a fixture issue, not a source-text defect.

Preview cases: account view/create/edit, password form, loan details, documents, announcement form, warning/destructive confirmations, approval password/review, successful mocked result, release form/review/error, payment form/review/reversal, loading and dirty-discard confirmation. Capture each at 1366×768 and 390×844. Before and after use the same fixtures and compiled application CSS.

## Findings, corrections and evidence

| Finding in the synthetic baseline | Presentation correction | Evidence |
|---|---|---|
| Payment review action was below a long mobile scroll body; no persistent footer | Move the same submit control into FormDialog's footer with its existing disabled/loading conditions; associate it with the original form using `form="counter-payment-form"`; close uses the existing dirty-close path | [Before mobile](modal-qa-previews/before/payment-form-390.png) / [After mobile](modal-qa-previews/after/payment-form-390.png) |
| Loan-detail payment/documents actions lived in scrolling content | Move unchanged handlers to DetailDialog footer; secondary actions precede the primary CTA | [Before desktop](modal-qa-previews/before/loan-details-1366.png) / [After desktop](modal-qa-previews/after/loan-details-1366.png) |
| Three loan-detail footer actions cramped the primary label on mobile | Shared responsive footer gives the primary action its own row when there are at least three controls; two-action confirmations keep their compact side-by-side layout | [Before mobile](modal-qa-previews/before/loan-details-390.png) / [After mobile](modal-qa-previews/after/loan-details-390.png) |
| Application-document refresh action was inside the body | Put the same refresh handler and close shortcut in the shared footer | [Before](modal-qa-previews/before/documents-390.png) / [After](modal-qa-previews/after/documents-390.png) |
| Footer buttons varied between 36px and 40px | Shared dialog action token sets a 42px minimum; long labels may grow rather than clip | Metrics JSON for both capture sets |
| Modal fields used the 40px page-control height | Dialog-scoped field token sets 44px controls, without changing page/table controls or checkbox/radio sizing | Create/edit/release screenshots |
| Empty validation slots added large vertical gaps to the create/edit account grid | Remove empty slots' fixed minimum height; preserve all messages and validation | [Before create](modal-qa-previews/before/account-create-1366.png) / [After create](modal-qa-previews/after/account-create-1366.png) |
| Release/payment forms used the generic edit icon; loan review used a generic question icon; edit account showed the create icon | Use HandCoins for release, Wallet for payment, FileCheck2 for loan review/approval, Megaphone for announcements, UserRoundPen for edit | Corresponding after previews |
| Header icon/title alignment differed for one-line headings | Center title block and icon vertically inside the shared header | All after previews |
| A failed release message was below a long review summary on mobile | Shared ConfirmActionDialog renders the unchanged error before the entity summary; no response or failure-handling logic changes | [Before mobile error](modal-qa-previews/before/release-error-390.png) / [After mobile error](modal-qa-previews/after/release-error-390.png) |
| Unused reset-password form retained independent hard-coded typography/toggle styling | Use shared label/support/caption/status classes and shared icon-button styling | Password-form before/after previews; callback/validation unchanged |

Intentional differences retained: confirmations/results remain 480px on desktop; account forms use 760px; release input 760px; payment ledger 896px; document details 576px; complex loan/announcement layouts 1080px. All shrink within mobile gutters. These are content-appropriate sizes, not competing modal systems. Confirmation summaries stack on mobile; long form bodies scroll while headers/footers remain visible. Existing backdrop opacity/blur, shadows, semantic colors and security result dismissal rules are retained.

## Before/after preview gallery

[Open all 42 before/after comparisons](modal-qa-previews/index.html). Original PNGs are retained unchanged in separate `before/` and `after/` directories; contact sheets are navigation aids. All images use synthetic records and mocked responses.

| Representative state | Desktop before / after | Mobile before / after |
|---|---|---|
| View/details | [Before](modal-qa-previews/before/account-view-1366.png) / [After](modal-qa-previews/after/account-view-1366.png) | [Before](modal-qa-previews/before/account-view-390.png) / [After](modal-qa-previews/after/account-view-390.png) |
| Create | [Before](modal-qa-previews/before/account-create-1366.png) / [After](modal-qa-previews/after/account-create-1366.png) | [Before](modal-qa-previews/before/account-create-390.png) / [After](modal-qa-previews/after/account-create-390.png) |
| Edit | [Before](modal-qa-previews/before/account-edit-1366.png) / [After](modal-qa-previews/after/account-edit-1366.png) | [Before](modal-qa-previews/before/account-edit-390.png) / [After](modal-qa-previews/after/account-edit-390.png) |
| Warning | [Before](modal-qa-previews/before/warning-1366.png) / [After](modal-qa-previews/after/warning-1366.png) | [Before](modal-qa-previews/before/warning-390.png) / [After](modal-qa-previews/after/warning-390.png) |
| Destructive | [Before](modal-qa-previews/before/destructive-1366.png) / [After](modal-qa-previews/after/destructive-1366.png) | [Before](modal-qa-previews/before/destructive-390.png) / [After](modal-qa-previews/after/destructive-390.png) |
| Loan approval | [Before](modal-qa-previews/before/approval-review-1366.png) / [After](modal-qa-previews/after/approval-review-1366.png) | [Before](modal-qa-previews/before/approval-review-390.png) / [After](modal-qa-previews/after/approval-review-390.png) |
| Release review | [Before](modal-qa-previews/before/release-review-1366.png) / [After](modal-qa-previews/after/release-review-1366.png) | [Before](modal-qa-previews/before/release-review-390.png) / [After](modal-qa-previews/after/release-review-390.png) |
| Payment recording review | [Before](modal-qa-previews/before/payment-review-1366.png) / [After](modal-qa-previews/after/payment-review-1366.png) | [Before](modal-qa-previews/before/payment-review-390.png) / [After](modal-qa-previews/after/payment-review-390.png) |
| Payment reversal | [Before](modal-qa-previews/before/payment-reversal-1366.png) / [After](modal-qa-previews/after/payment-reversal-1366.png) | [Before](modal-qa-previews/before/payment-reversal-390.png) / [After](modal-qa-previews/after/payment-reversal-390.png) |
| Loading | [Before](modal-qa-previews/before/loading-1366.png) / [After](modal-qa-previews/after/loading-1366.png) | [Before](modal-qa-previews/before/loading-390.png) / [After](modal-qa-previews/after/loading-390.png) |
| Successful mocked response | [Before](modal-qa-previews/before/success-result-1366.png) / [After](modal-qa-previews/after/success-result-1366.png) | [Before](modal-qa-previews/before/success-result-390.png) / [After](modal-qa-previews/after/success-result-390.png) |
| Failed mocked response | [Before](modal-qa-previews/before/release-error-1366.png) / [After](modal-qa-previews/after/release-error-1366.png) | [Before](modal-qa-previews/before/release-error-390.png) / [After](modal-qa-previews/after/release-error-390.png) |
| Unsaved changes | [Before](modal-qa-previews/before/unsaved-1366.png) / [After](modal-qa-previews/after/unsaved-1366.png) | [Before](modal-qa-previews/before/unsaved-390.png) / [After](modal-qa-previews/after/unsaved-390.png) |

Additional gallery cases cover the reset form, full loan details, documents, announcement editor, approval password stage, release input, payment input and standalone error result. The synthetic success screenshot is reached only after the mocked provider returns success; no real approval was executed.

## Verification and preservation

Before and after: 21 cases × 2 viewports = 42 screenshots each, 84 original comparison PNGs total. The after metrics record zero panel horizontal overflow and zero clipped existing footers. Footer buttons have a 42px minimum (wrapped mobile content can grow). Contact sheets and representative full-resolution images were visually inspected, not just generated.

Protected-source hashes match the start of this request for all service libraries, API routes and Supabase/database files. TypeScript printer comparison verifies the named handler/validation initializers in changed components are unchanged, including member submission/validation, secure verify/execute/callbacks, release/save/idempotency logic, payment preview/save/reversal and the shared confirmation handler. Eligibility conditions and original footer disabled/loading conditions were also preserved. Existing working-tree changes were preserved; no restore/reset/clean was performed.

No live account mutation, approval, disbursement, receipt or reversal was executed. No Computer Use calls were made in this phase.

| Final verification | Result |
|---|---|
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with no ESLint warnings |
| `npm run build` | Passed, including Admin and Super Admin route compilation |
| Combined automated suite | **126 passed, 0 failed, 0 skipped**: 115 existing model/API/isolated PostgreSQL tests plus 11 component browser tests |
| Synthetic captures | 42 before and 42 after; same 21 representative states at desktop/mobile sizes |
| Final mobile error placement | Error bounding box verified above the footer; screenshot visually inspected |
| Source/diff checks | Service/API/database hashes unchanged; named handler/validation/eligibility initializers unchanged; `git diff --check` passed |

The component suite covers cancel/no request, unsuccessful mocked responses/no false success, duplicate clicks, required fields, role/privilege restrictions, focus containment/restoration, unsaved edits, release acknowledgment/amount/retry ID, payment allocation/amount/retry ID, receipt/reason/reversal request, footer-associated native form validation, and nested document focus. Existing Node MODULE_TYPELESS_PACKAGE_JSON warnings remain; they are unrelated to these presentation changes.

Reproduce the isolated previews in PowerShell: `$env:COOP_MODAL_PREVIEW_PHASE='after'; node --test scripts/action-dialogs.test.mjs`. Remove that environment variable before running the regression suite. `COOP_MODAL_PREVIEW_SCENARIOS` optionally selects comma-separated capture case names; unset it for all cases. `COOP_DIALOG_TEST_SCREENSHOTS='docs/modal-qa-previews/regression'` keeps regression screenshots separate from older artifacts. Browser execution uses an installed Playwright package or the existing Codex bundled fallback, with headless Edge on Windows; it runs outside the Windows sandbox because sandboxed browser launch is unavailable. No package was installed.

Combined suite command: `$testFiles = @(rg --files src supabase/tests -g '*.test.mjs'); $testFiles += @('scripts/repair-demo-accounts.test.mjs','scripts/action-dialogs.test.mjs'); node --test --test-concurrency=2 $testFiles`. The preview fixture CSP disallows outbound connections; preview contexts also abort unexpected requests. Transport stubs never read `.env` credentials or contact Supabase.

## Files changed in this review

- Shared presentation: `src/components/ui/ActionDialog.tsx`, `ConfirmActionDialog.tsx`, `portal-ui.css`.
- Member presentation: `src/components/members/MemberFormModal.tsx`, `ResetPasswordModal.tsx`.
- Loan/payment presentation: `src/components/loan-applications/LoanDetailsModal.tsx`, `LoanDocumentsModal.tsx`, `LoanReleaseDialog.tsx`; `src/components/active-loans/CounterPaymentDialog.tsx`.
- Icon-only changes: `src/components/auth/SecureAdminActionProvider.tsx`, `src/components/announcements/AnnouncementEditor.tsx`.
- Isolated infrastructure: `scripts/action-dialogs.test.mjs`, new `scripts/modal-preview-captures.mjs`, `tests/fixtures/action-dialogs.tsx`, new `tests/fixtures/modal-previews.tsx`.
- Artifacts: this report and `docs/modal-qa-previews/` (comparison gallery, screenshots, metrics and source-integrity summaries).

No dependencies, application preview routes, backend endpoints, schemas, RLS, authentication, permissions, financial calculations or workflow stages were added or changed.

## Authenticated manual verification still required

Every affected live route still needs manual checks in both real roles: `/admin` and `/super-admin` account pages, loan applications, active loans, announcements, documents/system management, settings, profile, notifications/communication, audit records and dashboard detail entry points. The shared source is audited, but role-specific menus, actual data length/availability, font loading and server/network behavior were not exercised in an authenticated browser in this phase.

Manual follow-up: existing password/reauth steps, real permission restrictions, backend validation messages, failed/stale requests, long real document names, keyboard/screen-reader behavior, mobile virtual keyboard and zoom. Real financial/account operations should use authorized test records under the team's normal process; they were not executed for screenshots. The preview uses compiled application CSS with the local font fallback rather than proving Next's authenticated font loading. Legacy placeholder controls and the unreferenced reset form remain unavailable/unwired as before. No Next-wide SPA navigation blocker is introduced; existing FormDialog dirty-close/beforeunload behavior is preserved.

This isolated review does not replace authenticated application QA, deployment checks, or a rendered PHP reference comparison. The historical Chrome-control report remains separate in `docs/visual-qa-report.md`.
