"use client";

import { BarChart3, Download, Printer } from "lucide-react";

export default function ActionButtons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Generate Report Button */}
      <button className="flex items-center gap-2 px-4 h-[36px] bg-[#166534] rounded-[10px] text-[13px] font-semibold text-white hover:bg-[#14532D] transition-colors">
        <BarChart3 className="w-3.5 h-3.5" />
        Generate Report
      </button>

      {/* Export PDF */}
      <button className="flex items-center gap-2 px-4 h-[36px] bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] font-semibold text-[#1F2937] hover:bg-[#F9FAFB] transition-colors">
        <Download className="w-3.5 h-3.5" />
        Export PDF
      </button>

      {/* Export Excel */}
      <button className="flex items-center gap-2 px-4 h-[36px] bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] font-semibold text-[#1F2937] hover:bg-[#F9FAFB] transition-colors">
        <Download className="w-3.5 h-3.5" />
        Export Excel
      </button>

      {/* Print */}
      <button className="flex items-center gap-2 px-4 h-[36px] bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] font-semibold text-[#1F2937] hover:bg-[#F9FAFB] transition-colors">
        <Printer className="w-3.5 h-3.5" />
        Print
      </button>
    </div>
  );
}
