import { MembershipType, getMembershipTypeLabel } from "@/lib/membership";

interface MembershipTypeBadgeProps {
  membershipType?: MembershipType;
}

const badgeStyles: Record<"regular" | "associate" | "unset", string> = {
  regular: "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]",
  associate: "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]",
  unset: "border-[#E5E7EB] bg-[#F8FAFC] text-[#64748B]",
};

export default function MembershipTypeBadge({
  membershipType,
}: MembershipTypeBadgeProps) {
  const styleKey = membershipType ?? "unset";

  return (
    <span
      className={`inline-flex h-6 max-w-full items-center whitespace-nowrap rounded-full border px-2.5 text-[10px] font-semibold ${badgeStyles[styleKey]}`}
    >
      {getMembershipTypeLabel(membershipType ?? null)}
    </span>
  );
}
