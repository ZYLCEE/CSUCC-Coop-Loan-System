# Consent recording in the running member app

## Diagnosis — November 12, 2026

Application `LA-2026-447641` has no row in either
`loan_submission_agreements` or `application_consent_evidence`. The earlier
application `LA-2026-026346` has a saved agreement and two witness names.
The admin screen is correctly distinguishing these records.

The owner confirmed the running source folder is
`C:/Users/zylcee/Desktop/COOP/coop_frontend_client`. That checkout and GitHub main
`5aa01d87e4f32e2f4eb4d33c66c4d5377f16f053` still called
`submit_loan_with_documents`, which does not transmit either checked agreement
or witness names. The prior prepared integration had not been installed into
this running checkout. The agreement RPC and witness-recording trigger are
already installed in Supabase.

## Local fix

The running member checkout now:

- Requires the two agreement confirmations and two distinct witness names on
  Review, matching this project's configured requirements.
- Carries those explicit values through the existing email OTP screen.
- Submits documents, confirmations, terms version and witness names through
  `submit_loan_with_agreements` in one transaction.
- Reconciles retries through that same agreement procedure; an existing document
  manifest alone can no longer cause a false successful submission.

Only the consent-related source files and focused tests were installed. Local
profile, notification, Active Logs and other changes were preserved. Original
modified files are backed up under
`.tmp/member-consent-live-fix-backup` in the admin workspace. No GitHub push,
database deployment, historical evidence backfill, approval or release occurred.
The earlier patch targeting the newer GitHub layout remains available separately
as `member-app-update.patch`; it should not be applied a second time to this
already corrected local checkout.

Restart the running member app so it loads the corrected source. New applications
submitted after accepting the terms, entering witnesses and completing OTP will
save evidence that the admin can review. The affected older application cannot
recover values it never transmitted; the borrower needs a new application
reference and must complete the corrected flow. Do not mark missing historical
evidence as approved or reuse another application's agreement.

## Verification

`current-evidence-readonly.json` records the read-only diagnosis.
`current-client-tests.txt` records 12 passing Flutter tests covering the screen
requirements, new submission and retry RPC payloads, exact terms text/version,
and document validation. These tests use synthetic transports; they do not submit
a hosted loan or generate real consent. Targeted Flutter analysis found no
issues, and the member app's JavaScript web release build passed. Analysis and
build output are recorded alongside this document. The build emitted existing
secure-storage WebAssembly dry-run incompatibility notices; it successfully
produced the normal JavaScript web app under `coop_frontend_client/build/web`.
