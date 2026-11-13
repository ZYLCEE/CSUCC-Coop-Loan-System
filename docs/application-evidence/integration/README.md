# Member app → Supabase → admin evidence integration

**November 12 update:** The running `coop_frontend_client` checkout has now been
fixed directly while preserving its local changes. See
[CURRENT_CLIENT_FIX.md](CURRENT_CLIENT_FIX.md) for the missing-evidence diagnosis,
installed changes and validation. The package instructions below describe the
separate update for the newer GitHub source layout; do not reapply that patch
over the corrected local checkout.

This update targets member app commit `5aa01d87e4f32e2f4eb4d33c66c4d5377f16f053`
from `ZYLCEE/coop-frontend-client` (the GitHub main branch inspected for this task).
The changed app is prepared in the isolated local branch
`codex/loan-evidence-integration`; the older member-app worktree and its uncommitted
changes are preserved.

## Update order

1. The migration is already applied to your connected Supabase project. For another database, apply `supabase/migrations/20261112030000_loan_submission_agreements.sql` to the
   cooperative Supabase database. It depends on the existing document-submission,
   application-verification and `application_evidence_details` procedures already
   installed for the admin app. The migration can be rerun safely.
2. Update the member app to the GitHub revision above or a compatible descendant,
   then apply `member-app-update.patch` from this directory in that app's root:

   ```powershell
   git apply --check C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/application-evidence/integration/member-app-update.patch
   git apply C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/application-evidence/integration/member-app-update.patch
   flutter pub get
   flutter test test/loan_consent_terms_contract_test.dart test/loan_consent_submission_test.dart test/loan_document_test.dart
   flutter build web --release
   ```

   Configure the member app's normal `.env` before building your runnable release.
   No credentials are included in the update package. A ZIP with the changed files
   is also provided for applying the same update after pulling the latest app.
3. Run/redeploy the updated member app and this updated admin app. A future loan
   submitted through the updated flow will automatically appear in View Evidence.

## What is saved

- Both explicit borrower confirmations, the server timestamp and Auth user.
- The exact accepted terms text and version (not a later template).
- The existing Witness 1/2 values from the application snapshot.
- A borrower consent-evidence record bound to the resulting application packet.

The new submission RPC calls the existing document-submission procedure and saves
the receipt in the same transaction. It requires a current active member and a
recent authenticated email OTP claim. False checkboxes, duplicate/invalid names,
another member's reference, changed terms, or changed replay payloads are refused.
Retries do not create duplicate applications, receipts or borrower consent rows.

The admin view polls while idle in Requirements, CRECOM and BOD, and also refreshes
on focus/activity notifications. It displays the saved checkboxes and accepted
terms, co-maker approval, and borrower-supplied witness names.

Borrower-supplied witness names are recorded from the OTP-confirmed application.
The configured witness-count requirement accepts these names, and the admin UI
labels them **Names recorded**. They are not independent witness signatures.

Existing loans without saved agreements stay missing: this update cannot recover
checkbox values or names that the older app never transmitted. It does not backfill
old loans or change their approval/release status.

## Validation

The rollback SQL covers atomic submission, checkbox values, stored terms and
witness names, replay safety, changed-payload rejection and OTP enforcement, with
all synthetic rows rolled back. Flutter tests exercise confirmation validation and
the actual RPC payload on retry; document tests retain existing validation.
The admin browser test checks the saved checked/disabled controls and exact terms.

Validation completed: 11 focused Flutter tests, 7 API/model tests, the admin browser workflow suite, TypeScript/ESLint, the admin production build and the member web release build passed. The broad upstream loan-flow suite has 10 pre-existing UI test failures; comparison with the unmodified GitHub source showed the same 10 failures and no additional failures from this integration. See flow-test-comparison.json.

The patch and ZIP are local deliverables; the GitHub main branch has not been changed. Apply the included source update after pulling the app, then build/run that updated app. The source worktree uses a placeholder .env for compilation; configure your normal app environment for a runnable release.
