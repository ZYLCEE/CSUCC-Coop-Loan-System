# All Accounts: Super Admin policy proposal

Status: **proposal for review only; not implemented or deployed**. The current server protection remains intact.

## Current authority

The canonical `coop_backend/supabase/edge-functions/secure-admin-action/index.ts` rejects targets whose trusted Auth role or member-profile role is Super Admin. Its existing block/delete self-protection is retained. `/api/admin/privileges` only accepts active ordinary Admin targets, and Super Admin access is inherited from the role rather than editable checkbox grants. All Accounts now reflects these boundaries.

## Proposed bounded policy

| Actor / target | Proposed permission |
| --- | --- |
| Member or ordinary Admin / any Super Admin | No administrative mutation authority. |
| Active Super Admin / own account | View; Edit through existing Profile flow. No self-block, self-delete or role demotion through All Accounts. |
| Active Super Admin / another Super Admin | Permit profile-only Edit and Block/Unblock after fresh server-validated password, bound grant, final confirmation and server revalidation. |
| Active Super Admin / another Super Admin's role | View inherited privileges. Keep promotion, demotion and per-account Super Admin privileges outside this change. |
| Active Super Admin / another Super Admin's password | No Reset Password action; retain existing account recovery mechanisms. |
| Active Super Admin / another Super Admin's deletion | Keep disabled until retention, audit attribution and dependent-record deletion policies are explicitly established. |

This is a narrower proposal than enabling every Church action. In particular, it does **not** enable Delete or editable Super Admin Role & Privileges. Neither is safely achieved by removing the current target-role guard.

## Required implementation safeguards before enabling

1. Check the actor's current trusted Auth role, active profile/status and ban state at verification and execution. Validate target Auth/profile identity consistency; deny mismatches.
2. Allow-list editable non-security profile fields. Exclude roles, authorization metadata, credentials, financial identifiers and ledger/audit attribution. Email changes must use an established authorized email-change flow.
3. Prevent blocking the last usable active Super Admin using a serialized transactional operation shared by all relevant status-changing paths. A separate `count` followed by an Auth API write is insufficient. The current profile/Auth two-step block branch requires a defined synchronization/recovery design first.
4. Bind the existing short-lived single-use grant to actor, action, target and reviewed payload. Revalidate the target and reject stale decisions; prevent duplicate execution/audit entries using the established security architecture.
5. Preserve audit attribution and financial references. Never cascade-delete loans, payments, release records or audit history. If deletion is later requested, inspect hosted dependencies and agree retention/recovery policy first.
6. Test parallel blocking, self-actions, last-active protection, role changes during verification, stale grants, unauthorized requests, Auth/profile synchronization failure, audit failure and rollback. Confirm existing approval/release/payment branches are unchanged.

No migration, RLS change, Edge Function deployment or hosted account operation is included in the current UI work. An approved policy and concrete implementation/deployment review are required before protected controls become actionable.
