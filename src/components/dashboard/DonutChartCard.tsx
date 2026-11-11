"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { chartTooltipStyle } from "./chartPresentation";

import { ChartPie, RefreshCw } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { LoanTypeDistribution } from "./loan-type-distribution";

interface DonutChartCardProps {
  distribution?: LoanTypeDistribution;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const percent = (value: number) => `${value.toLocaleString("en-PH", { maximumFractionDigits: 1 })}%`;

export default function DonutChartCard({
  distribution, loading = false, error, onRetry,
}: DonutChartCardProps) {
  const unavailable = !distribution || distribution.unavailable;
  const data = distribution?.types ?? [];
  return (
    <Card padded={false} aria-labelledby="loan-types-heading" aria-busy={loading} className="flex h-full min-w-0 flex-col">
      <div className="px-5 pt-4">
        <h2 id="loan-types-heading" className="text-card-title">Loan Types</h2>
        <p className="mt-1 text-support text-portal-muted">Active loans distribution</p>
      </div>
      {loading ? (
        <LoadingState label="Loading loan type distribution">
          <div aria-hidden="true" className="flex min-h-[260px] flex-col items-center justify-center gap-4 px-5 py-4">
          <div className="h-36 w-36 animate-pulse rounded-full border-[24px] border-surface-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
          </div>
        </LoadingState>
      ) : error || unavailable ? (
        <div role="alert" className="flex min-h-[180px] flex-1 flex-col items-center justify-center gap-3 px-5 py-6 text-center">
          <p className="text-body font-semibold">Loan type distribution unavailable</p>
          <p className="max-w-sm text-sm leading-6 text-portal-secondary">{error ?? (distribution?.unavailable ? "Some active loan records are missing their loan type." : "The loan type distribution could not be calculated.")}</p>
          {error && onRetry && <Button size="compact" onClick={onRetry} aria-label="Retry loan types"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</Button>}
        </div>
      ) : distribution.total === 0 ? (
        <EmptyState icon={ChartPie} title="No active loans"
          description="The loan type distribution will appear once active loans are recorded." />
      ) : (
        <div className="flex flex-1 flex-col px-5 pb-4">
          <div className="relative mx-auto my-2 h-40 w-full max-w-[220px]" role="group" aria-label={`Distribution of ${distribution.total} active loans by loan type`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart accessibilityLayer>
                <Pie data={data} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={72} paddingAngle={data.length > 1 ? 3 : 0} stroke="var(--surface-card)" strokeWidth={2} isAnimationActive={false}>
                  {data.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip formatter={(value, name) => {
                  const item = data.find((slice) => slice.name === String(name));
                  return [`${value} loan${Number(value) === 1 ? "" : "s"}${item ? ` · ${percent(item.percentage)}` : ""}`, String(name)];
                }} contentStyle={chartTooltipStyle} itemStyle={{ color: "var(--text-primary)" }} wrapperStyle={{ maxWidth: "100%" }} />
              </PieChart>
            </ResponsiveContainer>
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-section-title font-bold text-portal-primary tabular-nums">{distribution.total.toLocaleString("en-PH")}</span>
              <span className="text-caption text-portal-muted">active loans</span>
            </div>
          </div>
          <ul aria-label="Loan type distribution" tabIndex={0} className="my-auto max-h-36 space-y-1 overflow-y-auto overscroll-contain pr-1 text-caption focus-visible:outline-2 focus-visible:outline-coop-primary">
            {data.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" aria-hidden="true" style={{ backgroundColor: item.color }} /><span className="text-portal-muted [overflow-wrap:anywhere]">{item.name}</span></span>
                <span className="shrink-0 font-semibold text-portal-primary tabular-nums" title={`${item.count} of ${distribution.total} active loans`}>{percent(item.percentage)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!loading && !error && !unavailable && <p className="border-t border-portal-border-subtle px-5 py-2 text-caption text-portal-muted">Current portfolio · all reporting periods</p>}
    </Card>
  );
}
