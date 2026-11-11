# Phase 3: Committee review and final authorization

Updated after review of the manual form: every loan requires two CRECOM members, one CRECOM chairperson and one BOD chairperson before Super Admin records the final decision. See [the signatory update](../committee-signatories/README.md) for the latest migration and setup steps. No live policy or reviewer account has been activated.

## Available flow

1. Save a complete policy draft with the cooperative's actual requirements and authorization references. Super Admin can review and activate that saved version after password confirmation.
2. Start and complete application verification, including current document reviews and genuine consent evidence required by the policy.
3. Open Loan Applications → Application Verification → Review & approvals. Authorized staff select exactly two eligible CRECOM members and one CRECOM chairperson and confirm the forwarding.
4. Each reviewer opens their assigned frozen packet and records their own password-confirmed approval or rejection. Rejection requires a reason. All assigned reviewers must respond; fewer than three approvals cannot be overridden into approval.
5. Reviewers can request clarification or recuse with a reason. Staff can answer an unchanged-packet clarification or replace an undecided/recused reviewer. Decisions cannot be edited or reassigned after recording.
6. Staff assign one eligible BOD chairperson after CRECOM completes. BOD confirmation is mandatory for every application in this workflow.
7. Super Admin records the final decision with a reason and password confirmation after all required panels finish. Approved applications can then enter the existing release flow.

The individual confirmation record preserves the reviewer account, reviewer name, decision, reason, exact packet version, server timestamp and confirmation statement. The signatory update adds the frozen approval position and an administrator View confirmation action. Borrower/co-maker consent, witnesses, employer certification and notarial paperwork remain separate.

## Protection and history

- Browser sessions cannot call the mutation dispatcher directly. API requests verify the live actor, role, membership and required password before service dispatch. Database functions recheck authorization.
- Every mutation uses an immutable request ledger and revision/state checks. Duplicate retries do not create duplicate assignments, decisions or notifications.
- Changes to application terms, file reviews, selected co-maker or consent evidence block new decisions. Staff must return the case to verification, using the current approved policy, before creating a new cycle.
- Consent is bound to the actually selected co-maker and exact packet hash. Staff checkboxes cannot fabricate consent.
- Packet file links use the frozen file manifest. Reviewer access remains assignment-specific.
- Reassignment, superseded cycles, individual decisions and final records remain attributable. Reviewers see their own history; staff review the full case trail.
- Enrolled final status changes and release/payment transitions require trusted procedures. Direct browser status updates and direct edits to final packet terms are blocked.
- Existing loans outside the opt-in verification workflow retain their current servicing flow.

## Validation

- Synthetic staging SQL: node scripts/append-committee-review-foundations.mjs, then node scripts/prepare-committee-review-sql-test.mjs. The generated file runs inside a transaction ending in ROLLBACK and must never be applied to production.
- Node API/model tests: src/lib/committeeReview.test.mjs, plus existing committee, privilege and verification tests.
- Isolated browser: set COOP_REVIEW_QA=1 and run node scripts/action-dialogs.test.mjs.
- Existing verification browser suite, TypeScript, targeted ESLint and optimized Next.js build.

The Phase 3 base migration is supabase/migrations/20261111_committee_review.sql; the subsequent four-position update is supabase/migrations/20261111_committee_signatories.sql. It does not create accounts, activate policies, assign reviewers, send real notifications or decide any live loan.

## Deployment verification — November 11, 2026

The Phase 3 migration is applied and matches the canonical backend migration. Production verification confirmed zero activated voting rules, approved policies, reviewer accounts, review assignments, individual decisions and final decisions. The mutation dispatcher is callable by the server role and is inaccessible to authenticated browser sessions.

Read-only checks with Super Admin permissions still returned all 17 pre-release applications, the existing verification record and its readable review state. The running review API returns 401 without authentication.

The optimized build, TypeScript, targeted ESLint, 21 committee/privilege/API tests, the new review browser suite, the existing verification browser suite and 11 protected-dialog regressions passed. The staging suite rolled back all synthetic policies, accounts, notifications and decisions after testing the full confirmed workflow, conditional BOD routing, private packet records, immutable history, stale packet/consent protection and trusted servicing transitions.
