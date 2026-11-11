# Member account action flow — November 10, 2026

Local UI and backend implementation complete. **The explicitly approved function is deployed as ACTIVE version 10 with JWT verification enabled.** Its source matches the approved checksum. The user confirmed in existing Super Admin Chrome that both Member Block/Delete reason forms enable Continue and open the Super Admin password step. This confirms the frontend capability gate in an authenticated session. No real account, loan, payment or release operation was performed by the agent for verification.

## Resulting flow

| Action | Flow |
| --- | --- |
| View Details | Read-only Personal, Contact and Account Information → Close. No password or mutation request. |
| Edit | Existing COOP fields and validation → acting Super Admin password/grant verification → review changes → server execution/result. Failed submissions preserve edits. |
| Reset Password | Temporary password + matching confirmation → acting Super Admin password/grant verification → final review → server execution/result. Temporary password stays out of review details. COOP's existing forced password change and private credential delivery remain unchanged. |
| Block | Required audit reason + account summary → acting Super Admin password/grant verification → final reason review → server execution/result. |
| Delete | Required audit reason + account summary → acting Super Admin password/grant verification → final reason review → existing server deletion/result. This does not adopt Church's soft-delete workflow. |
| Unblock | Existing password/grant verification → confirmation → server result. No newly required reason for this existing action. |

Church reference: supplied screenshots and `Church Management.zip/admin/users.php`. COOP keeps the existing security-provider order, role rules, authorized data sources and action endpoints. The new optional provider properties affect presentation only; they are not sent in API payloads or security-grant fingerprints. No DOB, sex, split address, username or other unavailable Church field is invented.

The required Block/Delete reason also applies when the existing authorized account service targets an ordinary Administrator. Super Admin targets remain protected; no Super Admin management policy has been enabled.

## Auditing and compatibility

- Existing `admin_activity_logs` fields are reused; **no SQL migration** or new table is needed.
- Mandatory reason: trimmed, nonempty, maximum 2,000 UTF-16 code units, consistently checked by client and server. The reason is part of the existing payload fingerprint, bound to actor/action/target and the single-use grant.
- After server authentication, grant consumption and target/self/role checks, an `authorize:block-account` or `authorize:delete-account` event records the trusted actor, target, reason and correlation ID **before** any account mutation. It explicitly records `phase: authorized_request` and `operation_completed: false`. It is not an operation-success claim. If this audit insert fails, the account operation does not run.
- The existing operation's success audit includes the same reason/correlation ID and `phase: completed`. Existing failure logging and profile/Auth compensation remain in place. A successful authorization event alone does not mean Block/Delete succeeded.
- The existing cross-service Auth/profile operation is not made transactional by this change. A failure writing the final outcome audit can still follow an account update; the prior authorization event preserves the reason and the UI receives an error. No false success is shown.
- Reasons remain internal administrative audit data. No new member notification, email delivery, mobile status flow or reason visibility rule is introduced.
- The frontend probes `mode: account-action-reason-capability`. Missing/incompatible support disables Continue and offers Retry; it never submits a reason to an old backend that would silently discard it.

## Deployment approval scope

Target: **CSUCC-Coop-Loan-System / `jhgsqvxlvwhrwpcekvpq`**, existing **`secure-admin-action`** only.

The hosted source was downloaded read-only and byte-matched to saved version 9: raw SHA-256 `aff0914457049f8d6bcaf55fc2193d7293ac3c959981788dca249631d45cf4da`. The function listing confirmed ACTIVE/version 9/`verify_jwt: true`.

Proposed implementation SHA-256: `983fd1825e0194595a0691c352c1703857fb47e0371b6ef1db0d8a98e0712a4e`. See `deployment-manifest.json` and `secure-admin-action-proposed.ts.txt`.

The bundle is derived from canonical `coop_backend`, with its unrelated, previously undeployed Super Admin creation change excluded. Automated comparison proves it is exactly version 9 plus the reason validation, capability response and audit additions. Approval/rejection/release/policy calculations, authentication guards, grants, JWT verification and protected Super Admin/self checks remain unchanged.

Exact deployment command, **executed successfully after explicit scoped approval**:

```powershell
npx supabase@3.1.0 functions deploy secure-admin-action --remote=jhgsqvxlvwhrwpcekvpq --workdir node_modules/.cache/coop-account-reasons-deploy --use-api --yes
```

Before executing, recheck that the hosted baseline is still version 9 with the approved source; stop for any mismatch. Do not run a database push, migration, reset, data repair or any real account/financial operation.

Risks: this replaces the shared function used by protected actions. Older browser tabs that submit Block/Delete without a reason will receive a validation error and need refresh. Reason support is unavailable in the updated frontend until this deployment succeeds. Other shared branches are pinned and regression-tested.

Recovery point: exact hosted version-9 source and entry wrapper are preserved in `hosted-source/` as `.txt` review artifacts, with a ready JWT-verified rollback bundle. No database backup/restore is required for this code-only deployment. Existing audit data must remain intact.

Scoped recovery command, only if authorized deployment verification fails:

```powershell
npx supabase@3.1.0 functions deploy secure-admin-action --remote=jhgsqvxlvwhrwpcekvpq --workdir node_modules/.cache/coop-account-reasons-rollback --use-api --yes
```

After deployment: inspect function status/JWT configuration, download and compare deployed source to the approved bundle, confirm the capability contract through an authorized Super Admin session, and perform only non-mutating modal checks. Reject unauthenticated/ordinary Admin/Member authority; do not block/delete real accounts to test the deployment. Live authenticated Chrome access remains unavailable to the automation tools, so the user's existing Chrome session requires a manual check.

## Hosted deployment verification

- Targeted `secure-admin-action` only; version 10 is ACTIVE with `verify_jwt: true`.
- Downloaded deployed implementation SHA-256 matches the approved `983fd1825e0194595a0691c352c1703857fb47e0371b6ef1db0d8a98e0712a4e` exactly; canonical entry wrapper matches too.
- Real HTTP checks: missing/invalid user sessions return 401; localhost:3000 CORS preflight returns 200 with the expected origin; local All Accounts route returns HTTP 200. The route check does not prove authentication or rendered UI behavior.
- 13 backend/security regression tests rerun using the downloaded deployed source: passed with mocked services. No live account mutation was used to test reasons or auditing.
- Authenticated Super Admin capability and reason/password UI: user confirmed both Member Block/Delete reason forms and password steps work in existing Chrome after reload. This was a non-mutating check, not a live password-verification or account-execution test. Ordinary Admin/Member denial is tested locally against deployed code and the actual hosted authorization guard is unchanged; no live ordinary-account credentials were used.
- No SQL, database push/reset, real account mutation, financial operation or rollback was executed. Source/configuration and HTTP checks passed, so recovery was unnecessary. See `deployment-result.json`.

## Local and isolated verification

- `npx tsc --noEmit`, `npm run lint`, and `npm run build`: passed. An initial build caught Deno review snapshots with `.ts` extensions; those snapshots were renamed `.ts.txt` and the checks passed without changing the app's TypeScript configuration.
- 141 source/backend/security/deployment tests passed, 0 failed. Includes all source tests, new reason validation/audit/grant tests and existing rejection deployment regressions. Existing Node module-type warnings remain.
- 11 existing isolated browser regressions passed, including security-provider, approval, release, payment and reversal behaviors with mocked services.
- Member action browser scenarios passed at 1366×768, 768×1024 and 390×844: View performs no mutation; Edit/Reset/Block/Delete require password/grant and final confirmation; cancellation never executes; whitespace/missing reasons fail; duplicate execution is prevented; errors preserve form values/reasons; confirmed results refresh the list. Ordinary actor controls and missing capability fail closed.
- 90 synthetic after captures; 78 dialog measurements; no failed bounds, horizontal-overflow or footer-visibility checks. Nine prior synthetic captures retained under `screenshots/before/`. These are isolated previews of real components with mocked services, not authenticated application testing.

Representative comparisons:

| View | Before | After |
| --- | --- | --- |
| Details, desktop | [Before](screenshots/before/member-details-1366.png) | [After](screenshots/after/member-details-1366.png) |
| Edit, desktop | [Before](screenshots/before/member-edit-1366.png) | [After](screenshots/after/member-edit-1366.png) |
| Password verification | [Before](screenshots/before/reset-verification-1366.png) | [After](screenshots/after/reset-verification-1366.png) |
| Block confirmation | [Before](screenshots/before/block-confirmation-1366.png) | [After](screenshots/after/block-confirmation-1366.png) |
| Delete confirmation | [Before](screenshots/before/delete-confirmation-1366.png) | [After](screenshots/after/delete-confirmation-1366.png) |

Additional mobile captures: [Reason](screenshots/after/block-reason-390.png), [Password](screenshots/after/block-verification-390.png), [Final confirmation](screenshots/after/block-confirmation-390.png), [Error](screenshots/after/block-error-390.png), [Result](screenshots/after/block-success-390.png).

## Changed files in this follow-up

Frontend: `src/components/members/MemberDetailsModal.tsx`, `MemberFormModal.tsx`, new `AccountActionReasonDialog.tsx`, `src/components/auth/SecureAdminActionProvider.tsx`, `src/app/(admin)/members/page.tsx`, new `src/lib/accountActionReasons.ts` and its tests.

Backend: canonical `../coop_backend/supabase/edge-functions/secure-admin-action/index.ts` only. Its wrapper remains unchanged. The older frontend-repository function is not a deployment source.

Verification/artifacts: `scripts/action-dialogs.test.mjs`, `scripts/account-actions-previews.mjs`, new `scripts/account-reasons-backend.test.mjs`, `scripts/prepare-account-reasons-backend.mjs`, this directory's source snapshots, manifest and screenshots. Pre-existing working-tree edits are preserved. No role expansion, RLS or financial changes are included.
