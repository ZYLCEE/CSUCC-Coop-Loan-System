# Focused verify-and-forward database repair

## Diagnosis

The processing screen calls `portal_application_action(uuid,text,jsonb)` for the password-confirmed **Verify & Send to CRECOM** action. The application API maps PostgREST's missing-function errors (`PGRST202` / `42883`) to the “workflow setup” message. The production reconciliation record says this RPC and its request ledger are absent, while the base verification and committee-review actions are present. The screenshot is consistent with that missing RPC; the action was not recorded.

The workspace's root `.env*` files contain no usable Supabase endpoint/key, so a fresh schema read from this checkout could not confirm the live API. The production target and missing-object finding below come from `docs/approval-workflow/SUPABASE_FORWARD_RECONCILIATION.md` and must be reconfirmed before execution.

## Proposed scope

Apply only `supabase/repairs/portal_application_action.sql` after confirming the production target and reviewing the SQL. It creates:

- `public.portal_action_requests`, with RLS enabled and a staff-only read policy;
- `public.portal_application_action(uuid,text,jsonb)`, executable only by `service_role`.

The RPC preserves password verification in the API, checks the acting administrator's permission, revision and application hash, validates the saved documents/consent/checklist, and runs verification plus CRECOM assignment in one transaction. It does not create a ledger row or change an application merely by being installed.

This focused repair intentionally does not install `portal_dashboard_totals` or replace `committee_record_final`. The broader `20261113090000_portal_workflow_improvements.sql` changes those other objects, and the production reconciliation notes say the hosted final-decision function differs from local source.

## Preconditions and validation

- Confirm the target is production project `jhgsqvxlvwhrwpcekvpq` and verify the two target objects are still absent. The script stops if either already exists.
- Run the focused SQL regression against a disposable PostgreSQL database and review the object/grant diff before any production write. The regression is `scripts/portal-workflow-sql.test.mjs`; it exercises the same RPC body through the broader local migration. It has not been run during this repair preparation.
- Obtain separate owner approval for the exact target and SQL. No production SQL has been applied.

## Recovery

Before a successful action is recorded, `supabase/repairs/portal_application_action_rollback.sql` removes the RPC and empty ledger. It refuses to remove a non-empty ledger. If requests have been recorded, preserve the ledger; revoke `service_role` execution and investigate before changing the function. Do not replay a request that may already have committed.
