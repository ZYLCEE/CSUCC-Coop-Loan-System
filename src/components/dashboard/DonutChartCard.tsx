"use client";

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
    <section aria-labelledby="loan-types-heading" aria-busy={loading} className="flex h-full min-w-0 flex-col rounded-[14px] border border-[#E2E8F0] bg-white shadow-[0_2px_6px_rgba(15,23,42,0.025)]">
      <div className="px-5 pt-4">
        <h2 id="loan-types-heading" className="text-base font-semibold text-[#17212F]">Loan Types</h2>
        <p className="mt-1 text-xs leading-5 text-[#64748B]">Active loans distribution</p>
      </div>
      {loading ? (
        <div role="status" className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-4 px-5 py-4">
          <span className="sr-only">Loading loan type distribution</span>
          <div className="h-36 w-36 animate-pulse rounded-full border-[24px] border-slate-100 motion-reduce:animate-none" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
        </div>
      ) : error || unavailable ? (
        <div role="alert" className="flex min-h-[180px] flex-1 flex-col items-center justify-center gap-3 px-5 py-6 text-center">
          <p className="text-sm font-semibold text-[#17212F]">Loan type distribution unavailable</p>
          <p className="max-w-sm text-sm leading-6 text-[#64748B]">{error ?? "Some active loan records are missing their loan type. A complete distribution is unavailable."}</p>
          {error && onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-semibold text-[#145B3C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145B3C]" aria-label="Retry loan types"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</button>}
        </div>
      ) : distribution.total === 0 ? (
        <div className="flex min-h-[180px] flex-1 flex-col items-center justify-center px-5 py-6 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#F4F6F8] text-[#64748B]"><ChartPie className="h-5 w-5" aria-hidden="true" /></span>
          <p className="text-sm font-semibold text-[#17212F]">No active loans</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#64748B]">Loan type distribution will appear once active loan records are available.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col px-5 pb-4">
          <div className="relative mx-auto my-2 h-40 w-full max-w-[220px]" role="img" aria-label={`Distribution of ${distribution.total} active loans by loan type`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart accessibilityLayer>
                <Pie data={data} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={72} paddingAngle={data.length > 1 ? 3 : 0} stroke="#FFFFFF" strokeWidth={2} isAnimationActive={false}>
                  {data.map((item) => <Cell key={item.name} fill={item.color} />)}
                </Pie>
                <Tooltip formatter={(value, name) => {
                  const item = data.find((slice) => slice.name === String(name));
                  return [`${value} loan${Number(value) === 1 ? "" : "s"}${item ? ` · ${percent(item.percentage)}` : ""}`, String(name)];
                }} contentStyle={{ border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px rgba(15,23,42,0.06)" }} />
              </PieChart>
            </ResponsiveContainer>
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[22px] font-bold leading-7 text-[#17212F] tabular-nums">{distribution.total.toLocaleString("en-PH")}</span>
              <span className="text-[10px] text-[#64748B]">active loans</span>
            </div>
          </div>
          <ul aria-label="Loan type distribution" className="my-auto max-h-36 space-y-1 overflow-y-auto pr-1 text-xs">
            {data.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="break-words leading-5 text-[#64748B]">{item.name}</span></span>
                <span className="shrink-0 font-semibold text-[#17212F] tabular-nums" title={`${item.count} of ${distribution.total} active loans`}>{percent(item.percentage)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!loading && !error && !unavailable && <p className="border-t border-[#F1F5F9] px-5 py-2 text-[11px] leading-5 text-[#64748B]">Current portfolio · all reporting periods</p>}
    </section>
  );
}
