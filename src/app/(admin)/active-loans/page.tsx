"use client";

import { useMemo, useState } from "react";
import LoanToolbar, {
  ActiveLoanSortOption,
  ActiveLoanStatusFilter,
} from "@/components/active-loans/LoanToolbar";
import ActiveLoansTable from "@/components/active-loans/ActiveLoansTable";
import { ActiveLoan, activeLoans } from "@/components/active-loans/ActiveLoansData";

interface AppliedFilters {
  search: string;
  memberId: string;
  loanType: string;
  status: ActiveLoanStatusFilter;
}

const normalizeFilterValue = (value: string) =>
  value.trim().replace(/^CSUCC-/i, "").toLowerCase();

const getLoanTime = (loan: ActiveLoan) => {
  const parsedDate = Date.parse(loan.createdAt);
  return Number.isNaN(parsedDate) ? 0 : parsedDate;
};

export default function ActiveLoansPage() {
  const [searchInput, setSearchInput] = useState("");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [filters, setFilters] = useState<AppliedFilters>({
    search: "",
    memberId: "",
    loanType: "All Loan Types",
    status: "All Loan Status",
  });
  const [sortOption, setSortOption] = useState<ActiveLoanSortOption>("Newest");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const loanTypeOptions = useMemo(() => {
    return Array.from(new Set(activeLoans.map((loan) => loan.type))).sort();
  }, []);

  const filteredLoans = useMemo(() => {
    const search = normalizeFilterValue(filters.search);
    const memberId = normalizeFilterValue(filters.memberId);

    return activeLoans.filter((loan) => {
      // TODO: When backend loan history exists, exclude fully paid loans from the active-loans endpoint.
      const searchableText = [
        loan.loanNumber,
        loan.memberName,
        loan.memberId,
        loan.type,
      ]
        .join(" ")
        .toLowerCase();
      const normalizedMemberId = normalizeFilterValue(loan.memberId);
      const matchesSearch = search === "" || searchableText.includes(search);
      const matchesMemberId =
        memberId === "" || normalizedMemberId.includes(memberId);
      const matchesLoanType =
        filters.loanType === "All Loan Types" || loan.type === filters.loanType;
      const matchesStatus =
        filters.status === "All Loan Status" || loan.status === filters.status;

      return matchesSearch && matchesMemberId && matchesLoanType && matchesStatus;
    });
  }, [filters]);

  const sortedLoans = useMemo(() => {
    return [...filteredLoans].sort((firstLoan, secondLoan) => {
      const firstDate = getLoanTime(firstLoan);
      const secondDate = getLoanTime(secondLoan);

      return sortOption === "Newest"
        ? secondDate - firstDate
        : firstDate - secondDate;
    });
  }, [filteredLoans, sortOption]);

  const totalPages = Math.max(1, Math.ceil(sortedLoans.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const pageStartIndex = (activePage - 1) * pageSize;
  const paginatedLoans = sortedLoans.slice(pageStartIndex, pageStartIndex + pageSize);
  const showingFrom = sortedLoans.length === 0 ? 0 : pageStartIndex + 1;
  const showingTo = Math.min(pageStartIndex + pageSize, sortedLoans.length);
  const hasActiveFilters =
    filters.search.trim() !== "" ||
    filters.memberId.trim() !== "" ||
    filters.loanType !== "All Loan Types" ||
    filters.status !== "All Loan Status";

  const applyTextFilters = () => {
    setFilters((current) => ({
      ...current,
      search: searchInput,
      memberId: memberIdInput,
    }));
    setCurrentPage(1);
  };

  const updateLoanTypeFilter = (loanType: string) => {
    setFilters((current) => ({ ...current, loanType }));
    setCurrentPage(1);
  };

  const updateStatusFilter = (status: ActiveLoanStatusFilter) => {
    setFilters((current) => ({ ...current, status }));
    setCurrentPage(1);
  };

  const updateSortOption = (sort: ActiveLoanSortOption) => {
    setSortOption(sort);
    setCurrentPage(1);
  };

  const updatePageSize = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const exportActiveLoans = () => {
    window.alert("Frontend only: export prepared for the current active loan list.");
  };

  return (
    <div className="overflow-hidden rounded-[8px] border border-[#E1E7EF] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
      <LoanToolbar
        searchValue={searchInput}
        memberIdValue={memberIdInput}
        loanTypeFilter={filters.loanType}
        statusFilter={filters.status}
        sortOption={sortOption}
        pageSize={pageSize}
        loanTypeOptions={loanTypeOptions}
        onSearchChange={setSearchInput}
        onMemberIdChange={setMemberIdInput}
        onApplyFilters={applyTextFilters}
        onLoanTypeChange={updateLoanTypeFilter}
        onStatusFilterChange={updateStatusFilter}
        onSortChange={updateSortOption}
        onPageSizeChange={updatePageSize}
        onExport={exportActiveLoans}
      />

      <ActiveLoansTable
        loans={paginatedLoans}
        currentPage={activePage}
        totalPages={totalPages}
        totalItems={sortedLoans.length}
        showingFrom={showingFrom}
        showingTo={showingTo}
        hasActiveFilters={hasActiveFilters}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}
