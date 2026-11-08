"use client";

import { LucideIcon } from "lucide-react";

interface LoanStatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  iconBgColor: string;
  iconColor: string;
  showTrend?: boolean;
  trendIcon?: LucideIcon;
}

export default function LoanStatCard({ icon: Icon, label, value, iconBgColor, iconColor, showTrend, trendIcon: TrendIcon }: LoanStatCardProps) {
  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-3">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBgColor}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} strokeWidth={2} />
        </div>

        {/* Content */}
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase text-[#6B7280] tracking-wider mb-1">{label}</p>
          <div className="flex items-center gap-2">
            <p className="text-[18px] font-bold text-[#1F2937] leading-none">{value}</p>
            {showTrend && TrendIcon && (
              <TrendIcon className="w-3.5 h-3.5 text-[#EF4444]" strokeWidth={2} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
