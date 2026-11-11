"use client";

import LoanFilterToolbar from "@/components/shared/LoanFilterToolbar";
import { PaginationControls } from "@/components/ui/Pagination";
import type { LoanApplication } from "@/lib/api";
import type { MembershipTypeFilter } from "@/lib/membership";

export type LoanStatusFilter = "All Status" | LoanApplication["status"];
export type LoanSortOption = "Newest" | "Oldest";

interface ToolbarProps {
  searchValue: string;
  loanTypeFilter: string;
  statusFilter: LoanStatusFilter;
  membershipTypeFilter: MembershipTypeFilter;
  loanTypeOptions: string[];
  onSearchChange: (value: string) => void;
  onLoanTypeChange: (value: string) => void;
  onStatusFilterChange: (value: LoanStatusFilter) => void;
  onMembershipTypeChange: (value: MembershipTypeFilter) => void;
  onExport: () => void;
}

const statusOptions: LoanStatusFilter[] = [
  "All Status",
  "Pending",
  "Returned",
  "Approved",
  "Rejected",
];

export default function Toolbar(props: ToolbarProps) {
  return <LoanFilterToolbar {...props} statusOptions={statusOptions}
    searchLabel="Search loan applications by name, Member ID, application ID, or loan type" />;
}

export function LoanPaginationControls({
  sortOption,
  pageSize,
  onSortChange,
  onPageSizeChange,
}: {
  sortOption: LoanSortOption;
  pageSize: number;
  onSortChange: (value: LoanSortOption) => void;
  onPageSizeChange: (value: number) => void;
}) {
  return <PaginationControls sortOption={sortOption} pageSize={pageSize}
    onSortChange={onSortChange} onPageSizeChange={onPageSizeChange}
    sortLabel="Sort loan applications" pageSizeLabel="Applications per page" />;
}
