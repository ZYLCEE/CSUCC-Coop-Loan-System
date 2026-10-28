"use client";

import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  iconBgColor: string;
  iconColor: string;
  customBgColor?: string;
  customIconColor?: string;
  label: string;
  value: string;
  subtitle: string;
  trend?: boolean;
  loading?: boolean;
  unavailable?: string;
  onRetry?: () => void;
}

export default function StatCard({
  icon: Icon,
  iconBgColor,
  iconColor,
  customBgColor,
  customIconColor,
  label,
  value,
  subtitle,
  loading = false,
  unavailable,
  onRetry,
}: StatCardProps) {
  return (
    <article aria-label={label} aria-busy={loading} className="relative flex min-h-[120px] min-w-0 flex-col rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.025)]">
      <h2 className="min-h-8 pr-10 text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] text-[#64748B]">{label}</h2>
      <span className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: customBgColor || iconBgColor }}>
        <Icon className="h-4 w-4" style={{ color: customIconColor || iconColor }} strokeWidth={1.8} aria-hidden="true" />
      </span>
      {loading ? (
        <div role="status" className="mt-0.5">
          <span className="sr-only">Loading {label.toLowerCase()}</span>
          <div className="h-6 w-3/4 animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
        </div>
      ) : (
        <>
          <p className="mt-0.5 break-all text-[22px] font-bold leading-7 tracking-tight text-[#17212F] tabular-nums" title={value}>{value}</p>
          <div className="mt-1 flex items-start justify-between gap-2">
            <p className="text-[11px] leading-4 text-[#64748B]" title={unavailable ? subtitle : undefined}>{unavailable && <span className="sr-only">{subtitle}. </span>}{unavailable ?? subtitle}</p>
            {onRetry && <button type="button" onClick={onRetry} className="shrink-0 rounded text-[11px] font-semibold leading-4 text-[#145B3C] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#145B3C]" aria-label={`Retry ${label.toLowerCase()}`}>Retry</button>}
          </div>
        </>
      )}
    </article>
  );
}
