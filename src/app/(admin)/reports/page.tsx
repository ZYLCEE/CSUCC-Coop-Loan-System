"use client";

import ReportGeneratorCard from "@/components/reports/ReportGeneratorCard";
import ReportSummary from "@/components/reports/ReportSummary";

export default function ReportsPage() {
  return (
    <div className="px-6 py-4">
      {/* Report Generator Card */}
      <div className="mb-3">
        <ReportGeneratorCard />
      </div>

      {/* Report Summary Card */}
      <ReportSummary />
    </div>
  );
}
