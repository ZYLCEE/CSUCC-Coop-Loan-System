"use client";

interface SummaryCardProps {
  value: string;
  label: string;
}

export default function SummaryCard({ value, label }: SummaryCardProps) {
  return (
    <div className="bg-[#F8FAFC] rounded-[14px] border border-[#E8EDF3] p-3 text-center">
      <p className="text-[20px] font-bold text-[#156A3A] mb-1 font-inter">{value}</p>
      <p className="text-[11px] font-medium text-[#6B7280] font-inter">{label}</p>
    </div>
  );
}
