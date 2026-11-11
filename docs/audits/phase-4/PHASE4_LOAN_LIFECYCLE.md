# Phase 4 loan lifecycle

## Supported transition map

| Transition | Active contract | Evidence and limit |
|---|---|---|
| Member submission → pending | Flutter `lib/services/loan_document_upload_service.dart` validates paths, uploads required files to `loan-documents`, calls `submit_loan_with_documents`, and removes uncommitted uploads on known failure. Sibling SQL validates Auth, ownership, policy and duplicate/same-type eligibility. | Source only for device workflow. Isolated submission-alert trigger validated separately. |
| Pending → under review | Portal loan table starts a protected `review-loan` action. Sibling Edge handler sets review state for eligible rows. | Browser details and mock protected stage checked. Portal's separate Edge copy lacks the corresponding handler. No deployed mutation claimed. |
| Pending / under review → approved | Protected `approve-loan` verifies the actor and checks the sibling policy, required documents and conflicting applications. Sibling updates an eligible current state. | Source only for real approval. Confirm stale approval handling, one winner, resulting fields and audit event in staging. |
| Pending / under review → rejected | Sibling protected `reject-loan` updates eligible rows. Its update writes the status alone and does not capture a rejection reason in the row. No corresponding action was found in the active loan table. | Backend source traced. Rejection through the active portal was not verified. Confirm the intended route and reason/history behavior. |
| Approved → released | The Super Admin release dialog invokes the release RPC with loan ID, request ID, expected principal and optional notes/reference. SQL validates role and state, sets release metadata, calculates recorded terms and records an audit event. | Isolated SQL checked release and replay. Browser only previewed. P4-05 covers policy changes after review. |
| Released → tracked in Active Loans | Resource API selects rows by released or overdue status without requiring a release date. Counter payments also require valid release data. | Local handler confirmed the list includes a released row with no date. The intended lifecycle requires a real release date. |
| Released → payments and reversals | Payment dialog previews and confirms an allocation. The reviewed RPC recomputes under the write path, validates expected allocation and persists/audits a receipt. Reversals keep history and update aggregate payment state. | Isolated receipt tests and negative probes passed their expected assertions. P4-02 is a demonstrated bypass through a separate legacy writer. |
| Repaid → completed | Reports and resources recognize existing completed records. Sibling repayment eligibility considers posted payments when allowing another loan of the same type. | No automatic transition to completed was established for the current receipt RPC. Confirm the intended operational closure and reconcile Active Loans behavior before relying on completion. |

## Financial controls and gaps

- The current release preview is backed by the existing loan and configured rates. The release RPC binds the expected principal, while execution selects current fee and interest policy. An isolated SQL probe modeled a reviewed fee of 10 units and then changed the policy. The unchanged-principal request succeeded with a 40-unit fee. This confirms the commit can drift from the reviewed terms.
- The reviewed receipt path checks positive/precision limits, current remaining balances, arrears and the reviewed principal/interest/penalty allocation. Isolated tests covered partial and decimal payments, overpayment, changed allocation, replay, and reversal. The extra probe checked a one-cent input and rejection of zero/negative input. The tests do not establish production accuracy or multi-session race safety.
- The legacy writer accepts authenticated Super Admin calls with manual allocation. It is called internally by the reviewed wrapper and also has a broader execute grant in the audited migration set. Restrict the external grant only after identifying legitimate deployed callers.
- A cash receipt records an accounting event. Staged acceptance should reconcile receipts, balances, interest, penalties, disbursement and any reversal independently. The isolated tests did not transfer money or execute live payments.
- Sibling Edge includes a generic status update separate from the controlled transitions. Verify reachability and prevent direct status changes from leaving missing release fields or inconsistent audit history.

## Evidence anchors

- Portal `src/components/loan-applications/LoanApplicationsTable.tsx`, `src/components/active-loans/CounterPaymentDialog.tsx`, `src/lib/loanRelease.ts`, and `src/app/api/admin/resources/route.ts`.
- Portal migrations `20261029_fix_counter_payment_method.sql`, `20261108144000_automatic_counter_payments.sql`, `20261108172000_persist_loan_submission_alerts.sql`, and `20261108180000_counter_payment_interest.sql`.
- Sibling `../coop_backend/supabase/edge-functions/secure-admin-action/index.ts` and migrations 016–026. The sibling `functions/secure-admin-action/index.ts` is an import wrapper.
- Flutter `../coop_frontend_client/lib/services/loan_document_upload_service.dart`. Client source review does not prove a shared deployed Supabase project.
