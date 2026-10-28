"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import ActionButtons from "./ActionButtons";

export default function ReportGeneratorCard() {
  const [reportType, setReportType] = useState("Loan Summary");
  const [period, setPeriod] = useState("Daily");
  const [date, setDate] = useState("");

  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E5E7EB] p-4">
      <h2 className="text-[16px] font-semibold text-[#1F2937] mb-3">Generate Report</h2>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        {/* Report Type */}
        <div>
          <label className="block text-[11px] font-semibold uppercase text-[#6B7280] tracking-wider mb-1.5">
            Report Type
          </label>
          <div className="relative">
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full h-[38px] px-4 pr-10 bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] text-[#1F2937] appearance-none focus:outline-none focus:ring-2 focus:ring-[#166534]/20"
            >
              <option value="Loan Summary">Loan Summary</option>
              <option value="Member Activity">Member Activity</option>
              <option value="Payment History">Payment History</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-4 h-4 pointer-events-none" />
          </div>
        </div>

        {/* Period */}
        <div>
          <label className="block text-[11px] font-semibold uppercase text-[#6B7280] tracking-wider mb-1.5">
            Period
          </label>
          <div className="relative">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full h-[38px] px-4 pr-10 bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] text-[#1F2937] appearance-none focus:outline-none focus:ring-2 focus:ring-[#166534]/20"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
              <option value="Yearly">Yearly</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] w-4 h-4 pointer-events-none" />
          </div>
        </div>

        {/* Date */}
        <div>
          <label className="block text-[11px] font-semibold uppercase text-[#6B7280] tracking-wider mb-1.5">
            Date
          </label>
          <div className="relative">
            <input
              type="text"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-[38px] px-4 bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] text-[#1F2937] focus:outline-none focus:ring-2 focus:ring-[#166534]/20"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <ActionButtons />
    </div>
  );
}
