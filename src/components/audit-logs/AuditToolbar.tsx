"use client";

import { useState } from "react";
import { Search, ChevronDown, Download } from "lucide-react";

interface AuditToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  actionFilter: string;
  onActionFilterChange: (filter: string) => void;
  dateFilter: string;
  onDateFilterChange: (date: string) => void;
}

export default function AuditToolbar({
  searchQuery,
  onSearchChange,
  actionFilter,
  onActionFilterChange,
  dateFilter,
  onDateFilterChange,
}: AuditToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] w-3.5 h-3.5" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search logs..."
          className="w-[180px] h-[36px] pl-9 pr-3 bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] text-[#1F2937] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#166534]/20"
        />
      </div>

      {/* Action Filter */}
      <div className="relative">
        <select
          value={actionFilter}
          onChange={(e) => onActionFilterChange(e.target.value)}
          className="w-[140px] h-[36px] px-3 pr-9 bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] text-[#1F2937] appearance-none focus:outline-none focus:ring-2 focus:ring-[#166534]/20"
        >
          <option value="All Actions">All Actions</option>
          <option value="Login">Login</option>
          <option value="Logout">Logout</option>
          <option value="Loan Approved">Loan Approved</option>
          <option value="Loan Rejected">Loan Rejected</option>
          <option value="Member Updated">Member Updated</option>
          <option value="Notification Sent">Notification Sent</option>
          <option value="Announcement Posted">Announcement Posted</option>
          <option value="Settings Changed">Settings Changed</option>
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] w-3.5 h-3.5 pointer-events-none" />
      </div>

      {/* Date Filter */}
      <div className="relative">
        <input
          type="text"
          value={dateFilter}
          onChange={(e) => onDateFilterChange(e.target.value)}
          placeholder="mm/dd/yyyy"
          className="w-[120px] h-[36px] px-3 bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] text-[#1F2937] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#166534]/20"
        />
      </div>

      {/* Export Button */}
      <button className="flex items-center gap-2 px-3 h-[36px] bg-white border border-[#E5E7EB] rounded-[10px] text-[13px] font-semibold text-[#1F2937] hover:bg-[#F9FAFB] transition-colors">
        <Download className="w-3.5 h-3.5" />
        Export
      </button>
    </div>
  );
}
