"use client";

import { Badge } from "@/components/ui/StatusBadge";
import AccountRoleBadge from "@/components/shared/AccountRoleBadge";
import type { MemberRole } from "./MembersData";

interface RoleBadgeProps {
  role: MemberRole;
}

export default function RoleBadge({ role }: RoleBadgeProps) {
  if(role==="Unknown")return <Badge tone="neutral">Unverified</Badge>;
  return <AccountRoleBadge role={role==="Member"?"member":["Admin","Administrator"].includes(role)?"admin":"super_admin"}/>;
}
