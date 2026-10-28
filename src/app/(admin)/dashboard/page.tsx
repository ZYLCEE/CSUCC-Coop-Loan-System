"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import DashboardMetrics from "@/components/dashboard/DashboardMetrics";
import ChartsSection from "@/components/dashboard/ChartsSection";
import RecentApplications from "@/components/dashboard/RecentApplications";
import { getReportRange, summarizeLoans, type ReportingPeriod } from "@/components/dashboard/dashboard-model";
import { useDashboardData } from "@/components/dashboard/useDashboardData";
import { getLoanTypeDistribution } from "@/components/dashboard/loan-type-distribution";

export default function DashboardPage() {
  const pathname = usePathname();
  const [period, setPeriod] = useState<ReportingPeriod>("this-month");
  const { loans, activeMembers } = useDashboardData();
  const range = useMemo(() => getReportRange(period), [period]);
  const filterOptions = useMemo(() => {
    const now = new Date();
    return ([
      { value: "this-month", label: "This Month" },
      { value: "last-month", label: "Last Month" },
      { value: "this-year", label: "This Year" },
    ] as const).map((option) => {
      const optionRange = getReportRange(option.value, now);
      return { ...option, dateLabel: option.value === "this-year" ? optionRange.start.slice(0, 4) : optionRange.label };
    });
  }, []);
  const summary = useMemo(() => loans.data ? summarizeLoans(loans.data, range) : null, [loans.data, range]);
  const loanTypes = useMemo(() => loans.data ? getLoanTypeDistribution(loans.data) : undefined, [loans.data]);
  const prefix = pathname.startsWith("/super-admin/") ? "/super-admin"
    : pathname.startsWith("/admin/") ? "/admin" : "";

  return (
    <div className="-mx-3 -mt-1 min-w-0 space-y-4 text-[#17212F] sm:space-y-5">
      <div role="group" aria-label="Dashboard reporting filters" className="flex min-w-0 justify-end">
        <div className="max-w-full">
          <label htmlFor="dashboard-period" className="sr-only">Reporting period</label>
          <div className="relative inline-flex max-w-full items-center">
            <CalendarDays className="pointer-events-none absolute left-3 h-4 w-4 text-[#64748B]" aria-hidden="true" />
            <select id="dashboard-period" value={period} onChange={(event) => setPeriod(event.target.value as ReportingPeriod)} className="h-9 w-full min-w-0 max-w-full appearance-none rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-8 text-[11px] font-medium text-[#17212F] shadow-[0_1px_2px_rgba(15,23,42,0.025)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145B3C] sm:text-xs">
              {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.dateLabel}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-[#64748B]" aria-hidden="true" />
          </div>
        </div>
      </div>
      <DashboardMetrics pending={summary?.pending ?? null} activeMembers={activeMembers.data}
        disbursement={summary?.disbursement ?? null} period={period}
        loansLoading={loans.loading} membersLoading={activeMembers.loading}
        loansError={loans.error} membersError={activeMembers.error}
        retryLoans={loans.retry} retryMembers={activeMembers.retry} />
      <ChartsSection data={summary?.trends} loanTypes={loanTypes} loading={loans.loading} error={loans.error}
        periodLabel={range.label} approvalDatesMissing={summary?.approvalDatesMissing} onRetry={loans.retry} />
      <RecentApplications applications={summary?.recent} loading={loans.loading} error={loans.error}
        applicationsHref={`${prefix}/loan-applications`} onRetry={loans.retry} />
    </div>
  );
}
