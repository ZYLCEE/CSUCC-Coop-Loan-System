"use client";

import { MemberStatus } from "./MembersData";

interface StatusBadgeProps {
  status: MemberStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    Active: "bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]",
    Pending: "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]",
    Suspended: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
    Inactive: "bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]",
    Blocked: "bg-[#FFF1F2] text-[#BE123C] border-[#FDA4AF]",
    Unknown: "bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]",
  } satisfies Record<MemberStatus, string>;

  return (
    <span className={`inline-flex h-[25px] min-w-[74px] items-center justify-center whitespace-nowrap rounded-full border px-2.5 text-[11px] font-bold ${styles[status]}`}>
      {status}
    </span>
  );
}
