import type { ReactNode } from "react";

const tones = {
  success: "bg-status-success-surface text-status-success",
  warning: "bg-status-warning-surface text-status-warning",
  danger: "bg-status-danger-surface text-status-danger",
  info: "bg-status-info-surface text-status-info",
  neutral: "bg-status-neutral-surface text-status-neutral",
  returned: "bg-[#e0e7ff] text-[#4338ca]",
  reviewer: "bg-[#f3e8ff] text-[#6b21a8]",
  board: "bg-[#ccfbf1] text-[#115e59]",
};

export function Badge({ tone = "neutral", children, className = "" }: {
  tone?: keyof typeof tones;
  children: ReactNode;
  className?: string;
}) {
  return <span className={`ui-badge ${tones[tone]} ${className}`}>{children}</span>;
}

const statusTones: Readonly<Partial<Record<string, keyof typeof tones>>> = {
  pending: "warning",
  returned: "returned",
  "under review": "info",
  approved: "success",
  rejected: "danger",
  released: "success",
  paid: "info",
  "fully paid": "success",
  active: "success",
  overdue: "danger",
  completed: "success",
  blocked: "danger",
  suspended: "danger",
  inactive: "neutral",
  draft: "neutral",
  scheduled: "warning",
  published: "success",
  archived: "neutral",
  sent: "success",
  failed: "danger",
  posted: "success",
  reversed: "neutral",
};

export function StatusBadge({ status, label, className = "" }: {
  status: string;
  label?: string;
  className?: string;
}) {
  const key = status.toLowerCase().trim().replaceAll("_", " ");
  const tone = Object.hasOwn(statusTones, key) ? statusTones[key] ?? "neutral" : "neutral";
  return <Badge tone={tone} className={className}>{label ?? status.replaceAll("_", " ")}</Badge>;
}
