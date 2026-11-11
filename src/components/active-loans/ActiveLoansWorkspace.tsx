"use client";
import PortalPageHeading from "@/components/shared/PortalPageHeading";

import { useEffect, useMemo, useState } from "react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import LoanDetailsModal from "@/components/loan-applications/LoanDetailsModal";
import LoanFilterToolbar from "@/components/shared/LoanFilterToolbar";
import RecordActionsMenu from "@/components/shared/RecordActionsMenu";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { Pagination, PaginationControls } from "@/components/ui/Pagination";
import { sortRowsByDate, type DateSortOrder } from "@/lib/tablePagination";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { adminRequest } from "@/lib/adminRequest";
import { activeLoanStatuses, filterActiveLoans, repaymentProgressLabel, type ActiveLoan, type ActiveLoanStatusFilter } from "@/lib/activeLoans";
import { pesos } from "@/lib/counterPayments";
import { exportCsv } from "@/lib/download";
import { getMembershipTypeLabel, type MembershipTypeFilter } from "@/lib/membership";
import { getLoanTypeLabel } from "@/lib/loanTypeLabel";
import { getSupabaseClient } from "@/lib/supabase";
import CounterPaymentDialog from "./CounterPaymentDialog";
import RepaymentDetailsDialog from "./RepaymentDetailsDialog";

interface Filters {
  search: string;
  status: ActiveLoanStatusFilter;
  loanType: string;
  membershipType: MembershipTypeFilter;
}

const initialFilters: Filters = { search: "", status: "All Status", loanType: "All Loan Types", membershipType: "All Members" };
const statusOptions: ActiveLoanStatusFilter[] = ["All Status", ...activeLoanStatuses];
const displayDate = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }) : "Not recorded";

export default function ActiveLoansWorkspace() {
  const { role } = useAdminAuth();
  const [loans, setLoans] = useState<ActiveLoan[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortOrder, setSortOrder] = useState<DateSortOrder>("Newest");
  const [selected, setSelected] = useState<string | null>(null);
  const [paymentLoan, setPaymentLoan] = useState<string | null>(null);
  const [repaymentLoan, setRepaymentLoan] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void adminRequest("active").then((data: ActiveLoan[]) => {
      if (active) { setLoans(data); setError(""); }
    }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : "Unable to load active loans.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);

  useEffect(() => {
    const client = getSupabaseClient();
    const refresh = () => setVersion(current => current + 1);
    const channel = client.channel("admin-active-loans")
      .on("postgres_changes", { event: "*", schema: "public", table: "loan_applications" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "loan_payments" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, refresh).subscribe();
    return () => { void client.removeChannel(channel); };
  }, []);

  const updateFilters = (changes: Partial<Filters>) => { setFilters(current => ({ ...current, ...changes })); setPage(1); };
  const filtered = useMemo(() => sortRowsByDate(filterActiveLoans(loans, filters), loan => loan.date, sortOrder), [loans, filters, sortOrder]);
  const loanTypes = useMemo(() => Array.from(new Set(loans.map(loan => loan.type))).sort(), [loans]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const hasFilters = filters.search.trim() !== "" || filters.status !== "All Status"
    || filters.loanType !== "All Loan Types" || filters.membershipType !== "All Members";
  const retry = () => { setLoading(true); setError(""); setVersion(current => current + 1); };
  const exportLoans = () => exportCsv("active-loans.csv", filtered.map(loan => ({
    "Application ID": loan.applicationId, "Member ID": loan.memberId, "Member Name": loan.member,
    "Membership Type": loan.membershipType ?? "Not Set", "Loan Type": getLoanTypeLabel(loan.type),
    "Principal": loan.principal, "Monthly Payment": loan.monthlyPayment, "Status": loan.status,
    "Months Paid": loan.progress.monthsPaid, "Term Months": loan.progress.totalMonths,
    "Principal Paid": loan.progress.principalPaid, "Principal Remaining": loan.progress.principalRemaining,
    "Partial Principal Toward Next Month": loan.progress.partialMonthAmount,
    "Repayment Progress": repaymentProgressLabel(loan.progress),
    "Completion Review Pending": loan.progress.settlementPending, "Date Submitted": loan.date,
  })));

  return <Card padded={false} className="overflow-hidden">
    <PortalPageHeading section="active-loans" />
    <LoanFilterToolbar searchValue={filters.search} searchLabel="Search active loans by name, Member ID, application ID, or loan type"
      loanTypeFilter={filters.loanType} statusFilter={filters.status} statusOptions={statusOptions}
      membershipTypeFilter={filters.membershipType} loanTypeOptions={loanTypes}
      onSearchChange={search => updateFilters({ search })} onStatusFilterChange={status => updateFilters({ status })}
      onLoanTypeChange={loanType => updateFilters({ loanType })} onMembershipTypeChange={membershipType => updateFilters({ membershipType })}
      onExport={exportLoans} exportDisabled={loading || !!error || !filtered.length} />
    {loading ? <LoadingState label="Loading active loans…" /> : error ? <div role="alert" className="border-t border-portal-border p-6 text-center text-body text-status-danger">
      {error}<Button className="ml-2" onClick={retry}>Retry</Button>
    </div> : <>
      <DataTable label="Active loans table" density="compact" className="min-w-[1000px] table-fixed">
        <colgroup>
          <col className="w-[14%]" /><col className="w-[16%]" /><col className="w-[14%]" />
          <col className="w-[12%]" /><col className="w-[13%]" /><col className="w-[10%]" />
          <col className="w-[14%]" /><col className="w-[7%]" />
        </colgroup>
        <thead><tr>
          <th scope="col">ID Number</th><th scope="col">Member</th><th scope="col">Loan type</th>
          <th scope="col">Principal</th><th scope="col">Monthly payment</th>
          <th scope="col">Status</th><th scope="col">Submitted</th><th scope="col" className="text-center">Actions</th>
        </tr></thead>
        <tbody>{filtered.slice(start, start + pageSize).map(loan => <tr key={loan.id}>
          <td className="whitespace-normal font-semibold text-coop-dashboard-green [overflow-wrap:anywhere]">{loan.memberId || "Not recorded"}</td>
          <td><p className="whitespace-normal font-semibold [overflow-wrap:anywhere]">{loan.member}</p><p className="mt-0.5 text-caption font-medium text-portal-secondary">{getMembershipTypeLabel(loan.membershipType)}</p></td>
          <td className="whitespace-normal [overflow-wrap:anywhere]">{getLoanTypeLabel(loan.type)}</td>
          <td className="whitespace-nowrap font-semibold tabular-nums">{pesos(loan.principal)}</td>
          <td className="whitespace-nowrap font-semibold tabular-nums">{loan.monthlyPayment === null ? "Not recorded" : pesos(loan.monthlyPayment)}</td>
          <td><StatusBadge status={loan.status} /></td>
          <td className="whitespace-normal">{displayDate(loan.date)}</td>
          <td className="text-center"><RecordActionsMenu label={loan.applicationId} onView={() => setSelected(loan.applicationId)}
            onRepayments={() => setRepaymentLoan(loan.id)}
            onPayment={role === "super_admin" && ["released", "overdue"].includes(loan.recordedStatus) ? () => setPaymentLoan(loan.id) : undefined}
            canRecordPayment={role === "super_admin" && ["released", "overdue"].includes(loan.recordedStatus)} /></td>
        </tr>)}</tbody>
      </DataTable>
      {!filtered.length && <EmptyState title={hasFilters ? "No matching loans." : "No released loans yet."}
        description={hasFilters ? "Try another name, Member ID, or filter." : "Released and completed loans will appear here with their repayment progress."}
        action={hasFilters ? <Button onClick={() => { setFilters(initialFilters); setPage(1); }}>Clear filters</Button> : undefined} />}
      <Pagination label="Active loans pagination" currentPage={currentPage} totalPages={totalPages}
        showingFrom={start + 1} showingTo={Math.min(start + pageSize, filtered.length)} totalItems={filtered.length}
        itemLabel="loans" onPageChange={setPage}
        controls={<PaginationControls sortOption={sortOrder} pageSize={pageSize} sortLabel="Sort active loans" pageSizeLabel="Loans per page"
          onSortChange={value => { setSortOrder(value); setPage(1); }} onPageSizeChange={value => { setPageSize(value); setPage(1); }} />} />
    </>}
    {selected && <LoanDetailsModal applicationId={selected} onClose={() => setSelected(null)} />}
    {paymentLoan && <CounterPaymentDialog key={paymentLoan} loanId={paymentLoan} onClose={() => setPaymentLoan(null)} onSaved={() => setVersion(current => current + 1)} />}
    {repaymentLoan && <RepaymentDetailsDialog loanId={repaymentLoan} onClose={() => setRepaymentLoan(null)} onUpdated={() => setVersion(current => current + 1)} />}
  </Card>;
}
