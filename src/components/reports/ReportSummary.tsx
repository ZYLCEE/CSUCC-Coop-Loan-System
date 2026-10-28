"use client";

import SummaryCard from "./SummaryCard";
import AreaChart from "./AreaChart";

export default function ReportSummary() {
  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E8EDF3] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-bold text-[#1F2937] font-poppins">Loan Summary</h2>
        <p className="text-[12px] text-[#6B7280] font-inter">No report data loaded</p>
      </div>

      {/* Summary Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <SummaryCard value="—" label="Total Applications" />
        <SummaryCard value="—" label="Total Approved" />
        <SummaryCard value="—" label="Total Released" />
        <SummaryCard value="—" label="Total Collections" />
      </div>

      {/* Area Chart */}
      <AreaChart />
    </div>
  );
}
