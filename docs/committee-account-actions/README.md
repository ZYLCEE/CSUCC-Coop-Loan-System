# Committee account actions

Implemented for CRECOM Member 1, CRECOM Member 2, CRECOM Chairperson and BOD Chairperson using the existing Next.js/React/Tailwind/Supabase framework.

The three-dot menu matches All Accounts: View Details, Edit, Reset Password, Block/Unblock and Delete. Incomplete creation requests retain Retry creation. Admins need the existing committee.accounts.manage permission; Super Admin retains access.

## Password reset

1. Select Reset Password and enter a temporary password, matching confirmation and reason.
2. Verify the acting administrator's own password.
3. Review the account and confirm Reset Password. Passwords are not displayed in the summary.
4. Share the temporary password privately. The reviewer signs in with their registered email and that password, then chooses a different personal password before opening their portal.

Both password entries and the administrator password have independent visibility buttons. Temporary passwords use the existing committee password policy.

The server checks permission and the administrator password before executing. A private SQL reservation serializes changes, binds retries to an HMAC fingerprint without storing passwords, and suspends access while Auth updates. Reset completion clears the personal-setup timestamp; failed requests remain safely suspended and can be retried or replaced. Completed retries do not overwrite a personal password already chosen after the reset. Multiple-membership identities fail closed for reconciliation.

## Other actions

- View Details shows the reviewer and assignment history.
- Edit preserves existing numbered positions, role/date validation and reassignment rules; full-name changes now synchronize with Auth.
- Block uses the existing membership-access control and records a reason; Unblock restores access subject to membership dates and policy.
- Delete requires a reason, administrator-password verification and final confirmation. It removes sign-in access using server-side Auth soft deletion. Reviewer IDs, assignment history and immutable decisions remain recorded. Open reviews must be reassigned.
- Only completed reset/delete actions create successful activity records. Operational failure/retry state is private and does not create a completed activity entry.

## Database activation pending

Apply only `supabase/migrations/20261112060000_committee_account_actions.sql` after project-owner deployment approval. It adds the private action ledger, safe suspension/deletion markers, service-only functions and a capability version. The UI enables Reset/Delete only when the connected database reports this capability. No existing account is reset or deleted by the migration.

A read-only check of the linked Supabase project on November 12, 2026 confirmed that the credential-action functions are not enabled. No remote migration or account mutation was performed.

AGENTS.md requires: "Do not push or deploy unless the project owner asks."

## Validation

- 224 source tests passed; `source-tests.txt` records the result.
- TypeScript, targeted ESLint and optimized Next.js build passed.
- Isolated Edge checks passed for the exact menu, details/edit, temporary-password validation and independent visibility, verification before final confirmation, wrong-password handling, retry IDs, Block/Unblock/Delete, disabled capabilities, desktop/mobile layout and existing committee portal regressions.
- Local PostgreSQL checks passed for migration syntax and behavior, permission denial/revocation, BOD reset suspension, provider receipts, duplicate/stale/lease checks, failed-action replacement, multiple-membership denial, real name editing, Block/Unblock, deletion retries after Auth scrubbing, deleted-account filtering and retained decisions.
- Screenshots were captured under `screenshots/` using synthetic fixtures.

SQL checks use an isolated PostgreSQL WASM runtime, without connecting to Supabase. To reproduce:

```powershell
npm install --prefix node_modules/.committee-sql-qa --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.16
node scripts/committee-account-actions-sql.test.mjs
```

No project runtime dependency was added.

References: [Supabase server-side password updates](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid), [Supabase irreversible Auth soft deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser), [PGlite local PostgreSQL runtime](https://pglite.dev/docs/).
