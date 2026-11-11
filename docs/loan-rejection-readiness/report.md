# Secure Loan Rejection — Deployment Readiness Audit

**Recommendation: NO-GO for production deployment at this time.** Local rejection contracts and targeted tests pass, and hosted schema metadata confirms the core table/column prerequisites. Production migration history, exact SQL definitions/permissions/triggers, and the deployed Edge Function revision have not been verified. These gaps prevent safe clearance of the production rollout.

Audit date: November 10, 2026. Evidence timestamps are recorded in the JSON artifacts. This was a preparation-only audit: **no deployment commands, production SQL, RPC invocations, record requests, loan decisions, financial operations, migrations, resets, RLS changes or credential changes were performed.** Only audit documents/scripts/evidence were added. The audited application, canonical function and migration hashes remained unchanged.

## 1. Environment and verified connection status

| Item | Evidence / result |
|---|---|
| Hosted target | `jhgsqvxlvwhrwpcekvpq.supabase.co` |
| Project selection | Frontend URL and both frontend/backend `.temp/project-ref` caches agree on `jhgsqvxlvwhrwpcekvpq` |
| Frontend configuration | URL, public publishable key and server-only service-role credential are present. Public credential is a publishable key and differs from the server credential. No credential value was printed or saved. |
| Backend local label | Canonical backend `config.toml` uses local development project label `coop-backend`; the linked project reference is the hosted reference above. This label is not proof of a deployment target. |
| Auth health GET | **200**, hosted Auth reports version `v2.197.0`; this is not the PostgreSQL version |
| Service-authenticated REST OpenAPI metadata GET | **200**; schema/argument metadata only, no rows requested |
| Public-key REST OpenAPI metadata GET | **401**. Anonymous/public schema visibility and public-key gateway behavior remain unverified. This alone does not prove authenticated frontend sign-in is broken. |
| Secure action CORS OPTIONS | **200** for `http://localhost:3000`, allowing POST/OPTIONS and the existing SDK header set |
| Initial sandbox requests | Failed DNS resolution (`ENOTFOUND`). Repeating the same GET/OPTIONS audit outside the sandbox succeeded. This was an environment boundary, not an application fix. |
| Management access / deployed bundle / secrets | Not inspected. No management access token was configured in the current process. A no-install CLI check found no available package and stopped; no CLI installation or management command followed. No credential-store extraction was attempted. |
| Migration ledger | **Not inspected**. REST OpenAPI does not expose the private migration ledger; production SQL was explicitly forbidden. |
| PostgreSQL version | Local admin development configuration requests major 15; the linked-project cache records `17.11.0.002`. That cache is historical, not a current server-version attestation. |

The successful metadata request establishes current connectivity and visibility under the configured service credential. It does **not** establish end-user authorization, RLS correctness, helper-function bodies, successful financial operations, current gateway JWT settings, or schema history.

Evidence: [remote metadata](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-readiness/remote-metadata.json), [local/schema comparison and artifact hashes](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-readiness/local-comparison.json), [public-key classification without values](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-readiness/public-key-classification.json), [audit scope](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-readiness/audit-scope.json).

## 2. Prerequisites: what is actually established

These remote results are from the service-role OpenAPI schema cache. They confirm advertised names and column/argument types, not complete database definitions or ACLs.

| Prerequisite | Current remote metadata | Remaining verification |
|---|---|---|
| `loan_applications` | Present. Required rejection columns `id`, `application_id`, `member_id`, `status`, `date_approved`, `date_released`, `date_completed`, `updated_at` all present, with expected UUID/text/date/timestamptz shapes | Unique application identifier, allowed status CHECK including `rejected`, foreign keys, RLS/grants, update triggers and data invariants |
| `members` | Present. `id`, `user_id`, `first_name`, `last_name`, `status` all present | Unique non-null Auth linkage, account/profile consistency, RLS/grants and active-account policy |
| `admin_activity_logs` | Present. UUID identifiers, text action/target/result, JSONB `details`, timestamptz `created_at` present | Defaults, foreign keys, result CHECK, owner, immutable access, triggers, existing request-ID duplicates/index collisions |
| `admin_action_grants` | Present. Actor/action/target/fingerprint/token-hash/expiry/consumed-at columns present | Durable single-use implementation, expiry, active-role checks, uniqueness, ACLs/RLS and server-only issuance/consumption |
| `admin_security_attempts` | Present, required actor and attempted-at columns present | Rate-limit helper definitions, permissions and retention |
| `notifications` | Present. `id`, `user_id`, `title`, `message`, `type`, `read`, `created_at` present | Defaults, `loan_rejection` type allowance, recipient FK, inbox/outbox triggers, RLS and write privileges |
| `auth.users` | Hosted Auth health responds; Auth schema is outside the inspected public OpenAPI definition set | Exact `id`, trusted `raw_app_meta_data`, ban field and relevant ownership/access must be checked privately |
| `is_active_secure_admin(uuid)` | Advertised, argument `p_user_id uuid`, GET/POST metadata consistent with a stable helper | Exact SQL body, trusted owner, search path and EXECUTE privileges |
| `issue_admin_action_grant` / `consume_admin_action_grant` | Advertised; expected UUID actor and text action/target/fingerprint/token-hash arguments match canonical calls | Exact implementations and permissions; metadata alone does not prove atomicity or expiry enforcement |
| Security rate-limit/failure/reset helpers | All three advertised with `p_user_id uuid` | Definitions, grants and failure behavior |
| Approval dependencies | `loan_policy_settings` and `loan_documents` are advertised | Full deployed policy/document shape, function source and authorization must match before replacing the shared dispatcher |

Local source references establish the expected shapes through canonical schema/security migrations 001/004/006/013/023 and the existing notification/release additions. **These files are comparison references, not a list of migrations to replay.** The backend README/runbook warns that historical versions 001–007 were absent from the ledger while objects already existed. This audit did not treat that historical observation as a current ledger result.

## 3. Deployed metadata versus the proposed addition

| Object | Remote metadata today | Local proposed migration |
|---|---|---|
| `loan_rejection_capability(uuid)` | Not advertised | Adds version 1, 2,000-character reason limit, Pending/Under Review statuses; service-role EXECUTE only |
| `reject_loan_application(uuid,text,text,uuid,text)` | Not advertised | Adds transactional decision/audit/inbox RPC; service-role EXECUTE only |
| `loan_rejection_details(text)` | Not advertised | Adds narrowly scoped administrative metadata reader; authenticated EXECUTE with active-admin checks inside |
| `loan_rejection_request_unique` | Index catalogs not available through this inspection | Adds a unique partial expression index on successful rejection request IDs |
| Tables / financial columns | Core tables already advertised | No new table, application column, financial column or status value |

The three missing advertised RPCs are consistent with the feature not being deployed. They are **not absolute proof of physical absence**: hidden permissions, schema-cache state or an incompatible overload require catalog inspection. `CREATE OR REPLACE FUNCTION` can replace an existing definition; `IF NOT EXISTS` can skip an incorrectly defined same-name index. Both cases must be resolved before execution.

The two migration copies are byte-identical:

- [Canonical backend 027](C:/Users/zylcee/Desktop/COOP/coop_backend/supabase/migrations/027_secure_loan_rejection.sql)
- [Admin repository mirror](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/supabase/migrations/20261110_secure_loan_rejection.sql)

SHA-256: `f803c4be2d43df10394a2ca5bed8cec74b680b1871717ed6d3a826d4e7d64344`. They are **one logical addition**, not two migrations to apply separately. The actual migration ledger and its reconciliation policy remain a deployment gate; do not mark old versions applied or infer history from cache files.

## 4. Canonical Edge Function and frontend compatibility

The correct deployment entry point is [backend `supabase/functions/secure-admin-action/index.ts`](C:/Users/zylcee/Desktop/COOP/coop_backend/supabase/functions/secure-admin-action/index.ts), which imports [the canonical edge-functions implementation](C:/Users/zylcee/Desktop/COOP/coop_backend/supabase/edge-functions/secure-admin-action/index.ts). Deploying the admin repository's separate same-named function would select the older implementation, not this rejection workflow.

Local source checks confirm:

- Caller identity is verified through Auth `getUser`; authority uses trusted `app_metadata.role === super_admin`, active account/profile and ban checks. Ordinary Admins are not given a loan-decision privilege.
- Password verification uses Auth `signInWithPassword`, with existing rate-limit/failure handling. The durable grant fingerprint includes request data, and consumption binds actor, action, target and fingerprint.
- The rejection branch invokes **`reject_loan_application`** with server-derived actor ID, application ID, reason, request UUID and expected status. It returns only after the RPC response confirms `rejected`; separate duplicate success auditing is skipped because the transaction owns that audit.
- Required reason/request/status checks occur before grant issuance. Generic `update-loan-status` requests for `rejected` are blocked from this dispatcher.
- The UI sends `{ mode: "loan-rejection-capability" }`; the function returns the raw capability object, matching the frontend's version, reason-length and two-status checks. A failed/old backend returns unavailable. A submission rechecks capability.
- The existing security provider still owns password → confirmation → execution → result. Admin UI visibility is not the authorization boundary.

The saved implementation diff shows the approval, release and authentication branches were preserved relative to the **pre-change local source**. It does not compare against the current deployed package, which was not retrieved.

### Important release-path discrepancy

The canonical dispatcher still contains a legacy `release-loan` branch calling `release_loan(text)`. That RPC is **not advertised** by the inspected service-role schema; `release_approved_loan(...)` **is advertised**. The current frontend LoanRelease service calls the latter directly, matching its advertised arguments. Therefore this is not proof that the active release UI is broken, but the legacy branch and any other consumers need an owner-confirmed compatibility decision before replacing the shared production dispatcher. Do not recreate a missing financial RPC or redirect it speculatively during this audit.

The pre-existing generic status branch also retains broader approval/release status updates outside the new rejection guard. This was already recorded in the local phase-4 audit; this task neither fixed it nor proved deployed reachability. Comparison with the exact production artifact is necessary to avoid introducing or restoring a weaker shared branch.

### JWT, origins and runtime

The admin repository explicitly sets `secure-admin-action.verify_jwt = false`; the canonical backend has no such override for that function, and its runbook requires gateway JWT verification enabled. **Actual deployed JWT configuration is unknown.** Successful CORS OPTIONS does not attest to gateway authentication or prove the deployed source revision. Preserve the reviewed security configuration rather than disabling verification to resolve rollout issues.

The localhost origin preflight works, but production frontend origins, remote secret presence, Deno import/runtime compatibility and native Edge packaging remain unverified. Server-only environment names required by the canonical source are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` or its existing anon-key fallback, plus the reviewed exact origin allowlist. No remote secret values were requested or displayed.

## 5. Risks and blockers

| Priority | Finding | Required clearance |
|---|---|---|
| Blocking | Current migration history and exact SQL catalog were not inspected | Separately authorize private catalog/ledger inspection or provide a current trusted metadata export; reconcile against the reviewed addition without replaying history |
| Blocking | Active-Super-Admin/grant helper bodies, RLS/ACLs, function owners and custom/default EXECUTE grants are unverified | Verify trusted owner/search path, real role/status/ban checks, durable one-use grants, and no public/anonymous/authenticated access to the mutator/capability helpers; inspect all custom/default grants |
| Blocking | Exact deployed function revision/JWT configuration is unavailable; two conflicting local deployment roots exist | Capture the production revision/configuration privately and compare the full dispatcher with the canonical artifact, including unchanged account/approval/release branches |
| Blocking | Legacy release dependency is not advertised; generic financial status branch remains unresolved | Confirm active consumers and safe shared-function compatibility; do not add new financial behavior to make deployment succeed |
| Blocking | Notification constraints/defaults/triggers and audit/index integrity unverified | Confirm `loan_rejection` allowance, user-addressed inbox early return, recipient/default behavior, and absence of duplicate request IDs/same-name incompatible indexes |
| Blocking | Recoverable backup/PITR and restoration rehearsal not verified | Confirm a current recovery point and rehearse rollback/forward recovery in an isolated environment |
| Operational | Plain `CREATE UNIQUE INDEX` scans existing audit data and can block writes; duplicates abort the transaction | Review size, lock budget and maintenance timing. Do not substitute `CONCURRENTLY` inside this transaction or split the artifact without a separate review |
| Operational | Applying database support plus deploying the capability-aware function enables the action on clients' next capability fetch | Plan a controlled activation window. There is no independent activation switch in the current contract |
| Operational | Local Postgres major setting differs from linked cache; native Deno deployment not tested | Confirm current server/runtime versions and test the exact artifact in staging |
| Verification gap | Public OpenAPI request was 401; authenticated browser/mobile behavior was not exercised | Verify public-key/gateway behavior and real authorized sessions in the later approved verification phase |

A notification failure is intentionally transaction-fatal: rejection and successful audit roll back together. Missing linked Auth recipients intentionally skip inbox creation; no delivery is fabricated. Internal reasons remain in private administrative audit data, not member-readable application columns or inbox messages. Runtime audit/notification triggers could change these assumptions and must be inspected.

## 6. Effect of applying the migration

**The reviewed migration itself does not update existing loans or financial data.** Its top-level statements are BEGIN, one index creation, three function definitions, EXECUTE privilege changes for those functions, and COMMIT. The loan UPDATE and audit/notification INSERT statements are inside the mutator function body; they are not executed by defining it. No principal, interest, fee, balance, allocation, repayment or release value is backfilled or recalculated. No existing application is automatically rejected.

The index reads existing audit entries and may take locks; CREATE OR REPLACE/ACL changes affect executable definitions. An incompatible existing object or duplicate key can fail the migration. Unknown remote DDL event triggers and SQL object state still require review. This is a source-level effect assessment, not a completed production rehearsal.

## 7. Required order for a separately approved rollout

1. Resolve the NO-GO items: obtain current private catalog/ledger and deployed-function evidence; validate owners, constraints, defaults, triggers, grants and index/data integrity; identify all shared-function consumers. Confirm the exact hosted project and authorized deployment owner.
2. Capture recoverable backups/current function revision/configuration, confirm restoration procedure, pin the reviewed artifacts and stage them against a representative schema/runtime. Use synthetic decisions only in non-production; include real multi-session race/replay and notification failure tests there.
3. Schedule the controlled maintenance/activation window. Ensure administrators understand that the capability becomes available when both halves are present; keep business decisions outside smoke testing.
4. Apply **only the single reviewed forward rejection addition**, as its complete transaction, through the approved schema process. Do not replay prior migrations, run a broad push/reset, or mark unrelated migrations applied. Stop on any failure and verify rollback before revising the plan.
5. Verify committed definitions, function ownership/search paths, ACLs/RLS, index validity, existing triggers and schema-cache visibility before making the function advertise readiness.
6. Deploy **only the named canonical secure-admin-action entry point**, using its reviewed configuration and exact project. Preserve gateway authentication and existing origins/secrets; do not deploy all functions or the older admin-repository implementation.
7. Verify remote revision/configuration, read-only capability and authenticated route/menu behavior. Release the maintenance window only after approved checks pass. Deploy/reload the matching frontend as needed; existing open tables may retain their previous availability state until remount/reload.

These are preparation steps, **not commands executed or authorization to execute them**. This rejection rollout order differs from the old All Accounts cutover; the historical runbook is not a ready-made deployment procedure for this addition.

## 8. Safe post-deployment verification plan

Requires a new authorized phase. None of these production SQL/RPC/authenticated checks was performed here.

- Privately compare the deployed migration/functions/ACLs/indexes with the pinned artifacts, including grants for public/anon/authenticated/service/custom roles and unchanged loan-table RLS. Verify the helper definitions rather than relying on names or a capability version.
- Repeat health/schema metadata/CORS checks; verify actual deployed JWT settings and exact configured origins separately.
- Using existing authorized sessions, verify capability version 1, reason limit 2000 and exactly Pending/Under Review. Confirm Admin/member/invalid sessions cannot acquire rejection authority. Capability is read-only but is still a database RPC, so it requires later authorization under this audit's restriction.
- Verify eligible menus, required reason, mobile scrolling and cancel/unsaved-change behavior. Do not enter verification/execute mode or make a production decision as a smoke test.
- Read an already authorized Rejected record. Historical missing reasons are legitimate; metadata errors must remain explicit. Confirm release/payment details remain absent and private reasons cannot be read by members.
- In staging, exercise the full password/grant/confirm/reject flow, both allowed statuses, all forbidden statuses, stale approval/release, duplicate requests, changed payloads, rollbacks and single generic inbox delivery. Confirm the Rejected filter and existing approval/release behavior with the exact deployed artifacts.
- Verify mobile tracking and the existing inbox through their normal supported reads in the approved test environment. Production notifications should arise only from legitimate separately authorized business decisions, not test transactions.

## 9. Rollback and recovery

- Before execution, preserve current function definitions/ACLs/index definitions, current deployed Edge revision/config and a recoverable database backup. Do not assume the prior local source is the production rollback artifact.
- A failure before COMMIT normally rolls back this transactional DDL/index addition. Stop, confirm catalog state and investigate; do not retry selected fragments or change migration history to conceal a failure.
- If activation must be contained, the approved emergency plan must deny **new and already-authorized rejection execution**, while preserving unrelated actions. Disabling only the capability response hides new entry points but does not revoke an already-issued grant or block an in-flight confirmation.
- Prefer a reviewed rejection-specific containment/forward correction. Blindly restoring the older status-only rejection branch would reintroduce reasonless, nontransactional rejection. Do not disable authentication/RLS or remove shared grant functions to contain this one feature.
- Leave legitimate rejection decisions, successful audits and member inbox rows intact. Do not auto-return applications to Pending, delete audit/notification evidence, or reverse financial operations as a rollback technique.
- Removing new functions/indexes, if later approved, must be dependency-reviewed and preserve existing tables/records. A broad database restore after subsequent loan/payment activity could discard unrelated financial transactions and requires a separate recovery decision, not routine feature rollback.

## Evidence and unfinished inspection

The audit reran **29 targeted local tests: 29 passed, 0 failed**. These cover the actual local migration in isolated PGlite, the canonical handler with mocked Auth/grant transport, frontend contract validation/listing and curated details. No native Deno, live grants, authenticated application flow or multi-connection production concurrency test was run. UI/build results from the preceding implementation task are historical evidence and were not re-claimed as newly run in this audit.

Prepared [catalog-preflight.sql](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-readiness/catalog-preflight.sql) is **not executed**. It contains read-only catalog/ledger guidance and aggregate integrity checks for a later separately authorized DBA review; it does not invoke rejection, grant, password or financial RPCs. Keep definitions/metadata exports private and redact embedded secrets before sharing.

The audit-only [metadata inspector](C:/Users/zylcee/Desktop/COOP/coop_frontend_admin/docs/loan-rejection-readiness/inspect-metadata.mjs) permits only fixed health/OpenAPI GET and CORS OPTIONS targets, refuses a target that differs from the linked HTTPS project, blocks redirects and saves filtered schema metadata rather than credentials or records.

**Final decision: NO-GO for production deployment; local implementation is a viable candidate for controlled staging and completion of the missing production readiness evidence.** Connectivity is available. The remaining limitation is unverified production catalog/history/configuration under the explicit no-SQL/no-deployment boundary, not lack of a working frontend or a reason to relax security.
