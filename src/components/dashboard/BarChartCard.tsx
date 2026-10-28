"use client";

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
    <section aria-labelledby="application-trends-heading" aria-busy={loading} className="flex h-full min-w-0 flex-col rounded-[14px] border border-[#E2E8F0] bg-white shadow-[0_2px_6px_rgba(15,23,42,0.025)]">
      <div className="flex flex-col justify-between gap-3 px-5 pt-4 sm:flex-row sm:items-start">
        <div>
          <h2 id="application-trends-heading" className="text-base font-semibold text-[#17212F]">Monthly Loan Applications</h2>
          <p className="mt-1 text-xs leading-5 text-[#64748B]">Monthly application activity{periodLabel ? ` · ${periodLabel}` : ""}</p>
        </div>
        <ul aria-label="Chart legend" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#64748B]">
          <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[#145B3C]" />Applications</li>
          <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[#D5A21B]" />Approved{approvalDatesMissing ? " (unavailable)" : ""}</li>
        </ul>
      </div>
      {loading ? (
        <div role="status" className="flex-1 px-5 py-4">
          <span className="sr-only">Loading application trends</span>
          <div className="h-[240px] animate-pulse rounded-lg bg-slate-50 motion-reduce:animate-none sm:h-[260px]" />
        </div>
      ) : error ? (
        <div role="alert" className="flex min-h-[180px] flex-1 flex-col items-center justify-center gap-3 px-5 py-6 text-center">
          <p className="text-sm font-semibold text-[#17212F]">Unable to load application trends</p>
          <p className="max-w-md text-sm leading-6 text-[#64748B]">{error}</p>
          {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-semibold text-[#145B3C] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145B3C]"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</button>}
        </div>
      ) : !hasData ? (
        <div className="flex min-h-[180px] flex-1 flex-col items-center justify-center px-5 py-6 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#F4F6F8] text-[#64748B]"><BarChart3 className="h-5 w-5" aria-hidden="true" /></span>
          <p className="text-sm font-semibold text-[#17212F]">No application trends available</p>
          <p className="mt-2 max-w-md text-sm leading-6 text-[#64748B]">Application statistics will appear here once loan records are available.</p>
        </div>
      ) : (
        <div className="flex-1 px-2 pb-2 pt-4 sm:px-5">
          <div role="img" aria-label={`Monthly submitted and approved application counts for ${periodLabel}`} className="h-[240px] w-full min-w-0 sm:h-[260px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 8 }} barGap={6} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="#EEF2F6" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={12} tick={{ fill: "#64748B", fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} width={50} />
                <Tooltip cursor={{ fill: "#F4F6F8" }} labelFormatter={(label) => {
                  const item = data.find((trend) => trend.label === String(label));
                  return item ? new Date(`${item.month}-01T00:00:00Z`).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }) : label;
                }} contentStyle={{ border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 16px rgba(15,23,42,0.06)" }} />
                <Bar dataKey="submitted" name="Submitted Applications" fill="#145B3C" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                <Bar dataKey="approved" name="Approved Applications" fill="#D5A21B" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {!loading && !error && <p className="border-t border-[#F1F5F9] px-5 py-2 text-[11px] leading-5 text-[#64748B]">Submitted applications use the submission date; approved applications use the approval date.{approvalDatesMissing ? " Approval totals are unavailable because some approved loans have no recorded approval date." : ""}</p>}
    </section>
  );
}
