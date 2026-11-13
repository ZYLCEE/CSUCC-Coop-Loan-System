# Return incomplete applications

The connected database had the newer return procedure, including initialization
before Start checking, but retained the older committee status guard. The return
transaction set verification to `returned_for_requirements`, then failed while
changing the loan status to `returned`. The whole transaction rolled back with
the enrolled-application error.

Migration `20261112100000_allow_requirements_return_transition.sql` adds only
that missing transition. It requires Pending or Under Review status, a trusted
workflow procedure, an authenticated staff actor with `applications.return`, a
verification record already in `returned_for_requirements`, and no final
decision. It does not require complete documents, consent or committee approval.
The existing password verification, correction reason, atomic notification,
review invalidation, retry identity and activity log remain in the return path.

The migration was applied individually to the connected project on November 12,
2026, using a single-file SQL query. Other pending migrations were not applied.
The deployment did not return or otherwise modify an application. This direct
application does not add a Supabase migration-history entry; the migration is
idempotent when later applied by the normal migration runner.

Validation:

- `node scripts/requirements-return-sql.test.mjs` reproduces the exact guard
  failure, then executes the real return procedure with the fixed guard in
  isolated PostgreSQL. Pending, unstarted and Under Review incomplete cases
  succeed. Notifications, outbox, logs and retries remain atomic. Stale data,
  unauthorized users, direct table writes and final decisions remain protected.
- 22 focused API/model tests passed, including the acting-account password check.
- Targeted ESLint and whitespace checks passed.
- `verification.json` confirms the installed guard matches the tested migration;
  both the mutation and service dispatcher were preserved exactly. The hosted
  mutation also matches the offline test source. `LA-2026-447641` remained Pending
  after verification.

To return a missing requirement, choose **Application information / missing
requirements** or **Consent or witness evidence**, write the member's correction
instructions, and confirm using the acting account's password. Use **Uploaded
documents need replacement** for files already submitted that require replacing.
