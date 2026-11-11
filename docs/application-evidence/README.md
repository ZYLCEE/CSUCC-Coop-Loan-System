# Consent and witness display

The Process Application requirements view reads consent evidence through the
staff-only `application_evidence_details` RPC. The RPC checks the current application
packet and returns non-expired, non-invalidated records, with names resolved from
their member number, member UUID or Auth UUID. It also returns the accepted
co-maker request actually attached to this loan, including approver, borrower,
relationship, approval time and approved loan details. Unrelated or pending
co-maker requests are excluded.

Evidence viewing works before an approval policy is configured. Displaying a
record does not bypass the existing policy, packet-bound evidence requirements,
document verification or approval workflow. Verification counts remain separate
from the saved co-maker approval status.

View Evidence remains available for missing records, so staff can inspect the
current terms template and see an explicit absence message. The current terms
template is copied from the member app's ReviewTermsScreen; it is clearly labeled
as a template rather than proof of historical acceptance. No saved consent is
inferred from submitting a loan. The member app currently holds the terms checkbox
in local screen state and does not persist it. The application inspected during
this task has a saved co-maker acceptance, but no borrower or witness evidence rows.
Saving new borrower acceptance or capturing witness attestations requires a member
intake integration; this display change does not manufacture those records.

That submission integration is now implemented in [integration/README.md](integration/README.md).
The Supabase migration has been applied, and a tested source ZIP/patch is prepared
for the updated GitHub member app. It records borrower confirmations and names
supplied in the existing witness fields; it does not fabricate witness signatures.

The optional Internal Notes editor has been removed. Existing saved notes remain
intact when staff save their checklist.

Validation: API/model unit tests, the five-step workflow browser suite (including
evidence viewing and removal of notes), ESLint, TypeScript, production build and a
rolled-back database check of the application's actual co-maker approval,
stale-packet rejection and non-staff denial. No loan decisions or consent data were
written by the validation.
