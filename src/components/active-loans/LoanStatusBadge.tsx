"use client";

interface LoanStatusBadgeProps {
  status: "Current" | "Due Soon" | "Overdue";
}

export default function LoanStatusBadge({ status }: LoanStatusBadgeProps) {
  const styles = {
    Current: "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]",
    "Due Soon": "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]",
    Overdue: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
  };

  return (
    <span className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-semibold ${styles[status]}`}>
      {status}
    </span>
  );
}
