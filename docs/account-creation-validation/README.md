# Create Account inline validation — November 10, 2026

Updated the existing COOP account form using the Church screenshots and `admin/users.php` as presentation references. Validation now belongs to each input. The separate password checklist and form-wide error-summary box were removed.

| Input | Guidance and validation placement |
| --- | --- |
| ID Number | Read-only preview guidance, loading/error and Retry directly below the field. Final ID is still allocated by COOP's server. |
| Full Name | Capitalization/example and length guidance; existing name-format errors below the input. |
| Email Address | Email example/limit; live format errors below the input. No claim that an email is available before server validation. |
| Contact Number | Digit-count/format guidance and existing format errors below the input. |
| Address | Required address guidance and existing length/required errors below the input. |
| Role | Role-selection guidance and applicable validation below the select. Existing role choices and backend restrictions are unchanged. |
| Membership Type | Member-only selection guidance and required errors below the select. |
| Department | Regular-Member-only guidance and required/length errors below the input. The frontend now mirrors the existing server's 200-character maximum. |
| Temporary Password | Existing uppercase/lowercase/number requirements immediately below; Weak/Fair/Strong advisory feedback below that. The frontend now mirrors the existing server's 128-character maximum. |
| Confirm Temporary Password | Mismatch errors or “Passwords match.” immediately below. Changing the original password revalidates the confirmation. |
| Identity acknowledgment | Existing required acknowledgment retained; its own hint/error sits below the checkbox. |

Password fields stay paired at wider sizes and stack on mobile. Only the custom visibility button is shown in each field, including Edge. Shared COOP field/error/button styles, responsive scrolling, fixed footer actions and dirty-close protection remain in use. Error/help text is connected with `aria-describedby`, invalid controls use `aria-invalid`, and programmatic invalid submission focuses the first invalid input without sending a request.

Password strength is a visual guide, not a new password policy or extra submission gate. Existing minimum requirements still determine validity; the backend remains authoritative. The indicator conservatively considers length, variety and a few obvious predictable patterns. It is not an entropy estimator and is not stored or sent to the backend.

COOP has no username in this account form, so no Church username field or database column was introduced. Private credential delivery remains COOP's current behavior; no automatic email delivery is claimed. The pre-existing Super Admin creation choice is still subject to the existing deployed backend restriction; this task does not enable new Super Admin creation or account-management permissions.

## Security flow retained

Valid form and identity acknowledgment → acting Super Admin password verified through the existing secure action provider/server → bound grant → final confirmation → existing account creation service → confirmed result. Temporary credentials use the existing secret field and are absent from review details and the ordinary payload. Cancel never executes, repeated clicks are guarded, failed verification/creation preserves form values, and confirmed success refreshes All Accounts.

No backend implementation, API endpoint, authentication/authorization policy, database, financial logic or hosted deployment was changed by this follow-up. No real accounts were created or changed.

## Verification

- TypeScript, lint, production build and scoped diff checks passed.
- 141 source/backend/security/deployment tests passed, including Create/Edit/Reset verification and grant denial tests.
- 11 existing isolated browser regressions passed, including security, dirty-close, release, payment and reversal scenarios.
- New real-component Create Account tests passed at 1366×768, 768×1024 and 390×844. They verify helper/error placement, valid/invalid formats, dynamic membership fields, advisory strength, password matching, required identity acknowledgment, visibility controls, unsaved-change protection, password verification, cancel, errors/retry, double-submit protection, secret/payload separation, delayed success and list refresh.
- Success timing is verified by explicitly holding and releasing a mocked response. An initial timing-dependent assertion was replaced with this deterministic check; final runs pass.
- 9 before and 33 after synthetic screenshots; no failed viewport, horizontal-overflow or footer-visibility checks. Password label visibility/alignment is checked too.
- These are isolated renders of actual components with synthetic records and mocked services. No live authenticated account creation was tested; existing Chrome was not controlled.

## Screenshots

| State | Before | After |
| --- | --- | --- |
| Initial form, desktop | [Before](screenshots/before/create-initial-1366.png) | [After](screenshots/after/create-initial-1366.png) |
| Invalid fields, desktop | [Before](screenshots/before/invalid-fields-1366.png) | [After](screenshots/after/invalid-fields-1366.png) |
| Weak/mismatched passwords | [Before](screenshots/before/weak-password-1366.png) | [After](screenshots/after/weak-password-1366.png) |
| Mobile validation | [Before](screenshots/before/weak-password-390.png) | [After](screenshots/after/weak-password-390.png) |

[Strong password and match feedback](screenshots/after/strong-password-1366.png), [Super Admin password](screenshots/after/super-admin-password-1366.png), [final confirmation](screenshots/after/final-confirmation-1366.png), [held response/loading](screenshots/after/waiting-for-response-1366.png), [server error](screenshots/after/server-error-1366.png), [confirmed synthetic result](screenshots/after/success-1366.png).

## Changed files

- `src/components/members/MemberFormModal.tsx` — presentation, inline associations and matching existing server bounds.
- `scripts/account-creation-previews.mjs` — new isolated rendering/tests/captures.
- `scripts/action-dialogs.test.mjs` — creation test mode and controlled mocked response.
- `scripts/account-reasons-backend.test.mjs` — includes Create Account in existing password/grant denial checks.
- This report and its screenshots/measurement artifacts.

Pre-existing working-tree changes are preserved. Manual follow-up is limited to checking the refreshed Create Account screen in the actual authenticated portal and, when appropriate, authorized account creation using designated disposable test accounts.
