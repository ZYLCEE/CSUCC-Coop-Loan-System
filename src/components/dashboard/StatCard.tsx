"use client";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { Card } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/Feedback";
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
    <Card as="article" aria-label={label} aria-busy={loading} className="relative flex min-h-[120px] flex-col">
      <h2 className="min-h-8 pr-10 text-caption font-semibold uppercase tracking-wide text-portal-muted">{label}</h2>
      <span className="absolute right-5 top-5 flex size-control-compact items-center justify-center rounded-portal-control" style={{ backgroundColor: customBgColor || iconBgColor }}>
        <Icon className="size-icon" style={{ color: customIconColor || iconColor }} strokeWidth={1.8} aria-hidden="true" />
      </span>
      {loading ? (
        <LoadingState label={`Loading ${label.toLowerCase()}`}>
          <div className="h-6 w-3/4 animate-pulse rounded-portal-control bg-surface-muted motion-reduce:animate-none" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-surface-muted motion-reduce:animate-none" />
        </LoadingState>
      ) : (
        <>
          <p className="mt-1 text-page-title tracking-tight tabular-nums [overflow-wrap:anywhere]" title={value}>{value}</p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
            <p className="text-caption text-portal-secondary" title={unavailable ? subtitle : undefined}>{unavailable && <span className="sr-only">{subtitle}. </span>}{unavailable ?? subtitle}</p>
            {onRetry && <button type="button" onClick={onRetry} className={actionButtonStyles("secondary", "xs")} aria-label={`Retry ${label.toLowerCase()}`}>Retry</button>}
          </div>
        </>
      )}
    </Card>
  );
}
