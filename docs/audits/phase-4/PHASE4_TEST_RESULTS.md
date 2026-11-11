# Phase 4 test results

Date: November 9, 2026. Windows workspace, Node.js v25.2.1, npm 11.6.2 and Next.js 16.2.12. The repository contained existing worktree changes. The audit added only documentation. Browser testing used local Chromium with synthetic accounts/data and external host resolution blocked. Isolated database suites used PGlite with synthetic rows. The production build was a local compilation.

## Commands and results

| Check | Command or harness | Actual outcome |
|---|---|---|
| Full ESLint | `npm run lint` | Passed, 0 errors and 0 warnings |
| TypeScript | `npx --no-install tsc --noEmit` | Passed |
| Production build | `npm run build` | Passed. Compilation, type checks, page data, and all 20 static outputs completed. |
| Application tests | Node test runner over `rg --files src -g '*.test.mjs'` | 103 passed |
| Script tests | Node test runner over `rg --files scripts -g '*.test.mjs'` | 7 passed |
| Isolated database suites | Node test runner over `rg --files supabase/tests -g '*.test.mjs'` | 5 passed. Announcements, automatic and legacy counter payments, release, private submission alerts. |
| Worktree whitespace | `git -c core.safecrlf=false diff --check` | Passed for tracked changes. Audit Markdown checked separately because the new directory is untracked. |
| Dependency audit | `npm audit --json` | Default sandbox could not resolve the registry. Automatic approval review rejected the network retry because it would send dependency inventory to a public registry. No inventory was uploaded by the rejected retry. Installed versions were checked against public maintainer advisories separately. Full dependency-tree status remains unavailable. |
| Secrets boundary | Git ignore and tracked path review, source and generated browser identifier searches | `.env.local` ignored. Server-only identifiers appeared in API code and were not found in emitted browser JavaScript. Historical commits, secret values, runtime logs, credential rotation and production config were outside this check. |

To reproduce the three repository test collections from PowerShell:

```powershell
foreach ($phaseSuite in @('src', 'scripts', 'supabase/tests')) {
  $phaseTests = @(rg --files $phaseSuite -g '*.test.mjs')
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-reporter=spec $phaseTests
  if ($LASTEXITCODE -ne 0) { throw "Test suite failed: $phaseSuite" }
}
```

## Local defect probes

These are negative probes, separate from the 115 existing tests and suites. A probe passing its expected assertion can demonstrate a defect. The temporary harnesses were run from the ignored `node_modules/.cache/coop-login-qa` directory and are not a committed regression suite.

| Probe | Scope and reproduction | Actual result |
|---|---|---|
| Portal Edge function | `phase4-edge-probe.mjs` evaluated the checked-in function with Deno environment, synthetic Auth users, fake credentials, and storage/API mocks. Verify as a blocked user with spoofable metadata in development mode. Verify one action/target and execute a different one. Force a persistence failure. | Demonstrated the authorization, grant scope, and false-success defects in P4-01/P4-03. Same-process replay and production-mode absent-password cases denied. |
| Resources API | `phase4-resources-probe.mjs` extended `src/app/api/admin/resources/route.test.mjs` with text labeled PDF, an undated released row and a lower server page cap. Run by resolved absolute path with Node. | All 16 assertions passed, including three defect reproductions. The first command with a relative path under `node_modules` was not resolved by Node's test runner. Direct execution by absolute path succeeded. |
| Payment allocation | `phase4-payment-probe.mjs` extended `supabase/tests/automatic-counter-payments.test.mjs`. In the synthetic DB, attempt an allocation through the reviewed path, then compare with the legacy writer as Super Admin. Also exercise minimum and invalid amounts. | One expanded suite passed. Reviewed write rejected the altered allocation and legacy write accepted it. No multi-session database concurrency was exercised. |
| Release quote | `phase4-release-probe.mjs` extended the release suite. Model a 1% reviewed fee on an approved synthetic loan, change policy to 4%, then send the same unchanged-principal confirmation. | The release succeeded and stored the new fee. The earlier fee and newly stored fee differed by 30 units. |

## Browser coverage

Both `/admin` and `/super-admin` checked for Dashboard, All Accounts, Loan Applications, Active Loans, Notifications, Announcements, Documents, Reports, Audit Logs, Settings, and Profile at **1920×1080, 1366×768, 1024×768, 768×800 and 390×844**. This was 110 route/size combinations. The route harness reported layout fit. It does not establish complete visual or keyboard coverage for every individual dialog.

| Local harness | Observed checks |
|---|---|
| `verify-handoff.mjs` | Ten synthetic sign-in scenarios. Wrong credentials, network, member and inactive remained on login. Both roles loaded expected destinations. Dashboard resource error, expired session, session network error and slow recovery were exercised. Reduced-motion handling was included in the handoff harness. |
| `phase4-session-probe.mjs` | Both roles passed reload with session persistence, wrong-role deep-link redirect, logout, Back to a prior dashboard history entry and protected URL after logout. The first sandbox run timed out before Chrome started. The approved localhost-only retry passed. |
| `verify-phase2-routes.mjs` | Both role shells at all five sizes for all 11 route families. |
| `verify-phase3-focus.mjs` | Chart tooltip, correct recent application and nested focus, mobile inbox wrap, account labels and validation, release/payment previews, and secure verification stage. No privileged execution request. |
| `verify-accounts-toolbar.mjs` | Live search/filtering, footer and view-only Admin controls. |
| `verify-loan-toolbar.mjs` | Name/member ID, combined filters, sort, page resets, pagination, filtered CSV and narrow layout. |

## Reliability coverage and gaps

- Exercised synthetic sign-in network and timeout failures, unauthorized API responses, missing stored document behavior, invalid inputs, stale announcement edits, release replay, duplicate notification handling and a forced legacy notification insert failure.
- Missing stored file and server pagination faults were distinguished. Dedicated browser fault injection for report generation, failed upload storage, live Auth invalidation and stale updates across simultaneous real clients was not completed.
- Live Supabase sign-in, role revocation, deployed functions/policies, Flutter runtime, real device notifications, scheduled job execution, true multi-session contention, real account mutations, receipt posting, settlement and exports against deployed volume remain unverified. No production tests, writes or notification sends were performed.
