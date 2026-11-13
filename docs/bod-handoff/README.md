# CRECOM to BOD handoff and final summary

## Assigned-case compatibility fix completed

The reported application now has BOD assignment `b17c4a9c-4d1a-4477-97b3-0c23a830975a`. The remaining blank CRECOM table was caused by the current database RPC omitting its CRECOM-confirmation field. This display/decision fix no longer depends on deploying the automatic-handoff migration below.

The existing server API now enriches only JWT-admitted BOD assignments from the saved CRECOM decisions. It matches the application, review cycle, policy, packet version and snapshot hash; validates all three decision/assignment identities, numbered positions and timestamps; and returns their names, positions, dates and references in both the assignment and review response. It never selects private reviewer reasons or document storage paths. Missing approvals and mismatched versions remain blocked.

The BOD decision POST also verifies those three confirmations after own-password verification and before dispatching a new decision. Existing immutable-decision retries, stale-state checks and membership restrictions remain in place.

Read-only verification against LA-2026-026346 loaded Kenneth Baldomar (Member 1), Edrian Prones (Member 2) and Maria Alma Abamonga (Chairperson), all approved for the same version as the BOD assignment. See `compatibility-readonly-result.json`. No migration, approval or loan status was changed for this fix.

Validation: 233 source tests (`compatibility-source-tests.txt`), targeted ESLint, production build, legacy-response BOD browser checks and reviewer-decision regressions passed. The live-data diagnostic executes SELECT requests only; API authorization and mutation dispatch are checked in isolated tests. The scripts do not submit a real committee vote.


## Original unassigned-case diagnosis

Read-only checks of the connected Supabase project on November 12, 2026 confirmed that application LA-2026-026346 has one completed CRECOM review with three saved approvals, but no BOD cycle or assignment. Gilda J. Dalagon has an active BOD Chairperson account with personal password setup completed. The other BOD account has not completed personal password setup.

The current frontend already describes an automatic BOD handoff, but the connected SQL review mutation does not perform it. Its assigned-application response also omits the CRECOM confirmation list expected by the BOD UI. No live assignments, votes, accounts or loan statuses were changed during diagnosis.

## Prepared fix

`supabase/migrations/20261112070000_bod_review_handoff.sql` is independent of the pending committee-account-actions migration.

- After a saved CRECOM approval, the existing service-only review dispatcher checks whether all three recorded decisions are approvals for the current application version, with CRECOM Member 1, Member 2 and Chairperson present.
- With exactly one eligible, independent BOD Chairperson, create one BOD cycle and assignment, preserve the application/document snapshot and notify the chairperson and originating staff.
- Two approvals, a rejection, stale evidence, missing personal setup, ineligible/conflicted membership or ambiguous chairperson selection cannot trigger automatic routing. Existing explicit staff assignment remains available for selection cases, but now also requires all three current CRECOM approvals.
- The migration repairs already-waiting, eligible cases using those same checks. This assigns a BOD reviewer; it does not create a BOD approval, finalize a loan or release funds.
- BOD workspace and assigned-application reads include only the three CRECOM confirmation snapshots from that BOD case's exact review cycle. Existing assignment admission and private signed-file restrictions remain intact.
- BOD approval continues into the existing ready-for-final stage. The Super Admin's password-confirmed final decision and separate actual-release permission/confirmation remain required.

The frontend now shows CRECOM approval counts in BOD's list, displays the three approvers/positions/dates in the review modal, blocks BOD decisions if those confirmations are incomplete, and labels an unassigned stage as Awaiting assignment.

The Final Application Summary shows borrower/member/application identifiers, submitted loan terms, required documents, consent/witness evidence, staff verification and all four committee confirmations. Viewing the summary is read-only. Final approval leads to Release; Active Loans begins only after the actual release is recorded.

## Validation

- 225 source tests passed (`source-tests.txt`).
- TypeScript, targeted ESLint and optimized Next.js production build passed.
- Isolated Edge checks passed for BOD's three CRECOM approvals, application review tabs, committee actions, notification behavior, the final summary, ordinary Admin final-decision denial, Super Admin confirmation, separate release and Active Loans navigation, and desktop/mobile layouts.
- Local PostgreSQL checks passed for migration/backfill, the 2/3 gate, assignment uniqueness, copied snapshots, recipient/assignment-scoped approval details, BOD approval to final decision, absence of automatic final approval/release, stale/rejected cases and missing/ambiguous BOD candidates (`sql-tests.txt`).

To reproduce SQL checks without connecting to Supabase:

```powershell
npm install --prefix node_modules/.committee-sql-qa --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.16
node scripts/bod-handoff-sql.test.mjs
```

## Automatic-handoff deployment remains pending

The separate automatic-handoff Supabase migration has not been applied. It is not required for the assigned-case display/decision fix above. AGENTS.md requires: "Do not push or deploy unless the project owner asks."

After project-owner approval, apply only the named BOD migration, reload the schema, and verify that LA-2026-026346 has one BOD assignment and its three CRECOM snapshots. Do not fabricate decisions, reset reviewer passwords, approve a loan or record a release while verifying the handoff.
