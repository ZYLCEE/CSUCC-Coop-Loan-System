import { getMembershipTypeLabel, type MembershipType } from "@/lib/membership";
import { Badge } from "@/components/ui/StatusBadge";

interface MembershipTypeBadgeProps {
  membershipType?: MembershipType;
}

const membershipTones = { regular: "success", associate: "info", unset: "neutral" } as const;

export default function MembershipTypeBadge({
  membershipType,
}: MembershipTypeBadgeProps) {
  const styleKey = membershipType ?? "unset";

  return (
    <Badge tone={membershipTones[styleKey]} className="max-w-full whitespace-normal">
      {getMembershipTypeLabel(membershipType ?? null)}
    </Badge>
  );
}
