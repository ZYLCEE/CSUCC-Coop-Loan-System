"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Toolbar, {
  LoanSortOption,
  LoanStatusFilter,
} from "@/components/loan-applications/Toolbar";
import LoanApplicationsTable from "@/components/loan-applications/LoanApplicationsTable";
import { fetchLoanApplications, LoanApplication } from "@/lib/api";
import { MembershipTypeFilter } from "@/lib/membership";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";

interface AppliedFilters {
  search: string;
  memberId: string;
  loanType: string;
  status: LoanStatusFilter;
  membershipType: MembershipTypeFilter;
}

const normalizeFilterValue = (value: string) =>
  value.trim().replace(/^CSUCC-/i, "").toLowerCase();

const getApplicationTime = (application: LoanApplication) => {
  const parsedDate = Date.parse(application.date);
  return Number.isNaN(parsedDate) ? 0 : parsedDate;
};

export default function LoanApplicationsPage() {
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [memberIdInput, setMemberIdInput] = useState("");
  const [filters, setFilters] = useState<AppliedFilters>({
    search: "",
    memberId: "",
    loanType: "All Loan Types",
    status: "All Status",
    membershipType: "All Members",
  });
  const [sortOption, setSortOption] = useState<LoanSortOption>("Newest");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const { role } = useAdminAuth();
  const readOnly = role !== "super_admin";

  const fetchApplications = useCallback(() => fetchLoanApplications(), []);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setApplications(await fetchApplications());
    } catch (error) {
      console.error("Failed to load applications:", error);
      setLoadError("Unable to load applications from the secure loan database.");
    } finally {
      setLoading(false);
    }
  }, [fetchApplications]);

  const refreshApplications = () => {
    setLoading(true);
    setLoadError("");
    void loadApplications();
  };

  useEffect(() => {
    let isActive = true;
    void fetchApplications()
      .then((data) => {
        if (isActive) {
          setApplications(data);
          setLoadError("");
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load applications:", error);
        if (isActive) {
          setLoadError("Unable to load applications from the secure loan database.");
        }
      })
      .finally(() => {
        if (isActive) setLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [fetchApplications]);

  const loanTypeOptions = useMemo(() => {
    return Array.from(new Set(applications.map((application) => application.type))).sort();
  }, [applications]);

  const filteredApplications = useMemo(() => {
    const search = normalizeFilterValue(filters.search);
    const memberId = normalizeFilterValue(filters.memberId);

    return applications.filter((application) => {
      const searchableText = [
        application.id,
        application.member,
        application.memberId,
        application.type,
      ]
        .join(" ")
        .toLowerCase();
      const normalizedMemberId = normalizeFilterValue(application.memberId);

      const matchesSearch = search === "" || searchableText.includes(search);
      const matchesMemberId =
        memberId === "" || normalizedMemberId.includes(memberId);
      const matchesLoanType =
        filters.loanType === "All Loan Types" || application.type === filters.loanType;
      const matchesStatus =
        filters.status === "All Status" || application.status === filters.status;
      const matchesMembershipType =
        filters.membershipType === "All Members" ||
        (application.membershipType ?? null) ===
          (filters.membershipType === "Regular Member" ? "regular" : "associate");

      return (
        matchesSearch &&
        matchesMemberId &&
        matchesLoanType &&
        matchesStatus &&
        matchesMembershipType
      );
    });
  }, [applications, filters]);

  const sortedApplications = useMemo(() => {
    return [...filteredApplications].sort((firstApplication, secondApplication) => {
      const firstDate = getApplicationTime(firstApplication);
      const secondDate = getApplicationTime(secondApplication);

      return sortOption === "Newest"
        ? secondDate - firstDate
        : firstDate - secondDate;
    });
  }, [filteredApplications, sortOption]);

  const totalPages = Math.max(1, Math.ceil(sortedApplications.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);
  const pageStartIndex = (activePage - 1) * pageSize;
  const paginatedApplications = sortedApplications.slice(
    pageStartIndex,
    pageStartIndex + pageSize
  );
  const showingFrom = sortedApplications.length === 0 ? 0 : pageStartIndex + 1;
  const showingTo = Math.min(pageStartIndex + pageSize, sortedApplications.length);
  const hasActiveFilters =
    filters.search.trim() !== "" ||
    filters.memberId.trim() !== "" ||
    filters.loanType !== "All Loan Types" ||
    filters.status !== "All Status" ||
    filters.membershipType !== "All Members";

  const applyTextFilters = () => {
    setFilters((current) => ({
      ...current,
      search: searchInput,
      memberId: memberIdInput,
    }));
    setCurrentPage(1);
  };

  const updateStatusFilter = (status: LoanStatusFilter) => {
    setFilters((current) => ({ ...current, status }));
    setCurrentPage(1);
  };

  const updateLoanTypeFilter = (loanType: string) => {
    setFilters((current) => ({ ...current, loanType }));
    setCurrentPage(1);
  };

  const updateMembershipTypeFilter = (
    membershipType: MembershipTypeFilter
  ) => {
    setFilters((current) => ({ ...current, membershipType }));
    setCurrentPage(1);
  };

  const updateSortOption = (sort: LoanSortOption) => {
    setSortOption(sort);
    setCurrentPage(1);
  };

  const updatePageSize = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const exportApplications = () => {
    const csvRows = [
      [
        "Application ID",
        "Member ID",
        "Member Name",
        "Membership Type",
        "Loan Type",
        "Amount",
        "Status",
        "Date Applied",
      ],
      ...sortedApplications.map((application) => [
        application.id,
        application.memberId,
        application.member,
        application.membershipType ?? "Not Set",
        application.type,
        application.amount,
        application.status,
        application.date,
      ]),
    ];
    const csv = csvRows
      .map((row) =>
        row.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")
      )
      .join("\r\n");
    const downloadUrl = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "loan-applications.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  };

  return (
    <div className="overflow-hidden rounded-[8px] border border-[#E1E7EF] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)]">
      <Toolbar
        searchValue={searchInput}
        memberIdValue={memberIdInput}
        loanTypeFilter={filters.loanType}
        statusFilter={filters.status}
        membershipTypeFilter={filters.membershipType}
        sortOption={sortOption}
        pageSize={pageSize}
        loanTypeOptions={loanTypeOptions}
        onSearchChange={setSearchInput}
        onMemberIdChange={setMemberIdInput}
        onApplyFilters={applyTextFilters}
        onLoanTypeChange={updateLoanTypeFilter}
        onStatusFilterChange={updateStatusFilter}
        onMembershipTypeChange={updateMembershipTypeFilter}
        onSortChange={updateSortOption}
        onPageSizeChange={updatePageSize}
        onExport={exportApplications}
      />

      {loading ? (
        <div className="border-t border-[#E5E7EB] px-4 py-10 text-center text-[14px] font-medium text-[#64748B]">
          Loading applications...
        </div>
      ) : loadError ? (
        <div role="alert" className="border-t border-[#E5E7EB] px-4 py-10 text-center text-sm font-medium text-[#B91C1C]">
          {loadError}
          <button
            type="button"
            onClick={refreshApplications}
            className="ml-2 underline"
          >
            Retry
          </button>
        </div>
      ) : (
        <LoanApplicationsTable
          applications={paginatedApplications}
          currentPage={activePage}
          totalPages={totalPages}
          totalItems={sortedApplications.length}
          showingFrom={showingFrom}
          showingTo={showingTo}
          hasActiveFilters={hasActiveFilters}
          readOnly={readOnly}
          onPageChange={setCurrentPage}
          onApplicationUpdated={refreshApplications}
        />
      )}
    </div>
  );
}
