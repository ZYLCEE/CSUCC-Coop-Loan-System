# Application rejection repair

Status: applied to the connected database with explicit owner approval on November 13, 2026; read-only verification passed.

## Diagnosis

A read-only GET of the connected PostgREST OpenAPI schema returned HTTP 200. Existing `application_workflow_action` and `committee_review_action` are exposed; `portal_application_action` and `portal_reject_application` are absent. The previous rejection endpoint called the absent general workflow dispatcher, causing the setup error shown in the screenshot. No rejection was submitted during inspection.

## Scoped repair

Apply only `supabase/migrations/20261113100000_application_rejection_resolution.sql` after separate owner approval. Do not batch-apply unrelated pending migrations.

This file creates a private rejection retry ledger, installs the service-only `portal_reject_application(uuid,jsonb)` dispatcher, and updates `committee_record_final` to distinguish rejection prerequisites from approval prerequisites. No reports, email delivery workers, routing triggers, backfills, committee assignments, votes, final decisions, or releases are executed by the repair itself.

The API verifies the acting account's current password and Super Admin role before dispatch. Database checks independently enforce authority, current application revision and evidence hash, all assigned reviewer responses, immutable existing final decisions, and request replay identity. Final approval still requires all current CRECOM and BOD approvals; rejection never substitutes for approval. Requirements-stage rejection initializes verification within the same transaction where necessary, without fabricating any approvals.

## Validation

- `node scripts/portal-workflow-sql.test.mjs`: synthetic PostgreSQL tests include installing the standalone repair before the broader local workflow migrations, applying it twice, rejecting an unstarted application, retry replay, rejecting a modified replay, denying ordinary Admin, and denying browser execution. Existing completed/incomplete/stale committee, BOD rejection, approval, and no-release checks also pass.
- `node --test src/lib/committeeReview.test.mjs src/lib/applicationWorkflowRoute.test.mjs`: 20 focused tests pass, including rejection password checks, safe SQL dispatch, and missing-function handling without a legacy bypass.
- Targeted ESLint and TypeScript validation are run separately; see the current task report for their result.

The running local API now selects the dedicated rejection dispatcher. The dedicated rejection dispatcher is now installed and exposed in the connected API. Applying the repair does not itself reject any application. After installation, inspect function availability and privileges read-only; let the owner perform the intended application action.

SQL SHA-256: c70b6e4fae6139e4704f767f717c33578d9d621493f97b8b0a46d144bb1898be

## Approved application and verification

Only `20261113100000_application_rejection_resolution.sql` was executed through the linked Supabase CLI. A transaction guard checked that the original final-decision function still matched the saved preflight definition before replacing it. No unrelated pending migration was applied and no migration-history rows were fabricated.

Read-only verification at 17:54 Asia/Manila on November 13, 2026 confirmed:
- The dedicated dispatcher exists and is exposed by PostgREST.
- Anonymous and authenticated browser roles cannot execute it; the server role can.
- The retry ledger has RLS enabled, browsers cannot insert rows, and it contains zero rows.
- Fingerprints of all application rows, individual committee decisions, and final decisions exactly match preflight.
- No application rejection or other loan action was submitted during deployment or verification.

Evidence: `rejection-repair/before.json`, `rejection-repair/applied.json`, and `rejection-repair/verification.json`.

The approved SQL was applied directly as a focused repair. It was not a batch migration push and does not add a row to the project's ambiguous migration-history ledger. Other workflow/reporting/email deployment gaps remain outside this repair.
