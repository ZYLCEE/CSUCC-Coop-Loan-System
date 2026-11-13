# Dashboard reporting

Only the Dashboard content and its own components were redesigned. Sidebar,
navigation, authentication, existing application APIs, database and workflows
are unchanged. Removed widgets remain available as source components.

## Files changed

- `src/app/(admin)/dashboard/page.tsx`: the four-section layout, reporting-period
  selector and existing role-aware application navigation.
- `StatCard.tsx`, `DashboardMetrics.tsx`: the four responsive KPI cards, skeletons,
  real zero values and explicit unavailable/retry states.
- `ChartsSection.tsx`, `BarChartCard.tsx`, `DonutChartCard.tsx`: the 65%/35%
  desktop chart row, monthly application bars and loan-type counts for the
  selected reporting period.
  Charts stack below 1200px; desktop card heights and heading positions match.
- `loan-type-distribution.ts`: selected-period application counts, percentages
  and stable category colors derived from real loan records, with no extra API
  request.
- `RecentApplications.tsx`: the shared eight-column table of five latest
  applications, with a read-only details action.
- `dashboard-data.ts`, `dashboard-model.ts`, `useDashboardData.ts`: dashboard-only
  queries, validated aggregation, calendar ranges and shared request lifecycle.
- `dashboard-model.test.mjs`, `dashboard-data.test.mjs`,
  `loan-type-distribution.test.mjs`: reporting and transport validation tests.
  This README records data rules, gaps and validation results.

## Data sources and reporting rules

- One paginated read of the existing `loan_applications` table supplies all loan
  KPIs, trends and the five latest applications. Exact counts and duplicate checks
  prevent silently truncated reports. Retry reloads this shared snapshot.
- Pending Applications counts only `pending`, across the whole portfolio. Under
  Review is a separate supported state and is not counted as Pending.
- Active Members reuses `fetchAdminAccounts` / `list-admin-accounts`, including its
  trusted role and account-status resolution. It counts distinct, linked active
  Member authentication IDs, excluding administrative and unlinked/deleted users.
  The count is unavailable if that service cannot be reached or is not deployed.
- Monthly Net Disbursements sums recorded release principal less the recorded
  processing and service fees for records in `released`, `completed` or `overdue`
  with `date_released` in the reporting period. This follows the existing
  one-time release workflow; approval alone never counts. A released loan without
  its release date or fee snapshots makes the total unavailable rather than
  undercounting an unknown reporting period.
- Monthly Collections uses the reporting function's sum of `loan_payments`
  recorded as `posted` during the selected period. Reversals change the payment
  status to `reversed`, so they are excluded. The Dashboard renders the confirmed
  total returned by that function; if reporting data is unavailable, it shows a
  dash and Retry instead of displaying zero.
- Trends bucket `date_submitted` and `date_approved` separately. A loan submitted
  in September and approved in October belongs to different months in each series.
  Later released/completed loans retain their approval event. Missing approval
  dates on approved/released/completed/overdue loans make the approval series
  unavailable; submission counts still render.
- Reporting periods use Asia/Manila calendar boundaries: This Month, Last Month,
  and This Year (January through the current month). The latter relabels monetary
  KPIs as year-to-date. The chart uses the selected period, so a single-month
  selection contains one monthly bucket. Current-state counts and the recent
  table are independent of the period filter. Switching periods uses the loaded
  snapshot and does not send duplicate API requests.
- A successful empty report displays numeric zeros. Failed requests display a
  dash / error and Retry, never a fabricated zero. Recent records sort by raw
  submission date, then creation timestamp, with a stable application-ID tie break.
- Loan Types uses actual submitted-application counts for the selected reporting
  period and includes all twelve configured categories, even when a category has
  zero applications. Existing unrecognized stored values remain visible rather
  than being rewritten. A missing type makes the distribution unavailable, while
  a valid empty period shows an empty state.

## Existing capability gaps

**Hosted reporting setup:** the local reporting migration defines the
`portal_dashboard_totals` function used for pending applications, posted
collections, and net disbursements. The linked project must have the verified
function definition before these totals can be considered live; missing
functions or schema errors produce an unavailable state and Retry.

**Application details:** the Dashboard opens the shared read-only application
details view. It contains no processing, approval, rejection, return, or release
actions. The same details view is used from the Loan Applications page.

**Cancelled status:** the existing loan status constraint and API do not support
Cancelled. The Dashboard displays only the seven statuses already supported.

## Verification

Run checks with:

```powershell
node --test src/components/dashboard/dashboard-model.test.mjs src/components/dashboard/dashboard-data.test.mjs src/components/dashboard/loan-type-distribution.test.mjs
```

The collection card is additionally covered by:

```powershell
node --test src/components/dashboard/DashboardMetrics.test.mjs
```

They cover period/time-zone boundaries, separate submission and approval months,
release-only sums, duplicate protection, current-state counts, valid zeros,
missing dates, recent ordering, pagination beyond 1,000 records, incomplete
snapshots, invalid records, period-filtered and active-loan categories,
percentages, stable colors, distribution empty/unavailable states, and collection
value/error/retry presentation. All 18 checks pass. Test fixtures are isolated
from the UI.

The Dashboard content was also checked in an isolated browser context at 1440,
1200, 1024, 768 and 390 px. Desktop charts have matching 387px card heights, aligned
headings and a 65%/35% split; smaller screens stack them without content overflow.
Mobile uses the existing sidebar's collapsed state; the
sidebar/header retain their existing responsive behavior. Populated, empty,
failed-request and retry states were exercised using intercepted test responses,
not live database writes. Reporting-period changes sent no additional requests.

The changed files pass ESLint and the frontend-only TypeScript check. The full
project lint retains existing errors in AuditRow and the reports AreaChart.
The production build compiles, then fails the existing
TypeScript check because the root tsconfig also includes Deno Edge Functions
(`Deno` globals and HTTPS module imports). These unrelated files/configuration
were not changed as part of the Dashboard redesign.
