"use client";

import { Wallet, Pencil, Copy, Trash2 } from "lucide-react";
import { LoanType } from "./LoanTypesData";
import LoanTypeBadge from "./LoanTypeBadge";

interface LoanTypeCardProps {
  loanType: LoanType;
}

export default function LoanTypeCard({ loanType }: LoanTypeCardProps) {
  return (
    <div className="bg-white rounded-[14px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-3 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] transition-all duration-200">
      <div className="flex items-start gap-3">
        {/* Left Section - Icon */}
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
          loanType.isActive ? "bg-[#ECFDF5]" : "bg-gray-100"
        }`}>
          <Wallet className={`w-4 h-4 ${loanType.isActive ? "text-[#15803D]" : "text-gray-500"}`} strokeWidth={2} />
        </div>

        {/* Middle Section - Content */}
        <div className="flex-1">
          {/* Title and Badge */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-bold text-[#0F172A]">{loanType.name}</h3>
            <LoanTypeBadge isActive={loanType.isActive} />
          </div>

          {/* Description */}
          <p className="text-[12px] text-[#64748B] mb-2">{loanType.description}</p>

          {/* Loan Information Row */}
          <div className="flex items-center gap-4 text-[11px]">
            <div>
              <span className="text-[#64748B]">Interest Rate:</span>
              <span className="ml-1 font-bold text-[#0F172A]">{loanType.interestRate}</span>
            </div>
            <div>
              <span className="text-[#64748B]">Min:</span>
              <span className="ml-1 font-bold text-[#0F172A]">{loanType.minimum}</span>
            </div>
            <div>
              <span className="text-[#64748B]">Max:</span>
              <span className="ml-1 font-bold text-[#0F172A]">{loanType.maximum}</span>
            </div>
            <div>
              <span className="text-[#64748B]">Term:</span>
              <span className="ml-1 font-bold text-[#0F172A]">{loanType.term}</span>
            </div>
          </div>
        </div>

        {/* Right Section - Action Icons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button className="w-6 h-6 rounded-full flex items-center justify-center text-[#94A3B8] hover:text-[#166534] transition-colors">
            <Pencil className="w-[14px] h-[14px]" strokeWidth={2} />
          </button>
          <button className="w-6 h-6 rounded-full flex items-center justify-center text-[#94A3B8] hover:text-[#2563EB] transition-colors">
            <Copy className="w-[14px] h-[14px]" strokeWidth={2} />
          </button>
          <button className="w-6 h-6 rounded-full flex items-center justify-center text-[#94A3B8] hover:text-[#EF4444] transition-colors">
            <Trash2 className="w-[14px] h-[14px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
