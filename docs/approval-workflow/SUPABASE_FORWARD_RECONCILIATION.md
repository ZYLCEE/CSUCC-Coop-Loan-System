# Supabase forward-only reconciliation plan

**Status: focused production repair applied and verified; broader hosted reconciliation remains incomplete.**

## Pre-repair read-only baseline

On November 13, 2026, authenticated Supabase CLI checks confirmed:

- Target project: `CSUCC-Coop-Loan-System` (`jhgsqvxlvwhrwpcekvpq`).
- Supabase environment: **production**, project status `ACTIVE_HEALTHY`.
- Database version: PostgreSQL 17.11. The catalog query ran as `supabase_read_only_user` in a read-only transaction.
- Remote migration versions: `20261108144000`, `20261108180000`, and `20261110`.
- The isolated CLI config was used because the repository config cannot load without an SMTP host. It did not alter the project config.

The fresh catalog check found 39 public relations, 121 public functions, 56 public RLS policies, and 41 non-internal public triggers; all 39 public tables checked had RLS enabled. This is an inventory, not proof that every policy or grant matches local intent.

Before the focused return repair below, these objects required by current local workflow/notification migrations were absent from production:

- Tables: `application_email_outbox`, `committee_credential_actions`, and `portal_action_requests`.
- Columns: `individual_review_decisions.member_reason`; `staff_memberships.account_action_id` and `account_deleted_at`; and the seven local email-outbox columns (`lease_id`, `locked_at`, `next_attempt_at`, `provider_message_id`, `application_snapshot`, `delivery_payload`, and `first_attempt_at`).
- Of 15 expected workflow/notification function signatures checked, 12 are absent. The three present (`committee_record_final`, `portal_emit_activity`, and `portal_record_activity`) all have bodies that differ from the latest local definitions after whitespace normalization. Their live owners are `postgres`; their exact grants and dependencies must still be reviewed before replacement or reliance.

The absence count does not mean all baseline workflow functions are missing. Production has `application_workflow_action(uuid,jsonb)` and its supporting verification/review tables and functions. Current source uses that existing RPC for ordinary verification edits, but custom verify-and-forward/recommend/reject operations call the absent `portal_application_action(uuid,text,jsonb)`. The route reports this as an unavailable prepared database migration. The `committee_account_action`, `committee_accounts`, and `committee_change_membership` dispatcher/read/edit functions also exist, but the newer credential-action entry points and their backing table/columns do not.

## Return-application failure and local repair

The return dialog's generic error was traced to the live `mutate_application_verification(text,text,integer,text,jsonb,uuid)` procedure. A read-only catalog query confirmed its return branch inserts into `public.application_email_outbox`, which was absent in production before the repair. PostgreSQL therefore aborted the transaction before the return status, in-app notice, workflow event, or audit log could commit. This matches the user-visible failure. The deployed procedure body otherwise matches the local return implementation apart from the loan-return subject dash encoding.

The one-off SQL repair `supabase/repairs/20261113172300_restore_application_return_email_outbox.sql` was applied to the confirmed production project on November 13, 2026. It is intentionally outside `supabase/migrations` so an ordinary migration push will not replay it while the remote ledger is ambiguous. A follow-up read-only catalog query verified the table has its 13 base columns, RLS is enabled, the staff-return SELECT policy is installed, anonymous SELECT and authenticated INSERT are denied, and `service_role` INSERT is allowed. The migration ledger still reports only `20261108144000`, `20261108180000`, and `20261110`; reconcile/record this one-off change during the later migration-history repair. No email provider or worker is configured by this repair; it restores the queued row and the atomic in-app return path, not actual email delivery. The missing later notification-worker columns/functions remain a separate reconciliation item.

The API source now translates PostgreSQL's missing-relation error (`42P01`) into a clear message explaining that no changes were saved, instead of the generic verification error; this frontend source change has not been deployed. An offline SQL regression applies the migration to a database where the outbox starts absent, then exercises the return flow. No real application was returned as part of this repair.

## Migration dependency map

This is a focused map of the currently missing production behavior, not a claim that all 39 local migrations have been fully reconciled.

| Local migration | Required objects / dependencies | Production evidence | Safe conclusion |
|---|---|---|---|
| `20261111140000_agreed_approval_workflow.sql` | Creates `application_email_outbox`; depends on applications, notifications, and existing access helpers. | The focused base outbox table and read policy are now present; later worker columns/functions remain absent. | The focused table repair is applied separately; do not apply this file wholesale until its status/constraint and transition changes are compared with live definitions. |
| `20261112060000_committee_account_actions.sql` | Adds two columns and a foreign key on `staff_memberships`; creates `committee_credential_actions`; wraps existing committee account RPCs. | The base membership table and three wrapped RPC signatures exist; both columns and the action table are absent. | This migration is not safely replayable as-is without checking live function bodies, constraints, account state, and the post-Auth failure/recovery behavior. |
| `20261112090000_allow_return_before_verification.sql` | Updates the verification mutation path; inserts a return notice and email-outbox row. | The existing verification mutation function is present and its outbox dependency is now satisfied. | The missing-relation blocker is repaired. A real user return was not executed, and the notification worker/provider remains unconfigured. |
| `20261113090000_portal_workflow_improvements.sql` | Creates `portal_action_requests`; creates `portal_dashboard_totals` and `portal_application_action`; replaces `committee_record_final`. | The request table and two new functions are absent. `committee_record_final` exists, but its body differs from the local definition after whitespace normalization. Base workflow tables/helpers exist. | This is an application-critical migration, but replacing the live final-decision function requires exact behavior/ACL comparison and a test database. |
| `20261113091000_portal_borrower_notifications.sql` | Adds `member_reason` and seven outbox columns; installs notification, queue/worker, activity, and delivery functions/triggers. | `member_reason`, the seven later outbox columns, and the new notification/delivery functions are absent. The base outbox table is present after the focused repair; the base notification/activity/review tables exist. | Do not install piecemeal: the functions and triggers are coupled to outbox uniqueness, worker leases, recipient checks, and existing notification triggers. Email provider configuration remains deferred. |
| `20261113092000_portal_consent_response_details.sql` | Adds evidence and co-maker response-notice functions and a deferred trigger; writes to the email outbox. | The new functions are absent; base co-maker, application, and email-outbox tables exist. | This change depends on verified accepted-consent evidence semantics and the notification/outbox functions. Preserve OTP and evidence gates. |

Before the repair, production had all 18 checked base application, committee, notification, document, and activity relations, each with RLS enabled; the newly created outbox table also has RLS enabled. The pre-repair inventory was 39 public relations, 121 public functions, 56 public policies, and 41 non-internal public triggers. For key existing service RPCs, catalog inspection showed owner `postgres`, `SECURITY DEFINER`, and service-role-only execute grants where applicable; that does not establish that their bodies match local source. No application or member data rows were read or modified for this dependency map.

The local directory contains 39 migration files. Legacy date-only versions collide: `20261029` (6 files), `20261110` (4 files), and `20261111` (5 files). These names cannot safely be treated as unique migration ledger entries.

A prior read-only schema dump comparison found:

- 3 of 31 migration-touched tables absent remotely: `application_email_outbox`, `committee_credential_actions`, and `portal_action_requests`.
- 10 detected columns absent remotely: seven on `application_email_outbox`; `individual_review_decisions.member_reason`; `staff_memberships.account_action_id`; and `staff_memberships.account_deleted_at`.
- Of 126 latest local function names, 84 had a matching normalized body by name, 17 existed with a different normalized body, and 25 were absent by name. This comparison was name-based, not a complete signature/ownership/grant equivalence proof.

The table/column/function counts are inventory signals, not instructions to create those objects blindly. Existing hosted definitions can have dependent constraints, triggers, policies, grants, or data not captured by a name-only comparison.

## Safe execution sequence

1. **Confirm target and change window.** The requested project ref, display name, production environment, and active/healthy status have now been independently verified. The exact SQL, expected effects, and recovery path still need review and approval before any write.
2. **Capture and retain the full baseline.** Read-only catalog queries and the migration ledger are available. A fresh schema dump still needs a Docker-free capture method; the CLI dump path currently fails because Docker/Podman is unavailable. Then compare exact function signatures, definitions, owners, grants, triggers, RLS policies, constraints, indexes, and dependent tables with local intended definitions.
3. **Finish the migration map.** The six latest migrations affecting the missing workflow behavior are mapped above. Map the remaining local files and their data effects, idempotency, and live equivalents. Resolve date-only collisions in a new canonical migration history without inventing or rewriting “applied” entries.
4. **Review object-level differences.** Reconcile each missing or differing object against the exact hosted definition and data. Determine whether each change is still required, already implemented under another signature/name, or incompatible with hosted data. Preserve OTP, authorization, RLS, committee gates, and existing records.
5. **Review the focused return repair, then continue reconciliation.** The one-off SQL script contains only the confirmed missing base outbox table, an existence precondition, transaction boundaries, and the original RLS/grants. It is outside the auto-pushed migration folder. Do not copy all old migrations into it and do not use ordinary `supabase db push` against the ambiguous history.
6. **Validate before execution.** Run the SQL against a representative disposable database with schema/data fixtures, including authorization/RLS and rollback tests. Review the final SQL and expected object diff. Confirm backup/PITR recovery readiness.
7. **Apply only the reviewed change set.** Execute only after the user has reviewed the exact target, SQL, expected effects, and recovery path. Do not apply real decisions, send email, or deploy application code as part of this database step.
8. **Verify after apply.** Re-read the ledger and exact catalog definitions/grants/policies; run safe synthetic database tests against the intended environment where possible; confirm RPC/API behavior and report failures explicitly. Keep email worker configuration and actual delivery as a separate approval.

## Current gate

The production database is reachable for read-only catalog queries, but the exact full hosted schema and signature/grant/policy reconciliation are not retained as a reviewed artifact. The legacy migration history remains ambiguous, and other confirmed missing objects still need their prerequisites mapped. The focused return repair is applied; it does not mark the remaining workflow as live-complete. Do not replay the local migration directory or apply an improvised subset.
