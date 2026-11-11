# Phase 4 security findings

Severity reflects the potential impact and the tested preconditions. Every finding is local unless explicitly described as a deployed verification gate. Locations are relative to the admin project. Sibling paths identify separate source trees.

## P4-01 · Critical if reachable · Unsafe portal Edge Function authorization and grant binding

- **Where.** `supabase/functions/secure-admin-action/index.ts:97–165`. The function falls back to mutable user metadata, supports an arbitrary nonempty password in its development mode, and stores grants in an isolate-local map. Execute checks actor and expiry but accepts a different action or target. Payload is also outside the binding.
- **Evidence.** A local mock with a blocked account, missing trusted role and spoofed user metadata obtained a grant when development fallback was enabled. A local grant for one action and target was accepted for another. Same-isolate replay was rejected. With development fallback off and no configured password, verification was denied.
- **Impact.** If exposed with the demonstrated preconditions, untrusted actors or holders of a grant could reach privileged execution branches outside the verified scope. The mock established acceptance and branch reachability. It did not establish production exposure or a production financial mutation.
- **Correction and tests.** Establish the authoritative deployable function, fail closed on missing trusted role and inactive/banned status, remove shared/development verification from deployed code, and bind durable atomic grants to actor, action, canonical target, payload, and expiry. Test ordinary and blocked actors, wrong password, changed payload, expiration, cross-instance replay, and parallel consumption. If the unsafe build is deployed, contain the function and review privileged execution logs through the incident owner.

## P4-02 · High · Legacy authenticated RPC bypasses payment allocation review

- **Where.** `supabase/migrations/20261029_fix_counter_payment_method.sql:4–50`, `20261108144000_automatic_counter_payments.sql`, and `20261108180000_counter_payment_interest.sql` under the same directory.
- **Evidence.** An isolated PGlite extension of the automatic-payment fixture submitted a synthetic receipt with a changed allocation. The reviewed RPC rejected it. The authenticated Super Admin could write the same receipt through the legacy RPC with caller-selected principal and zero interest/penalty. This is an alternate Super Admin write path. An ordinary Admin bypass was not demonstrated.
- **Impact.** An alternate caller can evade allocation review, impair balances, interest and penalties, and create a receipt inconsistent with the UI confirmation.
- **Correction and tests.** Inventory deployed RPC consumers, revoke authenticated execute for the legacy writer, keep owner-only internal invocation from the reviewed wrapper, and verify grants under authenticated Admin, Super Admin, anonymous, and internal roles. Add genuinely concurrent duplicate and reversal tests against isolated PostgreSQL.

## P4-03 · High · Competing Edge implementations and false success

- **Where.** Portal `supabase/functions/secure-admin-action/index.ts` execute and preview branches, `src/components/members/MemberFormModal.tsx:136–150`, and sibling `../coop_backend/supabase/edge-functions/secure-admin-action/index.ts` with `../coop_backend/supabase/migrations/006_super_admin_secure_actions.sql`.
- **Evidence.** Local mock account creation returned success with zero writes. A forced legacy notification insert failure also returned success. Portal preview shape differs from the active member form contract, and review/approve are missing from the portal Edge implementation. The active outgoing notification composer uses the separate Next handler. The sibling backend implements real account actions, verifies Auth credentials and uses atomic DB grants.
- **Impact.** Which build serves the portal determines whether actions fail, falsely succeed, or reach the intended authorized mutation.
- **Correction and tests.** Reconcile CI deployment roots and record exact deployed revisions. Contract-test top-level preview, verification and execution for every active action, persistence failures, and audit outcomes. Verify both browser-to-function routing and the underlying stored result.

## P4-04 · High · Generic loan status action can bypass transition-specific controls

- **Where.** Sibling `../coop_backend/supabase/edge-functions/secure-admin-action/index.ts:729–747`, generic `update-loan-status` branch, alongside explicit review, approval and rejection handlers.
- **Evidence.** Source shows a generic status update separate from the explicit approval and release rules. The normal loan list uses the dedicated actions. No active UI caller or deployed reachability was established. A valid privileged caller and grant would be prerequisites.
- **Impact.** If exposed, a direct transition can leave incompatible dates, release amounts, documents, or audit records and confuse downstream tracking.
- **Correction and tests.** Inventory external callers and close or constrain the generic branch. Test invalid transitions, missing release attributes, retry and concurrent review, and audit persistence on failure.

## P4-05 · High · Release quote can drift between preview and commit

- **Where.** `src/lib/loanRelease.ts:15–55` and `supabase/migrations/20261108180000_counter_payment_interest.sql` release RPC.
- **Evidence.** Source shows the release request passes the expected principal. The RPC checks it and reads current fee and interest policy at execution. A reviewed policy version or full quote fingerprint is absent from the commit contract. In an isolated release test with an unchanged 1,000-unit principal, the reviewed 1% processing fee was 10 units. After policy changed to 4%, the same confirmation contract committed a 40-unit fee. Existing SQL tests also cover release and idempotency.
- **Impact.** A changed policy can produce committed charges that differ from the amount breakdown reviewed by the actor.
- **Correction and tests.** Bind all reviewed terms to the request and require new review when the policy changes. Prove stale policy and amount changes write nothing, retries are idempotent, and one of two competing releases wins.

## P4-06 · Medium · Document type verification trusts metadata

- **Where.** `src/app/api/admin/resources/route.ts:89–105`, upload and signed URL branches.
- **Evidence.** In an isolated handler mock, a text payload carrying a PDF filename and PDF MIME label reached storage and returned success. Traversal and loan-attachment deletion checks passed their negative tests. Private buckets are requested on creation and short-lived signed URLs are used. Existing deployed bucket settings and policies were unavailable.
- **Impact.** A privileged uploader could store unexpected content behind a trusted document label. Downstream impact depends on delivery headers and viewer behavior.
- **Correction and tests.** Validate content signatures and dangerous type mismatches before storage, verify bucket and signed-download policy, and test oversize, malformed, polyglot, missing-file, and cross-account cases. Audit upload and delete with actor and object identity.

## P4-07 · Medium · Release classification and collection completeness

- **Where.** `src/app/api/admin/resources/route.ts:30–38` and its paged table reader, `src/lib/api.ts:156–172`, `src/components/reports/ReportWorkspace.tsx`.
- **Evidence.** The isolated resource handler included a synthetic released row with no release date. A short mock page under a server cap caused collection to stop while records remained. The loan application list also uses an unpaged query. Browser filter and CSV fixtures passed with small datasets.
- **Impact.** Active Loans can list a malformed record. Lists, reports and exports can silently omit records or show totals based on incomplete inputs.
- **Correction and tests.** Define consistent released-state invariants and reconcile existing exceptions in staging. Use stable pagination and explicit completeness across list, report and export consumers. Test caps, equal timestamps, adjacent period boundaries, large sets, and read errors.

## P4-08 · Medium · Auditability and error-response gaps

- **Where.** `src/app/api/admin/resources/route.ts`, `src/app/api/admin/privileges/route.ts`, sibling `secure-admin-action/index.ts`, and the scheduled announcement migrations in both repositories.
- **Evidence.** Source review found document/configuration storage writes without an explicit activity-log write in their route, some raw upstream error messages, privilege changes with a read-before-update version comparison, and separate secure-action audit writes. The admin and sibling announcement migrations also define overlapping scheduler concerns, and only the sibling migration reviewed defines the member-facing view. Existing tests exercise local optimistic announcement concurrency, private alerts and permission denials.
- **Impact.** Operational failures can be hard to distinguish from missing data. Some privileged mutations may have incomplete attribution or last-write-wins behavior. Scheduling/view behavior depends on the applied migration set.
- **Correction and tests.** Verify actual audit coverage and scheduler state, define a sanitized client error contract, and use durable correlated events or atomic audit writes for sensitive actions. Test simultaneous grant edits, storage failure, audit-write failure, and exactly-once scheduling.

## P4-09 · High deployment gate · Affected dependency and credential evidence gaps

- Installed Next.js `16.2.12` is within the official affected ranges for image optimization, including SVG rejection bypass in self-hosted deployments and a glibc Linux image-processing advisory with a Sharp version condition. The portal imports `next/image`. Actual hosting, input reachability, and native runtime were not established. The linked fixes are at least Next.js `16.4.5` for the cited SVG advisory and Sharp `0.35.5` for the cited native advisory. [Next.js SVG advisory](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2) · [Next.js native image advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) · [Next.js AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
- Other reviewed advisories have feature-specific preconditions. No current `use cache`, `next/og` or raw upstream proxy route was identified. Confirm effective hosting configuration and verify the supported patched release and its transitives. The full dependency tree scan could not be completed. [Next.js cache advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) · [Next.js image response advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) · [Next.js upstream response advisory](https://github.com/vercel/next.js/security/advisories/GHSA-pc58-hwjq-p385)
- The installed Next.js tree includes PostCSS `8.4.31`, within the cited source-map and stylesheet-output affected ranges. Tailwind’s separate PostCSS `8.5.32` is above those ranges. The checkout processes project CSS at build time. No path feeding user-controlled CSS to PostCSS was identified. Confirm the nested dependency resolution after upgrading. [PostCSS source-map advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp) · [PostCSS output advisory](https://github.com/postcss/postcss/security/advisories/GHSA-qx2v-qp2m-jg93)
- React and React DOM are `19.2.4`. The RSC advisory targets specific `react-server-dom-*` packages and has typed-array response preconditions. The top-level React version alone cannot establish exposure for a framework-bundled implementation. The local production manifest contained zero Node and zero Edge Server Actions. Confirm Next.js runtime patch coverage and compare the deployed manifest. [React RSC advisory](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) · [Next.js Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
- The reviewed worktree excludes `.env.local` from Git. Service-role references were found in server API code. Earlier security documentation reports a credential disclosure. Current rotation, revocation, history, deployed secret provenance, and effective policies are verification gates. Obtain redacted rotation evidence and verify that the old credential is invalid. Use a trusted CI runner or approved scanner for the full advisory inventory.

## Database and API boundary review

- **Member ownership and references.** Sibling migrations 016–018 establish member app access and document/loan linkage. Attachment policy uses the authenticated member's path and related application ownership. Approval migration 023 restricts direct writes. Production effective policies, foreign-key cascade behavior for account deletion, and older rows were not inspected.
- **Financial integrity.** Portal SQL uses request-ID uniqueness and locked loan rows for release and payment updates. The release terms trigger snapshots policy-derived terms. Isolated fixtures exercise validation, audit records, reversals and serialized replay. P4-02 demonstrates that a function execute grant can bypass the intended reviewed entry point despite those controls.
- **Announcements and private notifications.** Announcement tables enable RLS, reference a category and revoke direct authenticated writes. Scheduler functions have restricted execute grants. The private submission alert policy and trigger were verified in the isolated suite. Actual job ownership, outbox recipient integrity and Realtime publication were not verified.
- **Server API boundaries.** Four Next handlers check a bearer through live Auth before privileged data access. The resource handler uses service-role access and an explicit resource allowlist, but generic table reads select all columns. Confirm column minimization, including raw-row CSV exports. Notification, profile and privilege handlers set `no-store`, as do table/document GETs. General settings GET lacks an explicit cache header. Some upstream failures can be collapsed into empty settings or returned as generic 400s with exception text.
- **Verification and throttling.** The sibling Edge Function has a database-backed attempt check with a 429 path and fails closed when the limiter fails. The unsafe portal fallback lacks equivalent durable controls. The notification Next route uses independent Auth verification and idempotent outbox IDs. No separate route-wide rate cap was established. Verify hosted Auth limits, proxy limits and retry behavior before staged load testing.
