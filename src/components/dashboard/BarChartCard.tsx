"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { chartAxisText, chartTooltipStyle } from "./chartPresentation";

import { BarChart3, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { ApplicationTrend } from "./dashboard-model";

interface BarChartCardProps {
  data?: ApplicationTrend[];
  loading?: boolean;
  error?: string | null;
  periodLabel?: string;
  approvalDatesMissing?: boolean;
  onRetry?: () => void;
}

export default function BarChartCard({
  data = [], loading = false, error, periodLabel = "", approvalDatesMissing = false, onRetry,
}: BarChartCardProps) {
  const hasData = data.some((item) => item.submitted > 0 || (item.approved ?? 0) > 0);
  return (
    <Card padded={false} aria-labelledby="application-trends-heading" aria-busy={loading} className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 id="application-trends-heading" className="text-card-title">Monthly Loan Applications</h2>
          <p className="mt-1 text-support text-portal-muted">Monthly application activity{periodLabel ? ` · ${periodLabel}` : ""}</p>
        </div>
        <ul aria-label="Chart legend" className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-caption text-portal-muted">
          <li className="flex items-center gap-2"><span className="size-3 shrink-0 rounded-sm bg-coop-dashboard-green" aria-hidden="true" />Applications</li>
          <li className="flex items-center gap-2"><span className="size-3 shrink-0 rounded-sm border border-status-warning bg-coop-accent" aria-hidden="true" />Approved{approvalDatesMissing ? " (unavailable)" : ""}</li>
        </ul>
      </div>
      {loading ? (
        <LoadingState label="Loading application trends">
          <div aria-hidden="true" className="m-4 h-[240px] animate-pulse rounded-portal-control bg-surface-muted motion-reduce:animate-none sm:h-[260px]" />
        </LoadingState>
      ) : error ? (
        <div role="alert" className="flex min-h-[180px] flex-1 flex-col items-center justify-center gap-3 px-5 py-6 text-center">
          <p className="text-body font-semibold">Unable to load application trends</p>
          <p className="max-w-md text-sm leading-6 text-portal-secondary">{error}</p>
          {onRetry && <Button size="compact" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</Button>}
        </div>
      ) : !hasData ? (
        <EmptyState icon={BarChart3} title="No application activity for this period"
          description="Choose a different reporting period to view application trends." />
      ) : (
        <div className="flex-1 px-2 pb-2 pt-4 sm:px-5">
          <div role="group" aria-label={`Monthly submitted and approved application counts for ${periodLabel}`} className="h-[240px] w-full min-w-0 sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 8 }} barGap={6} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--border-default)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} minTickGap={12} tick={chartAxisText} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={chartAxisText} width={42} />
                <Tooltip cursor={{ fill: "var(--surface-muted)" }} labelFormatter={(label) => {
                  const item = data.find((trend) => trend.label === String(label));
                  return item ? new Date(`${item.month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }) : label;
                }} contentStyle={chartTooltipStyle} itemStyle={{ color: "var(--text-primary)" }} wrapperStyle={{ maxWidth: "100%" }} />
                <Bar dataKey="submitted" name="Submitted Applications" fill="var(--coop-dashboard-green)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                <Bar dataKey="approved" name="Approved Applications" fill="var(--coop-accent)" stroke="var(--status-warning)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {!loading && !error && <p className="border-t border-portal-border-subtle px-5 py-2 text-caption text-portal-muted">Submitted applications use the submission date; approved applications use the approval date.{approvalDatesMissing ? " Approval totals are unavailable because some approved loans have no recorded approval date." : ""}</p>}
    </Card>
  );
}
