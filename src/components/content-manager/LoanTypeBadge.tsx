"use client";

interface LoanTypeBadgeProps {
  isActive: boolean;
}

export default function LoanTypeBadge({ isActive }: LoanTypeBadgeProps) {
  return (
    <span
      className={`inline-flex items-center h-[18px] px-1.5 rounded-[999px] text-[10px] font-medium border ${
        isActive
          ? "bg-[#ECFDF5] text-[#15803D] border-[#BBF7D0]"
          : "bg-gray-50 text-gray-600 border-gray-300"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}
