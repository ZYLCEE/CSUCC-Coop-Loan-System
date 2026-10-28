"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import TabNavigation from "@/components/content-manager/TabNavigation";
import LoanTypeCard from "@/components/content-manager/LoanTypeCard";
import { loanTypes } from "@/components/content-manager/LoanTypesData";

export default function ContentManagerPage() {
  const [activeTab, setActiveTab] = useState("Loan Types");

  return (
    <div className="px-6 py-3">
      {/* Tab Navigation */}
      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* New Loan Type Button */}
      <div className="flex justify-end mt-3 mb-3">
        <button className="flex items-center gap-2 px-3 h-[34px] bg-[#166534] rounded-[10px] text-[12px] font-semibold text-white hover:bg-[#14532D] transition-colors">
          <Plus className="w-3 h-3" />
          New Loan Type
        </button>
      </div>

      {/* Loan Type Cards */}
      <div className="space-y-2">
        {loanTypes.map((loanType) => (
          <LoanTypeCard key={loanType.id} loanType={loanType} />
        ))}
      </div>
    </div>
  );
}
