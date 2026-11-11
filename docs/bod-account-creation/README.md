# BOD account provisioning

The account-creation modal rejected a valid BOD Chairperson when no approved,
effective workflow policy enabled BOD review. The same policy check also blocked
membership activation, setup links, personal password setup and portal admission.

`20261112001000_bod_account_provisioning.sql` separates those account lifecycle
operations from loan review activation. Account creation still requires a
password-verified Super Admin or an explicitly authorized Admin, a validated BOD
Chairperson appointment, trusted Auth metadata and a matching provisioning request.
Personal setup, current membership dates, account status and role checks remain.

The roster now shows the actual account status (including password setup pending).
The management page and BOD portal explain when loan reviews await policy
activation. `portal_session_access.reviewEnabled` reports review readiness separately
from account admission.

Loan review protections remain: `committee_reviewer_available` still checks the
BOD policy, and `committee_assignment_eligible` now checks it explicitly before
opening existing packets. Review routing, CRECOM approvals, BOD decisions, final
approval and loan release procedures are unchanged. This migration creates no
policies, memberships, accounts, assignments or decisions.

Validation:

- `node --test src/lib/committee.test.mjs src/lib/committeeSetup.test.mjs`
- `COOP_COMMITTEE_QA=1 node scripts/action-dialogs.test.mjs`
- targeted ESLint, TypeScript and production build
- `node scripts/prepare-bod-account-test.mjs` generates the database regression
  transaction in `rollback-validation.sql`. It tests synthetic BOD creation and
  retry, personal setup, membership changes, setup links and roster state while
  policy is disabled. It also proves BOD assignment and packet access stay blocked
  until the policy gate allows review. All fixture data and the test-only policy
  helper override are rolled back; no real passwords or accounts are changed.

`database-baseline.json` contains the deployed function definitions captured before
the fix, including the unchanged BOD reviewer policy gate. It contains no user data
or credentials. Regenerate the migration from this snapshot with
`node scripts/prepare-bod-account-fix.mjs`.

## Stalled creation and duplicate emails

The follow-up loading report used an email already registered to a completed
CRECOM account. A fresh BOD creation must use a different email. The existing
account's role and password are not changed by this repair.

The form now checks loaded committee accounts for email conflicts before asking
for administrator confirmation. The database also returns an explicit existing-role
conflict for stale rosters and other registered accounts. Reservations use a
nonblocking email lock and NOWAIT for an already-locked request row.

The client bounds session lookup, HTTP and response parsing to 60 seconds; the
management POST bounds the entire action to 40 seconds. Auth and database fetches
have a 15-second timeout and inherit cancellation from the action. Late session
lookups cannot send a creation after the form has timed out. A timeout reports an
uncertain result and asks the administrator to refresh the roster before retrying
the saved request. The same request ID is preserved to prevent duplicate accounts.

Follow-up checks include 30 API/auth/transport tests, browser tests for duplicate
email and timeout recovery, and the rolled-back database regression in
`request-feedback-rollback.sql`. Generate the SQL repair and regression transaction
with `node scripts/prepare-committee-request-fix.mjs`.
