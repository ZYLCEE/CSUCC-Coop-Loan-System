"use client";

import { StatusBadge as SharedStatusBadge } from "@/components/ui/StatusBadge";
import type { MemberStatus } from "./MembersData";

interface StatusBadgeProps {
  status: MemberStatus;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  return <SharedStatusBadge status={status} />;
}
