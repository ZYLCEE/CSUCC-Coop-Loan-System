"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import {loanTypeLabel,loanTypeOptions} from "@/lib/loanTypes";
import DashboardMetrics from "@/components/dashboard/DashboardMetrics";
import ChartsSection from "@/components/dashboard/ChartsSection";
import RecentApplications from "@/components/dashboard/RecentApplications";
import { getReportRange, summarizeLoans, type ReportingPeriod } from "@/components/dashboard/dashboard-model";
import { useDashboardData } from "@/components/dashboard/useDashboardData";
import { getLoanTypeDistribution } from "@/components/dashboard/loan-type-distribution";
import { useLoginTransition } from "@/components/auth/LoginTransitionProvider";
import { Select } from "@/components/ui/Fields";
import { Card } from "@/components/ui/Card";
import PortalPageHeading from "@/components/shared/PortalPageHeading";

export default function DashboardPage() {
  const pathname = usePathname();
  const [period, setPeriod] = useState<ReportingPeriod>("this-month");
  const range = getReportRange(period);
  const { loans, activeMembers, financials, connected } = useDashboardData(range);
  const { finish } = useLoginTransition();
  const dashboardReady = !loans.loading && !activeMembers.loading;

  useEffect(() => {
    if (dashboardReady) finish();
  }, [dashboardReady, finish]);
  const filterOptions = (() => {
    const now = new Date();
    return ([
      { value: "this-month", label: "This Month" },
      { value: "last-month", label: "Last Month" },
      { value: "this-year", label: "This Year" },
    ] as const).map((option) => {
      const optionRange = getReportRange(option.value, now);
      return { ...option, dateLabel: option.value === "this-year" ? optionRange.start.slice(0, 4) : optionRange.label };
    });
  })();
  const summary = useMemo(() => loans.data ? summarizeLoans(loans.data, range) : null, [loans.data, range]);
  const loanTypes = useMemo(() => loans.data ? getLoanTypeDistribution(loans.data.map(loan=>({...loan,type:loanTypeLabel(loan.type)})), range, loanTypeOptions(loans.data.map(loan=>loan.type))) : undefined, [loans.data,range]);
  const prefix = pathname.startsWith("/super-admin/") ? "/super-admin"
    : pathname.startsWith("/admin/") ? "/admin" : "";

  return (
    <Card padded={false} className="min-w-0 overflow-hidden text-portal-primary">
      <PortalPageHeading section="dashboard">
      <div role="group" aria-label="Dashboard reporting filters" className="flex min-w-0 justify-end">
        <div className="max-w-full">
          <label htmlFor="dashboard-period" className="sr-only">Reporting period</label>
          <div className="relative inline-flex max-w-full items-center">
            <CalendarDays className="pointer-events-none absolute left-3 size-icon-compact text-portal-secondary" aria-hidden="true" />
            <Select size="compact" id="dashboard-period" value={period} onChange={(event) => setPeriod(event.target.value as ReportingPeriod)} className="w-full appearance-none pl-9 pr-8">
              {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.dateLabel}</option>)}
            </Select>
            <ChevronDown className="pointer-events-none absolute right-3 size-icon-compact text-portal-secondary" aria-hidden="true" />
          </div>
        </div>
      </div>
      </PortalPageHeading>
      <div className="ui-card-padding min-w-0 space-y-portal-section">
      {!connected&&<p role="status" className="text-support text-status-warning">Live updates interrupted. Reconnecting. Data is checked automatically; you can retry any unavailable report.</p>}
      <DashboardMetrics pending={financials.data?.pending ?? null} activeMembers={activeMembers.data}
        collections={financials.data?.collections ?? null} disbursement={financials.data?.disbursement ?? null} period={period}
        financialsLoading={financials.loading} membersLoading={activeMembers.loading}
        financialsError={financials.error} membersError={activeMembers.error}
        retryFinancials={financials.retry} retryMembers={activeMembers.retry} />
      <ChartsSection data={summary?.trends} loanTypes={loanTypes} loading={loans.loading} error={loans.error}
        periodLabel={range.label} approvalDatesMissing={summary?.approvalDatesMissing} onRetry={loans.retry} />
      <RecentApplications applications={summary?.recent} loading={loans.loading} error={loans.error}
        applicationsHref={`${prefix}/loan-applications`} onRetry={loans.retry} />
      </div>
    </Card>
  );
}
