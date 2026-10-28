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
  desktop chart row, monthly application bars and current loan-type donut.
  Charts stack below 1200px; desktop card heights and heading positions match.
- `loan-type-distribution.ts`: current active-loan counts, percentages and stable
  category colors derived from real loan records, with no extra API request.
- `RecentApplications.tsx`: the seven-column table of five latest applications.
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
- Monthly Disbursement sums principal amounts in integer centavos for records in
  `released`, `completed` or `overdue` with `date_released` in the reporting period.
  This follows the existing one-time, full-principal release workflow; approval
  alone never counts. A released loan without its release date makes this total
  unavailable, rather than undercounting an unknown reporting period.
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
- Loan Types uses the existing `check_loan_eligibility` definition of active loans:
  `approved`, `released` and `overdue`. Completed, rejected, pending and under-review
  applications do not count. Types come directly from stored `loan_type` values;
  percentages use the number of distinct active application IDs, not loan amounts.
  Category colors are deterministic and independent of record order. A missing
  type makes the distribution unavailable, while zero active loans shows an empty
  state. The donut represents the current portfolio across all reporting periods;
  it stays unchanged when the monthly chart's date filter changes.

## Existing capability gaps

**Confirmed collections:** the existing `loan_payments` schema has payment amount
and date, but no confirmation, failure, cancellation or reversal status, and no
documented invariant that every row is a final successful collection. Summing it
would not satisfy the requested confirmed-only metric. The Collections card
therefore displays a dash and "Confirmed collections unavailable". An existing
authoritative settled-payment source or explicit settlement/reversal semantics
is required before enabling this calculation. No speculative status field or
backend change was introduced.

**Application details:** the existing loan applications table's View Details
action only calls a "Frontend only" placeholder alert. There is no working
application-details route. The Dashboard shows disabled View Details controls
with an explanation instead of inventing a route or pretending the alert works.
View All links to the existing role-aware `/admin/loan-applications`,
`/super-admin/loan-applications`, or legacy `/loan-applications` route.

**Cancelled status:** the existing loan status constraint and API do not support
Cancelled. The Dashboard displays only the seven statuses already supported.

## Verification

Run checks with:

```powershell
node --test src/components/dashboard/dashboard-model.test.mjs src/components/dashboard/dashboard-data.test.mjs src/components/dashboard/loan-type-distribution.test.mjs
```

They cover period/time-zone boundaries, separate submission and approval months,
release-only sums, duplicate protection, current-state counts, valid zeros,
missing dates, recent ordering, pagination beyond 1,000 records, incomplete
snapshots, invalid records, active-loan categories, percentages, stable colors and
distribution empty/unavailable states. All 15 checks pass. Test fixtures are
isolated from the UI.

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
