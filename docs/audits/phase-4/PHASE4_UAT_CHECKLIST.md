# Phase 4 controlled UAT checklist

Use a dedicated nonproduction Supabase project with synthetic identities and seeded records. Use test recipient sinks, private test buckets, and the exact intended Edge Function and migration revisions. Have a rollback or reset plan. Record the environment ID and revisions, actor role, expected and actual state, and redacted event IDs. Keep credentials, tokens, signed URLs and member data out of evidence.

## Setup and release gates

- [ ] Confirm the staged frontend, canonical secure-action deployment, migration history, scheduler jobs, Realtime publication and private bucket policies.
- [ ] Create separate active Admin, Super Admin, two member users, and a blocked user. Provide an ordinary Admin a temporary exact grant only for the scenarios that require it.
- [ ] Seed two members' loans, required attachments, receipt fixtures and capped/paged datasets. Validate permission denials before permitting privileged staging scenarios.
- [ ] Complete the containment, payment grant and dependency gates in the [remediation plan](PHASE4_REMEDIATION_PLAN.md).

## Authentication and permissions

- [ ] Sign in as Admin and Super Admin. Observe the branded transition, correct dashboard, refresh persistence and deep links.
- [ ] Try wrong credentials, member and blocked accounts, expired session, offline/slow request and direct protected URLs. Confirm protected APIs return no data and UI recovers.
- [ ] Log out, refresh, use browser Back, reuse an expired session, and block an already signed-in account. Confirm server authorization and logout behavior on each.
- [ ] Check Admin cannot mutate accounts, approve/release loans, record/reverse payments, schedule notices, or edit loan policy. Check exact assigned document/settings/send grants and revocation.
- [ ] Attempt direct API access as member, anonymous user and Admin with changed client role. Confirm server denies with no row or side effect.

## Loans and payments

- [ ] Submit from the Flutter member app with allowed files. Try wrong owner, missing required document, invalid amount/tenure, and duplicate in-progress type. Verify rejection and orphan cleanup.
- [ ] Verify Admin reads only. As Super Admin review and approve separate synthetic applications. Verify review state, actual application ID, documents, dates, and audit entry. Exercise a second concurrent approval.
- [ ] Exercise the designated rejection path, if enabled. Verify reason, history, absence from eligible release and API denial for disallowed role/state.
- [ ] Compare release review with stored principal, fees, interest, net release, reference and actor. Change a policy after preview and ensure stale confirmation is rejected. Replay a request and confirm a single release event.
- [ ] Verify only correctly released loans appear in Active Loans. Open exact details. Compare scheduled balances with independently prepared synthetic fixtures.
- [ ] Preview and record a staging-only full, partial, overdue and decimal payment. Try zero, negative, invalid precision, overpayment, changed allocation, repeated request and concurrent submission. Verify immutable receipt history and reviewed allocation.
- [ ] Confirm direct legacy RPC write is denied. Reverse a staging receipt with an authorized actor, verify audit and ledger reconciliation, then test completion or the documented closure process.

## Accounts, settings, profile and recovery

- [ ] Confirm generated member ID preview, create each supported role, edit profile, block/unblock and reset only authorized test accounts. Compare Auth and member profile records. Exercise deletion according to the approved staged workflow.
- [ ] Try wrong actor password, expired grant, changed target/action/payload, already-consumed grant and concurrent grant use. Verify exactly one authorized side effect.
- [ ] Confirm policy change, exact grant changes, safe simultaneous edits, immutable audit evidence and profile ownership. Check Super Admin-only email change and own password confirmation.
- [ ] Verify the approved recovery procedure for portal and member users, redirect restrictions and session consequences. Record any unsupported path as a workflow gap.

## Communications, files and reporting

- [ ] Open the bell at mobile/desktop widths. Check two account inboxes, unread counts, read/unread persistence, reconnection and privacy. Verify a synthetic application alerts only intended recipients.
- [ ] Send only to staged recipients. Test exact target, permission, schedule time, cancellation if available, failed insert and idempotent retry. Verify delivered records and device receipt separately.
- [ ] Create, schedule, publish, edit and archive a staged announcement. Confirm Flutter member visibility, private draft states, scheduler uniqueness and stale edit rejection.
- [ ] Upload a permitted document and inspect retrieval through the private URL. Test malformed/mismatched and oversized files, invalid path, expired URL, other member attachment access, and scoped deletion.
- [ ] Reconcile month/date edges, currency, sorting, capped pagination, totals, CSV/print and audit filters with seeded data. Verify errors and empty results show distinct feedback.
- [ ] Correlate account, release, receipt, reversal, announcement and grant events to actors and time. Attempt audit mutation as regular user and verify denial.

## Browser and sign-off

- [ ] Check both role shells at 1920×1080, 1366×768, 1024×768, 768×800 and 390×844. Check keyboard navigation, focus restoration, dialog Escape, long tables and notification clipping.
- [ ] Record passed, failed, deferred and unavailable scenarios. Have finance, security and product owners review failures before recommending deployment.
