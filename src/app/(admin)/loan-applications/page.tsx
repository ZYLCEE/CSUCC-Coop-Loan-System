"use client";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { useEffect, useMemo, useState } from "react";
import Toolbar, {
  LoanPaginationControls,
  LoanSortOption,
  LoanStatusFilter,
} from "@/components/loan-applications/Toolbar";
import LoanApplicationsTable from "@/components/loan-applications/LoanApplicationsTable";
import { Card } from "@/components/ui/Card";
import { LoadingState } from "@/components/ui/Feedback";
import { Pagination } from "@/components/ui/Pagination";
import { fetchLoanApplications, LoanApplication } from "@/lib/api";
import { MembershipTypeFilter, normalizeMembershipMemberId } from "@/lib/membership";
import { getLoanTypeLabel } from "@/lib/loanTypeLabel";
import { getSupabaseClient } from "@/lib/supabase";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import type {WorkflowSummary} from "@/lib/applicationWorkflow";
import PortalPageHeading from "@/components/shared/PortalPageHeading";

interface ApplicationFilters {
  search: string;
  loanType: string;
  status: LoanStatusFilter;
  membershipType: MembershipTypeFilter;
}

const getApplicationTime = (application: LoanApplication) => {
  const parsedDate = Date.parse(application.date);
  return Number.isNaN(parsedDate) ? 0 : parsedDate;
};

export default function LoanApplicationsPage() {
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [workflow,setWorkflow]=useState<Record<string,WorkflowSummary>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [filters, setFilters] = useState<ApplicationFilters>({
    search: "",
    loanType: "All Loan Types",
    status: "All Status",
    membershipType: "All Members",
  });
  const [sortOption, setSortOption] = useState<LoanSortOption>("Newest");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const { role } = useAdminAuth();
  const readOnly = role !== "super_admin";

  const refreshApplications = () => {
    setLoading(true);
    setLoadError("");
    setRefreshVersion((version) => version + 1);
  };

  useEffect(() => {
    let isActive = true;
    void Promise.all([fetchLoanApplications(),workflowRequest<WorkflowSummary[]>("operation=summary")])
      .then(([data,summaries]) => {
        if (isActive) {
          setApplications(data);
          setWorkflow(Object.fromEntries(summaries.map(item=>[item.applicationId,item])));
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
  }, [refreshVersion]);

  useEffect(() => {
    const client = getSupabaseClient();
    const channel = client
      .channel("admin-loan-applications")
      .on("postgres_changes", { event: "*", schema: "public", table: "loan_applications" }, () => {
        setRefreshVersion((version) => version + 1);
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, []);

  const loanTypeOptions = useMemo(() => {
    return Array.from(new Set(applications.map((application) => application.type))).sort();
  }, [applications]);

  const filteredApplications = useMemo(() => {
    const search = normalizeMembershipMemberId(filters.search);

    return applications.filter((application) => {
      const searchableText = [
        application.id,
        application.member,
        application.memberId,
        getLoanTypeLabel(application.type),
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch = searchableText.includes(search);
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
    filters.loanType !== "All Loan Types" ||
    filters.status !== "All Status" ||
    filters.membershipType !== "All Members";

  const updateFilters = (changes: Partial<ApplicationFilters>) => {
    setFilters((current) => ({ ...current, ...changes }));
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
        getLoanTypeLabel(application.type),
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
    <Card padded={false} className="overflow-hidden">
      <PortalPageHeading section="loan-applications" />
      <Toolbar
        searchValue={filters.search}
        loanTypeFilter={filters.loanType}
        statusFilter={filters.status}
        membershipTypeFilter={filters.membershipType}
        loanTypeOptions={loanTypeOptions}
        onSearchChange={(search) => updateFilters({ search })}
        onLoanTypeChange={(loanType) => updateFilters({ loanType })}
        onStatusFilterChange={(status) => updateFilters({ status })}
        onMembershipTypeChange={(membershipType) => updateFilters({ membershipType })}
        onExport={exportApplications}
      />
      {loading ? (
        <LoadingState label="Loading applications..." />
      ) : loadError ? (
        <div role="alert" className="border-t border-portal-border px-4 py-10 text-center text-sm font-medium text-status-danger">
          {loadError}
          <button
            type="button"
            onClick={refreshApplications}
            className={`ml-2 ${actionButtonStyles()}`}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <LoanApplicationsTable
            applications={paginatedApplications}
            hasActiveFilters={hasActiveFilters}
            readOnly={readOnly}
            onApplicationUpdated={refreshApplications}
            workflow={workflow}
          />
          <Pagination
            currentPage={activePage}
            totalPages={totalPages}
            totalItems={sortedApplications.length}
            showingFrom={showingFrom}
            showingTo={showingTo}
            onPageChange={setCurrentPage}
            itemLabel="applications"
            showStepButtons
            controls={
              <LoanPaginationControls
                sortOption={sortOption}
                pageSize={pageSize}
                onSortChange={updateSortOption}
                onPageSizeChange={updatePageSize}
              />
            }
          />
        </>
      )}
    </Card>
  );
}
