"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { ChartPie, RefreshCw } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { LoanTypeDistribution, LoanTypeSlice } from "./loan-type-distribution";

interface DonutChartCardProps {
  distribution?: LoanTypeDistribution;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  periodLabel?: string;
}

const percent = (value: number) => `${value.toLocaleString("en-PH", { maximumFractionDigits: 1 })}%`;

export default function DonutChartCard({
  distribution,
  loading = false,
  error,
  onRetry,
  periodLabel,
}: DonutChartCardProps) {
  const [isSliceHovered, setIsSliceHovered] = useState(false);
  const unavailable = !distribution || distribution.unavailable;
  const types = distribution?.types ?? [];
  const chartTypes = types.filter((type) => type.count > 0);
  const period = periodLabel ?? "Selected reporting period";

  return (
    <Card
      padded={false}
      aria-labelledby="loan-types-heading"
      aria-busy={loading}
      className="flex h-full min-w-0 flex-col overflow-hidden"
    >
      <div className="px-5 pt-4">
        <h2 id="loan-types-heading" className="text-card-title">Loan Types</h2>
        <p className="mt-1 text-support text-portal-muted">Applications submitted · {period}</p>
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
          <p className="max-w-sm text-sm leading-6 text-portal-secondary">
            {error ?? (distribution?.unavailable
              ? "Some submitted applications are missing their loan type."
              : "The loan type distribution could not be calculated.")}
          </p>
          {error && onRetry && (
            <Button size="compact" onClick={onRetry} aria-label="Retry loan types">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry
            </Button>
          )}
        </div>
      ) : !distribution.total && !types.length ? (
        <EmptyState
          icon={ChartPie}
          title="No loan types to display"
          description="Loan types will appear here when submitted applications are available for this period."
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-3">
          <div
            className="relative mx-auto my-2 h-40 w-full max-w-[220px] shrink-0"
            role="group"
            aria-label={`Distribution of ${distribution.total} submitted applications by loan type for ${period}`}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-2 rounded-full border-[20px] border-surface-muted"
            />
            {chartTypes.length > 0 && (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart accessibilityLayer>
                  <Pie
                    data={chartTypes}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={72}
                    paddingAngle={chartTypes.length > 1 ? 3 : 0}
                    stroke="var(--surface-card)"
                    strokeWidth={2}
                    isAnimationActive={false}
                    onMouseEnter={() => setIsSliceHovered(true)}
                    onMouseLeave={() => setIsSliceHovered(false)}
                  >
                    {chartTypes.map((type) => <Cell key={type.name} fill={type.color} />)}
                  </Pie>
                  <Tooltip
                    position={{ x: 0, y: 48 }}
                    content={({ active, payload }) => {
                      const type = payload?.[0]?.payload as LoanTypeSlice | undefined;
                      if (!active || !type) return null;
                      return (
                        <div
                          className="max-w-[220px] rounded-lg border border-portal-border border-l-4 bg-surface-card px-3 py-2 text-caption text-portal-primary shadow-lg"
                          style={{ borderLeftColor: type.color }}
                        >
                          <div className="flex items-center gap-2 font-semibold">
                            <span className="size-2.5 shrink-0 rounded-full" aria-hidden="true" style={{ backgroundColor: type.color }} />
                            <span className="[overflow-wrap:anywhere]">{type.name}</span>
                          </div>
                          <p className="mt-1 pl-[18px]">
                            {type.count.toLocaleString("en-PH")} submitted application{type.count === 1 ? "" : "s"} · {percent(type.percentage)}
                          </p>
                        </div>
                      );
                    }}
                    wrapperStyle={{ maxWidth: "100%", pointerEvents: "none" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {!isSliceHovered && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-section-title font-bold text-portal-primary tabular-nums">
                  {distribution.total.toLocaleString("en-PH")}
                </span>
                <span className="text-caption text-portal-muted">applications</span>
              </div>
            )}
          </div>

          <ul
            aria-label="Loan types and submitted application counts"
            tabIndex={0}
            className="my-auto max-h-36 space-y-1 overflow-y-auto overscroll-contain pr-1 text-caption focus-visible:outline-2 focus-visible:outline-coop-primary"
          >
            {types.map((type) => (
              <li key={type.name} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" aria-hidden="true" style={{ backgroundColor: type.color }} />
                  <span className="text-portal-muted [overflow-wrap:anywhere]">{type.name}</span>
                </span>
                <span
                  className="shrink-0 font-semibold text-portal-primary tabular-nums"
                  title={`${type.count} of ${distribution.total} submitted applications`}
                >
                  {type.count.toLocaleString("en-PH")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && !unavailable && (
        <p className="border-t border-portal-border-subtle px-5 py-2 text-caption text-portal-muted">
          {distribution.total.toLocaleString("en-PH")} applications · {period}
        </p>
      )}
    </Card>
  );
}
