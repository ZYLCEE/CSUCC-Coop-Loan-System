# Phase 2: Committee Accounts

The Super Admin can open **Committee Accounts** to invite individual CRECOM reviewers, manage membership dates and titles, deactivate/reactivate memberships, inspect assignment history, and request personal setup/reset links. BOD accounts require the latest effective approved workflow policy to enable BOD.

Reviewers sign in through the existing login page and are routed to /crecom/dashboard or /bod/dashboard. Their portal contains assigned cases, pinned review packet files, their own notifications and decision history, and personal profile/password settings. No sample users or cases are created in production.

Account mutations require a current Super Admin password on the server. The database mutation functions and actor proxy are inaccessible to browser sessions. Membership, current trusted identity, policy, assignment and file-version access are rechecked in database functions and storage policies. Existing signed file URLs expire within five minutes; deactivation prevents issuing new ones.

Invitations use Supabase Auth email setup links. Each reviewer chooses their own password. Configure the deployed site URL and allow /auth/committee-setup in Auth redirect URLs; the login page also handles default invite/recovery callbacks. A valid SMTP sender and sufficient provider email allowance are required. Email delivery has not been tested against real recipients.

The review-cycle, assignment and immutable decision tables are read foundations. Forwarding, assignment creation, voting, clarification handling, reassignment, group outcomes and final approval are the next phase. Pending CSUCC governance rules remain explicit; this phase does not invent voting thresholds or enable BOD through a draft.

## Validation

- Node tests: src/lib/committee.test.mjs and scripts/committee-account-list.test.mjs.
- Isolated browser: set COOP_COMMITTEE_QA=1, then run node scripts/action-dialogs.test.mjs.
- Run node scripts/prepare-committee-sql-test.mjs, then execute the generated staging SQL. It installs schema and synthetic fixtures inside a transaction ending in ROLLBACK.
- TypeScript and targeted ESLint checks.

Only supabase/migrations/20261110_committee_access.sql belongs in production. The bootstrap, server fixture, test cases and generated rollback script must never be used as a production migration.

## Deployment verification — November 11, 2026

The Phase 2 database migration is applied and matches the canonical backend copy. The list-admin-accounts function is deployed as version 7 with platform JWT verification enabled. Production has zero committee memberships, invitation jobs, review cycles, assignments and decisions after deployment.

The optimized Next.js build, TypeScript, targeted ESLint, committee unit/API tests, account-list tests, synthetic browser checks and existing protected-dialog regressions passed. The staging transaction tested invitation provisioning/retries, service-only mutation boundaries, date expiry, revision conflicts, reset-link cooldown/replay, recipient privacy, file-version scope, revocation and conditional BOD access, then rolled back all fixtures.
