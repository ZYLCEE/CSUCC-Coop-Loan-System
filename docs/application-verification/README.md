# Process Application

Loan Applications keeps its existing search, Status, Loan Type and Membership Type filters. The separate Processing stage filter has been removed. Open **Actions → Process Application** from a loan row or application details.

## Daily processing

The dialog uses five connected steps and one primary next action. The current step comes from persisted verification, committee and loan status. Clicking a circle only changes what is displayed; it never verifies, forwards, approves or releases an application.

1. **Requirements.** Show separate Submitted / Not submitted and staff review statuses for every required document. Staff can preview and verify the latest file or request replacement inside the dialog, using the existing document-review permission and version checks. Borrower consent, co-maker consent and witness counts are always visible, with completeness based on the approved policy. View evidence opens read-only current-packet records. Staff save their identity, eligibility/affordability and terms checks, then **Mark as verified** records verification and opens CRECOM. **Return Application** records correction instructions; optional notes and history stay collapsed.
2. **CRECOM.** Send the verified packet to exactly two CRECOM members and one CRECOM chairperson. Their own portal confirmations appear in a compact list. The main button shows **Waiting for CRECOM** while responses are pending.
3. **BOD.** After CRECOM completes, send the packet to one BOD chairperson. Its confirmation appears here. The main button shows **Waiting for BOD** until the review finishes.
4. **Final Decision.** Show the requirements verifier and all four committee confirmations in one table, with frozen names, positions, Philippine timestamps and View confirmation. Super Admin or an Admin with explicit final-decision permission records the decision using the existing reason/password confirmation. Required rejections still block approval.
5. **Release.** Final approval opens **Approved — awaiting release**. **Record release** uses the existing disbursement form, current policy amounts, voucher/date, acknowledgment and acting account password. Only a successful release marks the fifth step complete and makes the loan available in Active Loans. Active Loans links follow the current Admin or Super Admin portal.

CRECOM completion requires exactly two distinct member approvals and the chairperson approval. A 2/3 response remains in progress even if a cycle is incorrectly reported complete. Rejection and clarification have separate states. BOD requires its chairperson's approval. Archived/reassigned approvals cannot satisfy the current panel. Approval progress refreshes from recipient events, focus and periodic checks while the form is idle; unsaved edits are preserved.

Earlier steps and immutable confirmation details stay viewable. History and less common actions are collapsed by default. Clarification/reassignment actions are under **Reviewer actions**; reopening is under **Processing history & additional actions**. A changed packet returns to Check Requirements and requires the existing controlled reopening/re-verification process. Superseded decisions remain in history.

Failed draft and release retries reuse their request IDs; duplicate submits and existing stale-version guards remain. Evidence reads require an active administrator and successful workflow access check, are scoped to the current application/packet, exclude invalidated, expired, future-dated and disallowed-method records, and are never cached. No new consent record can be created through the processing screen.

## Setup is separate

Committee Accounts manages live reviewer memberships. Approval policy setup remains under Settings. Neither setup editor is embedded in daily application processing. When setup is incomplete, the dialog explains that forwarding is blocked. The preconfigured demonstration logins still use separate sample applications; they are not silently enrolled as live reviewers.

This screen change does not activate policies, send invitations, create committee accounts, enroll existing applications or change loan decisions/payments. Existing backend verification, committee, consent and final-authority rules remain in force.

## Implementation and checks

- `src/components/loan-applications/ProcessApplicationDialog.tsx` coordinates requirements, review state and one next action.
- `ProcessingRequirements.tsx` presents submission/review status, policy-based evidence counts, file review and read-only evidence details.
- `ProcessingStepper.tsx` and `processing.module.css` provide the connected, responsive progress circles.
- `ProcessingReviewStep.tsx` presents approvals and secondary reviewer actions, reusing the existing review mutation dialog.
- `src/lib/applicationProcessing.ts` maps trusted stages to five steps and checks actual panel approval outcomes and positions.
- `node --test src/lib/applicationProcessing.test.mjs src/lib/applicationWorkflow.test.mjs src/lib/committeeReview.test.mjs` checks requirements precedence, stale packets, stage mapping, progress counts and existing authorization contracts.
- `COOP_WORKFLOW_QA=1 node scripts/action-dialogs.test.mjs` runs the isolated flow through release: incomplete/complete submission, evidence viewing, document review, 2/3 and rejected CRECOM cases, BOD, final approval, release retry protection, history and mobile bounds. Sample reviewer responses and disbursements are simulated; no real loans are changed.
- `COOP_REVIEW_QA=1 node scripts/action-dialogs.test.mjs` covers the existing reviewer password acknowledgment, selection, retry, clarification, policy and final-decision controls.
- TypeScript, targeted ESLint and the optimized Next.js build validate integration.

The existing verification migration is `supabase/migrations/20261110_application_verification.sql`; committee and four-position signatory migrations extend it. This UI change needs no new migration.
