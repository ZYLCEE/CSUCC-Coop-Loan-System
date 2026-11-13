# Loan release compatibility

The connected database has `release_approved_loan`, but not the newer
`loan_release_action` dispatcher. The application incorrectly treated the missing
dispatcher as a missing release workflow and blocked an approved loan.

The release API now verifies the current administrator's password and
`loans.release` permission, then attempts the service-only dispatcher as before.
Only a PostgREST missing-function response (`PGRST202`) selects the existing
`release_approved_loan` procedure using the verified caller's JWT. Permission
errors, failed transactions, missing inner SQL dependencies and ambiguous
timeouts never select a second path. Both paths use the same release request ID.

The existing procedure enforces active Super Admin access and saves the release,
policy rates, fees, and activity record atomically. The enrolled-application
trigger requires an approved final decision. The procedure preserves date and
amount validation, unique references, and idempotent retries. No direct table
updates, new database privileges, migration, or hosted deployment are part of
this fix. The newer dispatcher remains preferred when it is installed.

Validation:

- `node --test src/lib/committeeReview.test.mjs`: password and permission checks,
  both RPC paths, strict fallback conditions, validated arguments, and failure
  propagation.
- `node scripts/loan-release-compatibility-sql.test.mjs`: offline PostgreSQL
  execution of the existing migration's release procedure and committee guard;
  checks final approval, snapshots, retries, duplicates, bad dates and amounts,
  and full rollback if the activity record cannot be saved. Requires the ignored
  PGlite installation used by the other committee SQL checks.
- `read-only-verification.json`: confirmed hosted release and guard logic matches
  the offline sources (one approval-date error has different wording). The affected loan was approved and unreleased. Hosted
  verification only read catalog and application data; it did not release it.

Refresh Loan Applications, reopen the release form, and confirm the release with
the acting account's password when the disbursement is ready to be recorded.
