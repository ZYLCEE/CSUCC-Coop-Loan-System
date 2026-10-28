"use client";

import { LucideIcon } from "lucide-react";

interface DocumentCategoryCardProps {
  icon: LucideIcon;
  title: string;
  count: number;
  iconBgColor: string;
  iconColor: string;
}

export default function DocumentCategoryCard({ icon: Icon, title, count, iconBgColor, iconColor }: DocumentCategoryCardProps) {
  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-3 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-shadow duration-200 h-[80px]">
      <div className="flex items-start gap-2.5">
        {/* Icon */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBgColor}`}>
          <Icon className={`w-4.5 h-4.5 ${iconColor}`} strokeWidth={2} />
        </div>
        
        {/* Content */}
        <div className="flex-1">
          <h3 className="text-[13px] font-semibold text-[#1F2937] mb-0.5">{title}</h3>
          <p className="text-[12px] text-[#6B7280]">{count} documents</p>
        </div>
      </div>
    </div>
  );
}
