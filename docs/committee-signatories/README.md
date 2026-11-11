# Confirmed committee signatories

The user confirmed the following positions from the supplied manual loan form, for every loan:

1. Two distinct CRECOM members and one CRECOM chairperson. All three must approve.
2. One BOD chairperson after the CRECOM panel completes.
3. Super Admin records the final decision after all four responses. Any required rejection blocks final approval.

Migration: `supabase/migrations/20261111_committee_signatories.sql`. It adds structured membership positions, frozen assignment positions and immutable decision positions. Free-form titles and user-editable profile metadata do not grant signatory authority. Existing historical records are not silently relabelled as chairperson approvals.

## Start using the flow

- In Super Admin Settings, open Approval workflow policy and use **Apply confirmed committee roles to draft**. This fills the confirmed review roles, mandatory BOD routing and final-authority description in the editor. Complete the cooperative's actual authorization reference, document requirements, borrower/co-maker consent and witness requirements. Save the draft, review and activate it with the Super Admin password.
- Open **Committee Accounts** and invite each current officer using their own real email: two **CRECOM Member** positions, one **CRECOM Chairperson**, one **BOD Chairperson**. BOD access requires the activated policy. No names from the photographed form are automatically invited.
- Each person follows their private invitation link, chooses their own password and uses their CRECOM or BOD portal. Sharing an account cannot satisfy distinct reviewer slots.
- Verify a member's application and its actual evidence. In **Review & approvals**, select the exact two members and one chairperson. Their decisions refer to the frozen verified packet. Staff assign the BOD chairperson after CRECOM completes, then Super Admin records the final decision.
- **View confirmation** shows the frozen reviewer name and position, decision, exact packet version, Philippine date/time, confirmation statement and reference. Personal passwords are checked by the server and never stored in the approval record.

Reassignment requires the same position and a different eligible person who has not already reviewed the cycle. Changing a membership's position immediately removes access to packets assigned under the previous position; recorded decisions retain their original position. Application/file/consent changes still require returning to verification and a new review cycle.

Committee confirmation is separate from borrower/co-maker agreement, witness attestations, employer certification and the acknowledgment/notarial section of the form. No financial rate or fee was changed from the photographs. These password-confirmed approval records are not represented as notarization or certificate-backed digital signatures.

## Validation and deployment

- Migration generation: `node scripts/prepare-committee-signatories.mjs` (asserted replacements of the previously deployed functions).
- SQL integration: `node scripts/prepare-committee-signatories-sql-test.mjs`, then run the generated `staging-rollback-test.sql` only against the empty staging project. All synthetic users, records, files, policies and schema changes end in ROLLBACK.
- Tested invalid member/chair layouts, mandatory BOD routing, distinct reviewers, exact-role replacements, appointment-change revocation, immutable confirmation positions, early/unauthorized finalization and failed-panel veto.
- Node account and review API/model tests: 15 passed, including trusted-role separation, position validation, password checks, no-forged-authority dispatch and retry identity.
- Isolated browser suites: `COOP_COMMITTEE_QA=1` and `COOP_REVIEW_QA=1` with `scripts/action-dialogs.test.mjs`. No live API/email calls. Includes exact-role selection and replacement filtering, BOD confirmation details, personal password confirmation and mobile layout.
- Next.js production build, TypeScript and targeted ESLint.

Applied November 11, 2026. No live accounts, invitations, activated policy, assignments or decisions are seeded. `verify-deployment.sql` checks live read paths and permissions without printing personal account data.
