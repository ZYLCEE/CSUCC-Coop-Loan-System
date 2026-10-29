# Backend and security review — 29 October 2026

**Assessment: not ready for public production use.** This was a scoped code review,
dependency audit, local mocked-handler tests and read-only live access checks,
not a complete penetration test. No live financial records, account roles,
passwords or database policies were modified during this review.

## Priority findings

### 1. Critical: installed Next.js release has published security advisories

- Installed: Next.js **16.2.12**, running on Windows.
- `npm audit --omit=dev` reports **one critical and four high affected packages**:
  `next`, `sharp`, `postcss`, `nanoid`, `source-map-js`. These are package counts,
  not five independently proven exploitable application vulnerabilities.
- GHSA-p293-qw3h-jr36 includes Next 16.2.12 in its Windows-hosted RCE affected
  range; its stated patch starts at 16.3.3. Another reviewed advisory includes
  Next releases through 16.4.0 and specifies Next 16.4.1 / sharp 0.35.5 fixes for
  its Linux image-optimization scenario. Applicability differs by platform and
  enabled feature; not every audit advisory was reproduced against this app.
- Upgrade to a current supported release covering the complete advisory set,
  inspect its bundled migration guides, then rerun audit, build and regression
  checks. Do not blindly apply `npm audit fix --force` or treat the Windows fix
  alone as covering every reported issue.
- References: https://github.com/advisories/GHSA-p293-qw3h-jr36 and
  https://github.com/advisories/GHSA-2464-fhr4-w9xw.

### 2. Critical exposure risk: server secret was shared in chat

The server-side Supabase key was supplied in this conversation and remains in the
local environment. Treat it as exposed: replace/revoke it through Supabase and
update the local environment and relevant deployments. No key material is
included in this report. The environment/credential files are ignored by Git;
`git ls-files '.env*'` returned no tracked files. The earlier browser-bundle scan
also found no copy of the server key. These checks do not make a shared key safe.

### 3. High: user-editable metadata can authorize privileged backend requests

`supabase/functions/secure-admin-action/index.ts:104` falls back from
`app_metadata.role` to `user_metadata.role`. For accounts without an app role,
user-controlled metadata can supply an administrative role. The handler also
accepts ordinary Admin roles for the same action dispatcher used for Super Admin
operations, without a separate action/role matrix.

Reproduced against the **local checked-in handler with a mocked SDK**: a user
having no app role and `user_metadata.role=admin` passed its authorization check.
This does not prove the separate deployed Edge Function has the same code.

Use only server-controlled identity/role data and enforce per-action permissions
and current active/blocked status on the server. Supabase explicitly warns
against using editable user metadata in authorization:
https://supabase.com/docs/guides/auth/users.

### 4. High: verification grant is not bound to the executed request

The local handler stores `action` and `target` with a grant, but execution at
lines 156–164 checks only user ID and expiry. It never compares the requested
action/target or payload to the verified request. A grant approved for one request
can therefore authorize another supported request.

Reproduced in the mocked local handler by verifying a preview action and executing
a different action/target. No external notification was sent. Bind a durable,
single-use grant to user, action, target and a canonical request fingerprint.
The live database already exposes issue/consume grant RPCs, but their actual SQL
definitions and the deployed handler's usage were not available for inspection.

### 5. High, conditional: development verification accepts any nonempty password

At lines 113–120, development/local mode with no configured action password accepts
any nonempty password. There is no rate limiting in this checked-in verification
branch. Accidentally enabling this mode in a reachable deployment removes genuine
password re-verification. Its process-local Map also makes grants unreliable
across Edge Function instances or restarts.

Require real identity re-verification, enforce a persistent attempt limit, and
fail closed when required configuration is absent. Live deployment environment
variables were not inspected.

### 6. Medium: file upload trusts extension and client-provided MIME type

`src/app/api/admin/resources/route.ts:57–69` checks filename extension and size,
then stores the caller-provided `file.type`. It does not inspect file signatures
or guarantee content matches the claimed format. A Super Admin/compromised admin
can host mislabeled or active content through an allowed-looking filename.

Validate file signatures and set MIME types on the server; consider forced
download, malware scanning and explicit private/no-store responses containing
signed URLs. Signed URLs are bearer access until their expiry:
https://supabase.com/docs/guides/storage/serving/downloads.

### 7. Medium: new resource writes lack durable action audit entries

Document upload/delete and private configuration writes in the Next.js resource
API do not write an application audit event. Audit Logs cannot reconstruct who
made these changes. Add durable actor/action/target/result events and define
retention. The generic read API also returns entire database rows through a
service-role client: use explicit field lists and a documented per-resource
permission matrix to reduce unnecessary personal/financial-data exposure.

## Additional code concerns

- `src/lib/api.ts:221` discards `grantToken` and directly updates loan status.
  No callers were found in the current UI, so this is a latent helper hazard,
  not a demonstrated live approval bypass. Database enforcement remains decisive.
- The checked-in Edge Function's account handlers still return placeholder
  success, and notification persistence errors are swallowed. Do not deploy
  this local source over the live function as a production implementation.
- Unused `PasswordSection.tsx:17` logs password form data. It is not imported by
  the active profile route, but must be removed before reuse.
- Configuration writes replace whole storage objects without optimistic
  concurrency checks, so concurrent administrators can overwrite each other's edits.
- Request size limits are checked after parsing/reading bodies; there is no
  per-user request rate limit on the resource API. Harden these before exposure.

## Live checks that passed

Using one owned demo Member account and head/count-only queries (no private row
contents printed):

| Check | Observed result |
| --- | --- |
| Other users' member profiles | 0 visible rows |
| Other users' loan applications | 0 visible rows |
| Other users' savings accounts | 0 visible rows |
| Other users' notifications | 0 visible rows |
| Member access to administrative activity/grant tables | 403 |
| Anonymous access to members, applications, payments, notifications and grants | 401 |
| Member calls to announcement/notification service status | 403 |
| New local admin API anonymous/member tests from prior verification | 401 / 403 |

The member's OpenAPI/schema-discovery request was denied; no permissions were
inferred from its error response. The private document bucket and short-lived
signed downloads passed the prior connectivity check.

## Unverified areas

- Full live RLS policies, column-level write grants, trigger definitions and
  security-definer function definitions require a database-side policy export.
- The source imported by `list-admin-accounts/index.ts` is outside this checkout.
  The actual deployed `secure-admin-action` source is also unavailable here;
  local-code findings must not be presented as proven live exploits.
- INSERT/UPDATE/DELETE permissions were not probed by changing real records.
  Passing SELECT isolation checks is not proof that writes are safe.
- No live privilege-escalation, grant substitution, password-guessing, malicious
  upload, notification delivery or financial-action exploitation was attempted.

## Recommended order

1. Rotate the shared server key and upgrade vulnerable dependencies.
2. Obtain and audit the real deployed backend source and database policies.
3. Correct trusted-role checks, action-bound grants and re-verification controls.
4. Add upload-content validation, audit events, data minimization, body/rate limits
   and configuration concurrency control.
5. Run allow/deny tests for every role and every write action before production.
