"use client";

import { Download, Search } from "lucide-react";
import { ActiveLoan } from "./ActiveLoansData";

type ActiveLoanStatusFilter = "All Loan Status" | ActiveLoan["status"];
type ActiveLoanSortOption = "Newest" | "Oldest";

interface LoanToolbarProps {
  searchValue: string;
  memberIdValue: string;
  loanTypeFilter: string;
  statusFilter: ActiveLoanStatusFilter;
  sortOption: ActiveLoanSortOption;
  pageSize: number;
  loanTypeOptions: string[];
  onSearchChange: (value: string) => void;
  onMemberIdChange: (value: string) => void;
  onApplyFilters: () => void;
  onLoanTypeChange: (value: string) => void;
  onStatusFilterChange: (value: ActiveLoanStatusFilter) => void;
  onSortChange: (value: ActiveLoanSortOption) => void;
  onPageSizeChange: (value: number) => void;
  onExport: () => void;
}

const controlBase =
  "h-10 rounded-[8px] border border-[#D1D5DB] bg-white text-[14px] font-medium text-[#0F172A] focus:border-[#155D3B] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/15";
const selectBase = `${controlBase} px-3`;
const primaryButtonBase =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] bg-[#155D3B] text-[14px] font-bold text-white transition-colors hover:bg-[#134A30] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/25";

const statusOptions: ActiveLoanStatusFilter[] = [
  "All Loan Status",
  "Current",
  "Due Soon",
  "Overdue",
];

export default function LoanToolbar({
  searchValue,
  memberIdValue,
  loanTypeFilter,
  statusFilter,
  sortOption,
  pageSize,
  loanTypeOptions,
  onSearchChange,
  onMemberIdChange,
  onApplyFilters,
  onLoanTypeChange,
  onStatusFilterChange,
  onSortChange,
  onPageSizeChange,
  onExport,
}: LoanToolbarProps) {
  const handleFilterKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      onApplyFilters();
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative min-w-0 md:flex-[1.15]">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="text"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={handleFilterKeyDown}
              placeholder="Search active loans..."
              className={`${controlBase} w-full min-w-0 pl-11 pr-4 placeholder:text-[#64748B]`}
            />
          </div>
          <input
            type="text"
            value={memberIdValue}
            onChange={(event) => onMemberIdChange(event.target.value)}
            onKeyDown={handleFilterKeyDown}
            placeholder="Filter by Member ID"
            className={`${controlBase} w-full min-w-0 px-4 placeholder:text-[#64748B] md:flex-[0.72]`}
          />

          <button
            type="button"
            onClick={onApplyFilters}
            className={`${primaryButtonBase} px-5`}
          >
            Apply
          </button>
        </div>

        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border border-[#D1D5DB] bg-white px-5 text-[14px] font-bold text-[#374151] transition-colors hover:bg-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#155D3B]/15 xl:ml-4"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t border-[#E5E7EB] px-6 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[14px] font-semibold text-[#475569]">Filters:</span>
          <select
            value={loanTypeFilter}
            onChange={(event) => onLoanTypeChange(event.target.value)}
            className={`${selectBase} w-[150px]`}
            aria-label="Filter by loan type"
          >
            <option value="All Loan Types">All Loan Types</option>
            {loanTypeOptions.map((loanType) => (
              <option key={loanType} value={loanType}>
                {loanType}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as ActiveLoanStatusFilter)}
            className={`${selectBase} w-[150px]`}
            aria-label="Filter by loan status"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <select
            value={sortOption}
            onChange={(event) => onSortChange(event.target.value as ActiveLoanSortOption)}
            className={`${selectBase} w-[150px]`}
            aria-label="Sort active loans"
          >
            <option value="Newest">Newest</option>
            <option value="Oldest">Oldest</option>
          </select>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className={`${selectBase} w-[150px]`}
            aria-label="Active loans per page"
          >
            <option value={10}>10 per page</option>
            <option value={15}>15 per page</option>
            <option value={25}>25 per page</option>
          </select>
        </div>
      </div>
    </>
  );
}

export type { ActiveLoanSortOption, ActiveLoanStatusFilter };
