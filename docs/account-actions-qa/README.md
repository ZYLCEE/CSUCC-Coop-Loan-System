# All Accounts action flow update

Church reference: the four supplied menu screenshots and `Church Management.zip` (`admin/users.php`, `admin/privileges.php`, `css/admin-sidebar.css`). Presentation is recreated with the existing React dialog/button system. COOP server authorization remains authoritative.

| Account row | Current menu / behavior |
| --- | --- |
| Member | View Details, Edit, Reset Password, Block/Unblock, Delete. |
| Administrator | View Details, Edit, Reset Password, Role & Privileges, Block/Unblock, Delete. |
| Signed-in Super Admin | View Details, Edit (existing Profile route). Identity uses Auth user ID, not email or row status. |
| Another Super Admin | View Details; protected Edit/Block/Delete shown disabled with explanation; Role & Privileges is read-only inherited access. No Reset Password. |
| Ordinary Admin / read-only actor | View Details only. |
| Unlinked/inconsistent account | No newly enabled mutation actions. |

Reset Password uses the existing secure action provider: temporary password form → server password/grant verification → final confirmation → actual server result. The temporary password is passed via the existing secret field and omitted from review details. Verification cancellation and failures retain the form; successful backend response refreshes the accounts list. The server's forced password-change behavior is unchanged.

Administrator privileges use the existing `/api/admin/privileges` GET/PUT contract and four existing delegated permissions. The dialog requires the acting Super Admin password and final review; the existing API performs password verification, active-role/version checks and auditing. This is the existing privilege service rather than a new provider action. Role changes remain in Edit for ordinary accounts. Failed saves retain choices; closing a dirty form requires discard confirmation. Inactive Admin privilege editing remains unavailable.

Presentation changes: rounded white action menu, consistent slate icons and row spacing, full-row semantic red Delete, shared dialog headers/backdrops/footers and buttons. Existing View/Edit/Create/Block/Delete dialogs and security provider are reused.

## Verification scope

`scripts/account-actions-previews.mjs`, run through the existing `scripts/action-dialogs.test.mjs` harness with `COOP_ACCOUNTS_QA=1`, renders the **real All Accounts page and its components** with synthetic records and mocked account/security/privilege services. No Chrome control, real credentials, hosted decisions or account mutations are used. Screenshots are isolated previews, not authenticated application evidence.

The preview checks all four menus, keyboard menu navigation/focus restoration, View/Edit, self-Profile navigation, Super Admin read-only privileges, password mismatch, unsaved-change handling, verification cancellation/failure, final confirmation, duplicate-submit protection, backend failure/retry, confirmed success and list refresh, privilege confirmation/error/retry, ordinary actors and inactive Admin targets. Dialog bounds, body overflow and footer visibility are checked at 1366×768, 768×1024 and 390×844. Captures and measurements are in `screenshots/`.

Representative captures:

- [Administrator menu, desktop](screenshots/menu-sample-administrator-1366.png)
- [Other Super Admin menu, mobile](screenshots/menu-other-super-admin-390.png)
- [Reset form, mobile](screenshots/reset-password-390.png)
- [Admin privileges, desktop](screenshots/admin-privileges-1366.png)
- [Reset final confirmation](screenshots/reset-confirmation-1366.png)
- [Reset error](screenshots/reset-error-1366.png)
- [Reset result](screenshots/reset-success-1366.png)

Manual verification remains: signed-in localhost:3000 layout within the actual portal, live account-service availability and authorization, privileged form operations using designated disposable test accounts, and password delivery/forced-change behavior. Do not execute real account mutations solely for screenshots.

Super Admin policy proposal: [account-actions-policy-review.md](../account-actions-policy-review.md). Protected mutations remain disabled pending separate review and implementation.

## Final checks (November 10, 2026)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed after correcting a test-local variable name; final targeted lint also passed. |
| `npm run build` | Passed on the final presentation code. |
| All `src/**/*.test.mjs` | 123 passed, 0 failed. Existing Node module-type warnings remain. |
| `node scripts/action-dialogs.test.mjs` | 11 existing browser regression tests passed, 0 failed; all services mocked. |
| `COOP_ACCOUNTS_QA=1 node scripts/action-dialogs.test.mjs` | Passed all account scenarios at three viewports; 54 captures, 42 dialog measurements, no failed bounds/overflow/footer checks. |
| Account presentation helper | 4 tests passed, including self-ID, stale status, protected targets and read-only actors. Included in the 123 above; rerun after lint correction. |
| Scoped `git diff --check` | Passed; existing LF/CRLF normalization warning only. |
| Actual authenticated Chrome/account mutations | Not tested in this task; no Computer Use or live operations. |

## Files changed in this task

Production:

- `src/app/(admin)/members/page.tsx` — existing reset service and privileges dialog wiring.
- `src/components/members/MembersTable.tsx` — category-specific menu and Church-inspired presentation.
- `src/components/members/ResetPasswordModal.tsx` — account-neutral wording and busy controls.
- `src/components/members/accountActions.ts` — explicit presentation availability map (new).
- `src/components/members/AccountPrivilegesDialog.tsx` — existing Admin privilege API presented in shared dialogs (new).

Verification and documentation:

- `src/components/members/accountActions.test.mjs` (new).
- `scripts/account-actions-previews.mjs` (new).
- `scripts/action-dialogs.test.mjs` — extends existing isolated harness with account/privilege mocks.
- `tests/fixtures/action-dialogs.tsx` — real All Accounts preview entry.
- `tests/fixtures/accounts.json` (new synthetic records).
- This report, `screenshots/*.png`, `screenshots/metrics.json`, and `docs/account-actions-policy-review.md`.

Both `/admin/all-accounts` and `/super-admin/all-accounts` use the same existing MembersPage route mapping; actor-specific action visibility is retained. Pre-existing working-tree changes are preserved. No backend/API contract, authentication, authorization, schema, RLS, financial calculation or financial workflow was changed or deployed by this task.
