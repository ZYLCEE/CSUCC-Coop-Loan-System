"use client";

import { MemberRole } from "./MembersData";

interface RoleBadgeProps {
  role: MemberRole;
}

export default function RoleBadge({ role }: RoleBadgeProps) {
  const styles = {
    Member: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]",
    Admin: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
    "Super Admin": "bg-[#FEFCE8] text-[#A16207] border-[#FEF08A]",
    Unknown: "bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]",
    Administrator: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
    "Super Administrator": "bg-[#FEFCE8] text-[#A16207] border-[#FEF08A]",
  };

  return (
    <span className={`inline-flex h-[25px] max-w-full items-center whitespace-nowrap rounded-full border px-2.5 text-[11px] font-bold ${styles[role]}`}>
      {role === "Unknown" ? "Unverified" : role}
    </span>
  );
}
