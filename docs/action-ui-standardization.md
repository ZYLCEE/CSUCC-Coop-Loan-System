# Admin action UI audit and verification

Audit date: 2026-11-10 (Asia/Manila). Scope: shared pages used by both `/admin/[section]` and `/super-admin/[section]`, including dashboard, table and menu entry points. Existing working-tree changes were preserved; this task does not change endpoints, libraries in `src/lib`, API routes, migrations, RLS or financial calculations.

## Reference inspected before implementation

Read local Church Management `admin/users.php` (create/edit/reset/account action overlays, create-confirm/action-confirm/create-success classes), `admin/approvals.php` (compact action confirmation, header/body/actions), `admin/deletion_requests.php`, `admin/blocked_accounts.php`, `admin/privileges.php`, and `css/admin-sidebar.css`. Reference: slate translucent backdrop, 4–5px blur, white 12–16px panels, 520px confirmations, 680px forms, icon headings, entity summaries, separated secondary/primary actions. COOP retains green primary and semantic danger/warning colors. No Church logic or PHP is transferred.

Read installed Next 16.2.12 server/client component and CSS guides before coding. Extend existing `ui` CSS/components; no new runtime dependency.

## Inventory before modification

A = Admin, S = Super Admin, A* = existing delegated privilege/route gate. These describe current UI gates, not new permission policy. Shared page components cover both role route trees and aliases (`all-accounts`, `communication`, `system-management`).

| Action | Current component / entry | Role and security/business flow retained | Inconsistency found | Proposed component |
|---|---|---|---|---|
| View account | MemberDetailsModal / MembersTable | A/S; read only | Generic shell, no icon | DetailDialog |
| Create account | MemberFormModal / members page | S; identity acknowledgment, validation, server password→grant→execute | Custom overlay; silent backdrop discard | FormDialog + secure provider |
| Edit account | MemberFormModal / members page | S; existing immutable ID/role rules, secure provider | Same custom overlay | FormDialog + secure provider |
| Block / unblock account | members page | S; secure provider, existing payload | Same green CTA | Secure confirmation/result; danger for block |
| Delete account | members page | S; secure provider, backend checks | Same green CTA | Destructive secure confirmation/result |
| Reset password | ResetPasswordModal | Unreferenced callback form; no current route connection | Custom shell/focus; do not invent API | FormDialog; inactive exception |
| Start review | LoanApplicationsTable | S; review-loan through secure provider | Provider presentation | Shared secure confirmation/result |
| Approve application | LoanApplicationsTable | S; approve-loan through secure provider; backend eligibility/docs | Provider presentation | Shared secure confirmation/result |
| View loan / history | LoanDetailsModal / applications, dashboard, RecordsView | A/S; Supabase read | Bespoke unbounded overlay | DetailDialog |
| View attachments | LoanDocumentsModal / table or detail menu | A/S; existing signed URL access | Generic shell | DetailDialog |
| Record release | LoanReleaseDialog | S; approved/date guards, disbursement acknowledgment, review, idempotency, backend policy snapshot/audit | Inline review/result; silent dirty close | FormDialog + compact confirm/result |
| View payment ledger | CounterPaymentDialog / record/detail menus | A/S; read; role/status controls retained | Large generic shell | FormDialog |
| Preview / record cash payment | CounterPaymentDialog | S; backend allocation preview, receipt/date validation, idempotent record | Inline review; dirty close | FormDialog + compact confirm/result |
| Reverse posted payment | CounterPaymentDialog | S; reason validation, backend reversal, retained receipt/audit | Inline panel; limited summary | Destructive confirm with receipt/member/amount/date |
| View active loan / audit detail | RecordsView / RecordActionsMenu | Existing route gates; read only | Generic detail | DetailDialog |
| Announcement detail | AnnouncementDialog / cards | Existing route/view gates | Extra portal wrapper | DetailDialog |
| Create/edit/save draft | AnnouncementEditor | S; existing API, validation/version/capabilities | Bespoke discard footer | FormDialog + shared discard |
| Publish / schedule / reschedule | AnnouncementEditor | S; validated payload, review, Manila scheduling, notifications capability | Inline review | Compact ConfirmActionDialog |
| Archive | announcements page | S; existing API/version checks | 720px confirmation | ConfirmActionDialog |
| Restore to draft | announcements page | S; existing API/version checks | Same | ConfirmActionDialog |
| Cancel schedule | announcements page | S; existing API/version checks | Same | ConfirmActionDialog |
| Delete private draft | announcements page | S; existing never-published check and API | Same | Destructive ConfirmActionDialog |
| Upload document | DocumentManager | A* documents.upload; POST FormData | Plain feedback | Shared feedback/result |
| Delete cooperative document | DocumentManager | A* documents.delete; DELETE id; loan attachments excluded | window.confirm | Destructive ConfirmActionDialog + actual result |
| View/download files | DocumentManager, LoanDocumentsModal | Existing access and signed URLs | No mutation dialog needed | Retain links/shared buttons |
| Reload dirty profile | ProfileWorkspace | Own account; discard guard | window.confirm | ConfirmActionDialog |
| Save/discard profile | ProfileWorkspace | Own account; profile validation and PUT | Inline feedback | Shared feedback; retain inline form |
| Change own password | PasswordSection | Current password server validation; POST | Inline feedback | Shared feedback/buttons; retain form |
| Change own email | EmailChangeSection | Existing S/current-password/PATCH and email confirmation | Inline feedback | Shared feedback/buttons; retain form |
| Switch admin / reload dirty privileges | RolesPermissions | S; preserve pending changes until explicit discard | window.confirm x2 | ConfirmActionDialog |
| Save privileges | RolesPermissions | S; existing password endpoint and optimistic version | Inline action/result | ConfirmActionDialog + shared feedback |
| Save loan policy | LoanPolicy | S; server password/grant/execute; exact policy payload | Provider presentation; lacks review summary | Shared secure UI and policy summary |
| Save general settings | PortalSettings | A* settings.manage; existing validation/POST | Plain action/result | Shared review/feedback |
| Sign out other sessions | PortalSettings | Own account; Supabase signOut scope others | window.confirm | ConfirmActionDialog + actual result |
| Export snapshot | PortalSettings | S; five existing read endpoints/download | Plain feedback | Shared feedback; preserve export |
| Backup/download/restore | Backup | Unreferenced, empty records, console-only handlers; NO API | Misleading custom modal/buttons | Explicit unavailable exception; disabled controls |
| Legacy session revoke/password policy | Security | Unreferenced, local-only settings, NO API | Custom unreachable modal | Explicit unavailable exception |
| Legacy general/email settings | GeneralSettings, EmailConfiguration | Unreferenced console-only saves; NO API | Misleading controls | Explicit unavailable exception |
| Legacy feature switches / profile save/password button | FeatureToggles, ProfileForm | Unreferenced local-only controls; NO API | Misleading controls and profile console logging | Explicit unavailable exception; disable controls and remove logging |
| Send/schedule notifications | SendNotificationCard | Existing send/schedule gates; secure provider; dedicated endpoint | Provider presentation | Shared secure UI |
| Notification history/mark read | NotificationPopover | Own inbox/API; recent popover and expanded center | Separate modal implementation | Shared expanded ActionDialog; retain anchored recent popover |
| Reports/CSV/print; record export | ReportWorkspace, RecordsView | Existing read/export gates | No modal needed | Retain shared buttons/native print |
| Logout/menu navigation | Navbar, Sidebar | Existing session and route handling | No action dialog | Retain existing behavior |
| ActiveLoansTable | Requested file | Already deleted before task; active route uses RecordsView | Must not resurrect stale component | RecordsView migration covers active route |

## Architecture and risks

ActionDialog: body portal, stacked focus containment/restoration, background inertness, body scroll lock, safe Escape, no backdrop dismissal by default, bounded scroll body and visible header/footer. ConfirmActionDialog: compact 480px shell, entity summary, semantic CTA, busy latch. ActionResultDialog: explicit success/error supplied only by callers after responses. FormDialog: larger shell, dirty discard confirmation, beforeunload protection. DetailDialog: read-only shell. Existing Button/buttonStyles remain the sole button system, adding warning. Dialog remains a compatibility export of the same shell.

Highest risks: SecureAdminActionProvider must retain role checks, verify/execute payloads, server grant and callback semantics; release/payment must retain exact arithmetic/IDs/dates/acknowledgment/idempotency; privileges must retain server password and version checks; close/back must never execute work or silently discard critical drafts. Review is presentation, never a new approval state.

## Verification matrix

Evidence labels: **B** = isolated browser interaction with real React components and compiled application CSS, mocked transport; **P** = existing isolated PostgreSQL/PGlite tests; **U** = existing service/API/model unit tests; **R** = source/diff review plus TypeScript/lint/build. Every row received R; B/P/U below describe additional evidence and do not imply live integration.

| Action checked | Old → new mapping | Result / evidence |
|---|---|---|
| Account details | Dialog → DetailDialog, UserRound heading | Standardized; R |
| Create account | Custom overlay/form → FormDialog + existing secure provider | Original validation, temporary-password payload and identity acknowledgment retained; R/U for account service |
| Edit account | Custom overlay/form → FormDialog + existing secure provider | Original submission retained; explicit dirty discard; R/U |
| Block / unblock / delete account | Provider custom shell → shared security/confirm/result shells | Server verification/grant/execute unchanged; block/delete danger styling; B/U for provider contract |
| Reset password | Bespoke overlay → FormDialog | Validation/callback unchanged; still unreferenced, no API invented; R exception |
| Start application review | Existing provider → shared provider presentation | review-loan action/payload unchanged; R/U |
| Approve application | Existing provider → shared provider presentation | No approval-state/security changes; B tests approve-loan verify/execute success/failure and role gate; U |
| Loan detail/history | Custom overlay → DetailDialog | Same reads, nested actions and payment display; bounded scrolling; R |
| Application attachments | Dialog → DetailDialog | Same signed-link service/access; R/U |
| Release input/acknowledgment | Dialog + inline form → FormDialog | Existing approved/date/acknowledgment guards; dirty date/reference/notes protected; B/P/U |
| Release review/execute | Inline panel → compact ConfirmActionDialog | Member/application, exact principal/fees/net proceeds/rate/date/reference; same RPC and retry UUID; B/P/U |
| Release success/failure | Inline success → ActionResultDialog; error retained in confirmation | Result only after resolved backend response; failure preserves correction/retry; B/P/U |
| Payment ledger | Dialog → FormDialog | Admin read / Super Admin write gates retained; R/P |
| Payment preview | Inline review → compact ConfirmActionDialog | Same preview service, PHP amount, date, receipt, allocation and member/application identity; B/P/U |
| Record receipt | Inline CTA/result → shared confirm/result | Exact amount/allocation/idempotency retained; failed response never shows success; B/P |
| Reverse payment | Inline danger panel → destructive ConfirmActionDialog | Reason length, receipt/amount/date, identity, audit/refund consequence, same backend function; R/P |
| Active/audit record details | Dialog → DetailDialog | Existing RecordsView/menu route and role behavior retained; R/U |
| Announcement details | Extra portal wrapper → DetailDialog | Same details and status-specific actions; R/U |
| Create/edit/save draft | Custom wrapper/discard footer → FormDialog/shared discard and confirm | Same validation/payload/version; adds visual confirmation to draft save; R/U/P |
| Publish/schedule/reschedule | Inline review → ConfirmActionDialog | Same Manila scheduling/capability/notification rules and API; R/U/P |
| Archive/restore/cancel schedule | Wide confirmation → compact ConfirmActionDialog | Warning for archive/cancel, green restore; API/version checks retained; R/U/P |
| Delete draft | Wide confirmation → destructive ConfirmActionDialog | Existing private/never-published restriction retained; R/U/P |
| Announcement result | Custom inline notice → ActionResultDialog | Only existing resolved-save/action callbacks create notice; R/U/P |
| Upload document | Plain page feedback → shared actual result | Same multipart POST; duplicate-submit latch; R/U |
| Delete document | window.confirm → destructive ConfirmActionDialog/result | Same DELETE/id and privilege/source gates; cancel sends nothing, error stays open; B/U |
| View/download document | Existing signed links retained | No mutation or approval added; R/U |
| Reload dirty profile | window.confirm → ConfirmActionDialog | Cancel keeps draft; explicit discard reloads; R/U |
| Save/discard profile | Inline form retained; ActionFeedback | Same validation/PUT and refresh behavior; R/U; intentional inline exception |
| Own password/email | Inline forms retained; ActionFeedback and submit latches | Current-password server checks, password validation and email confirmation unchanged; B for password validation/double-submit, U for both endpoints; intentional inline exception |
| Switch admin/reload privileges | window.confirm → explicit pending-intent confirmation | No selection/reload until confirmed; cancel preserves draft/password; R/U |
| Save privileges | Inline save → warning review + ActionFeedback | Original password/version endpoint and role gate retained; duplicate-submit latch; R/U |
| Loan policy | Existing provider → shared provider; ActionSummary/Feedback | Exact payload preserved; review displays all policy fields and processing time; R/U |
| General settings | Immediate save → visual ConfirmActionDialog + ActionFeedback | Same permission/validation/POST/event; no new approval state; R/U |
| Sign out other sessions | window.confirm → warning ConfirmActionDialog | Same Supabase scope others call; actual error/success feedback; R |
| Snapshot export | Existing read/export retained; ActionFeedback | Same five resources and file format; duplicate-submit latch; R/U |
| Legacy backup/restore/session revoke | Bespoke overlays → disabled shared confirmations | Unreferenced, no service; clearly unavailable, no fake success or new endpoint; R exception |
| Legacy settings/features/profile | Local-only forms → clearly labeled disabled previews | GeneralSettings, EmailConfiguration, FeatureToggles, Security, ProfileForm; no console logging of profile; R exception |
| Send/schedule notifications | Existing provider → shared secure UI | Existing role/privilege restrictions and dedicated API retained; R/B provider/U |
| Incoming history | Custom expanded modal → ActionDialog | Recent alerts remain anchored nonmodal popover; search/filter/read/refresh/navigation retained; B/U |
| Report/record export and print | Existing shared controls retained | No mutation dialog needed; R/U; intentional exception |
| Logout/account menus | Existing session/menu handlers retained | No session/permission behavior changed; R |
| Requested ActiveLoansTable | Already deleted → existing RecordsView path | No stale component restored; active-loan menus covered above; R exception |

## Files changed by this task

Existing user changes were present before this task. The following list describes this task's edits, not the entire `git diff` against HEAD.

- New shared components: `src/components/ui/ActionDialog.tsx`, `ConfirmActionDialog.tsx`, `ActionResultDialog.tsx`, `FormDialog.tsx`, `DetailDialog.tsx`.
- Existing shared UI: `src/components/ui/Dialog.tsx` (compatibility export of ActionDialog), `useDialogFocus.ts`, `Feedback.tsx`, `buttonStyles.ts`, `portal-ui.css`. Button itself and the legacy actionButtonStyles adapter continue using the same button tokens; warning is added to that system.
- Security: `src/components/auth/SecureAdminActionProvider.tsx` (shells, semantics-preserving trigger focus capture, destructive presentation).
- Members: `src/components/members/MemberDetailsModal.tsx`, `MemberFormModal.tsx`, `ResetPasswordModal.tsx`.
- Loans: `src/components/loan-applications/LoanDetailsModal.tsx`, `LoanDocumentsModal.tsx`, `LoanReleaseDialog.tsx`; `src/components/active-loans/CounterPaymentDialog.tsx`.
- Announcements: `src/components/announcements/AnnouncementDialog.tsx`, `AnnouncementEditor.tsx`; `src/app/(admin)/announcements/page.tsx`.
- Documents/records: `src/components/documents/DocumentManager.tsx`, `src/components/shared/RecordsView.tsx`.
- Profile: `src/components/profile/ProfileWorkspace.tsx`, `PasswordSection.tsx`, `EmailChangeSection.tsx`, `ProfileForm.tsx` (disabled unused preview).
- Settings: `src/components/settings/RolesPermissions.tsx`, `PortalSettings.tsx`, `LoanPolicy.tsx`, `Backup.tsx`, `Security.tsx`, `GeneralSettings.tsx`, `EmailConfiguration.tsx`, `FeatureToggles.tsx`.
- Notifications: `src/components/shared/notifications/NotificationPopover.tsx`.
- Verification: `tests/fixtures/action-dialogs.tsx`, `scripts/action-dialogs.test.mjs`, this report and four PNGs in `docs/action-ui-screenshots/`.

No task edits to API routes, financial/auth service libraries, database migrations, schema, RLS, dependencies, package scripts, or role route maps. Member/table action entry points inherit the shared provider and dialog changes.

## Tests and visual verification

| Check | Result |
|---|---|
| Baseline `npx tsc --noEmit` and `npm run lint` | Passed before edits |
| First low/high-risk examples | TypeScript, targeted lint, 3 existing protected-action tests passed before remaining migrations |
| Existing suite | 115 passed, 0 failed, 0 skipped; includes mocked API/auth tests and isolated PostgreSQL/PGlite financial/announcement tests |
| New browser suite | 8 passed, 0 failed; real components + compiled app CSS; mocked transport only |
| Browser assertions | Cancel/no mutation, backend errors/no false success, single execution on double click, required field validation, role/privilege restrictions, focus trap/restore, nested layers, unsaved discard, secure stage sequencing, release acknowledgment/amount/retry ID, payment allocation/amount/retry ID, notification modal/popover transition |
| Responsive QA | 390×844 mobile and 1366×768 desktop; internally scrolling long forms and visible footer/header; screenshots inspected |
| Source preservation checks | Secure authorization/verify/execute/callback code identical apart from visual trigger capture; release/payment save/reversal/idempotency/eligibility code unchanged; member submission retained |
| Browser-native application prompts | No window.confirm/window.alert remains in src; only FormDialog beforeunload uses the browser's navigation warning |
| Production build | Initial run caught an introduced source-encoding issue; corrected. Subsequent optimized build passed including both admin route trees |
| Final TypeScript/lint/diff checks | Passed; the focus-ref lint warning found during iteration was corrected; no remaining warnings in task-targeted lint |

Commands: `npx tsc --noEmit`; `npm run lint`; `npm run build`; PowerShell: `$testFiles = @(rg --files src supabase/tests -g '*.test.mjs'); $testFiles += 'scripts/repair-demo-accounts.test.mjs'; node --test --test-concurrency=2 $testFiles`; browser: `node --test scripts/action-dialogs.test.mjs`.

Browser suite uses an installed Playwright package, or the existing Codex bundled Playwright fallback; `PLAYWRIGHT_MODULE` can point to another installed package. Windows defaults to headless Edge; `PLAYWRIGHT_CHANNEL` can override it. No dependency was installed. Windows sandbox could not launch Edge; isolated browser checks ran outside it with approval. Screenshots show synthetic test records, not authenticated production screens.

Screenshots: [desktop confirmation](action-ui-screenshots/desktop-confirmation.png), [mobile long form](action-ui-screenshots/form-390.png), [desktop long form](action-ui-screenshots/form-1366.png), [release review](action-ui-screenshots/release-review.png).

## Exceptions and remaining validation

- Live Supabase/Auth, real account mutations, real disbursements/receipts, delivery and scheduler execution were not run. Those remain deployment smoke tests with authorized test accounts/records; no live success is claimed.
- ResetPasswordModal remains an unreferenced callback form. Wiring a password-reset workflow is intentionally postponed; it would exceed presentation scope.
- Legacy backup/restore, session-policy, general/email configuration, feature switches and profile prototypes have no connected services. They are explicitly unavailable. Full backup/restoration remains in Supabase; the active snapshot export remains the existing limited JSON export.
- The recent notification surface intentionally remains a nonmodal anchored popover; its expanded center uses the shared modal.
- Own-profile/password/email actions remain inline forms with shared feedback. Existing server password/email checks are preserved; cosmetic confirmation does not replace them.
- FormDialog guards Escape, header/footer close and accidental backdrop dismissal, and registers beforeunload for dirty data. It does not add a new Next.js-wide SPA history/navigation blocker; background app navigation is inert while a modal is open. Dirty profile/privilege reload/switch guards are explicitly preserved.
- Keyboard and aria behavior were checked programmatically. Manual screen-reader testing and authenticated route screenshots are still recommended; they were not performed here.
- Existing Node tests emit MODULE_TYPELESS_PACKAGE_JSON warnings. No package/module-mode change was introduced to suppress them.
