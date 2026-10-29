"use client";

import { useState } from "react";
import LoanDetailsModal from "../loan-applications/LoanDetailsModal";
import Link from "next/link";
import { ArrowRight, FileText, RefreshCw } from "lucide-react";
import { formatPeso, formatSubmissionDate, type DashboardLoan } from "./dashboard-model";

const statusStyles: Record<DashboardLoan["status"], string> = {
  Pending: "border-amber-200 bg-amber-50 text-amber-700",
  "Under Review": "border-blue-200 bg-blue-50 text-blue-700",
  Approved: "border-green-200 bg-green-50 text-green-700",
  Rejected: "border-red-200 bg-red-50 text-red-700",
  Released: "border-teal-200 bg-teal-50 text-teal-700",
  Completed: "border-slate-200 bg-slate-50 text-slate-600",
  Overdue: "border-red-200 bg-red-50 text-red-700",
};

interface RecentApplicationsProps {
  applications?: DashboardLoan[];
  loading?: boolean;
  error?: string | null;
  applicationsHref?: string;
  onRetry?: () => void;
}

export default function RecentApplications({
  applications = [], loading = false, error, applicationsHref = "/loan-applications", onRetry,
}: RecentApplicationsProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  return (
    <section aria-labelledby="recent-applications-heading" aria-busy={loading} className="min-w-0 overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-white shadow-[0_2px_6px_rgba(15,23,42,0.025)]">
      {detailId && <LoanDetailsModal applicationId={detailId} onClose={() => setDetailId(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 id="recent-applications-heading" className="text-base font-semibold text-[#17212F]">Recent Loan Applications</h2>
          <p className="mt-1 text-xs leading-5 text-[#64748B]">The five most recently submitted applications</p>
        </div>
        <Link href={applicationsHref} className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-[#145B3C] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#145B3C]">View All<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </div>
      <div className="overflow-x-auto" role="region" aria-label="Recent loan applications table" tabIndex={0}>
        <table className="w-full min-w-[960px] text-left text-[13px]">
          <caption className="sr-only">Five most recent loan applications, sorted by submission date, newest first</caption>
          <thead className="border-y border-[#E2E8F0] bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-[0.06em] text-[#64748B]">
            <tr>{["Application ID", "Member Name", "Loan Type", "Requested Amount", "Date Submitted", "Status", "Action"].map((heading) => <th key={heading} scope="col" className={`whitespace-nowrap px-5 py-3 ${heading === "Requested Amount" ? "text-right" : ""}`}>{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading ? Array.from({ length: 5 }, (_, index) => (
              <tr key={index} aria-hidden="true">{Array.from({ length: 7 }, (_, column) => <td key={column} className="px-5 py-4"><div className="h-4 w-full animate-pulse rounded bg-slate-100 motion-reduce:animate-none" /></td>)}</tr>
            )) : error ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center">
                <p role="alert" className="text-sm font-semibold text-[#17212F]">Unable to load recent applications</p>
                <p className="mt-2 text-sm text-[#64748B]">{error}</p>
                {onRetry && <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] px-3 py-2 text-xs font-semibold text-[#145B3C] hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Retry</button>}
              </td></tr>
            ) : applications.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center">
                <FileText className="mx-auto mb-3 h-6 w-6 text-slate-400" aria-hidden="true" />
                <p className="text-sm font-semibold text-[#17212F]">No loan applications found</p>
                <p className="mt-2 text-sm text-[#64748B]">Recent loan applications will appear here once members submit their requests.</p>
              </td></tr>
            ) : applications.map((application) => (
              <tr key={application.id} className="transition-colors hover:bg-[#F8FAFC]">
                <td className="whitespace-nowrap px-5 py-3 font-semibold text-[#145B3C]">{application.id}</td>
                <td className="px-5 py-3"><p className="max-w-48 truncate font-medium text-[#17212F]" title={application.member}>{application.member}</p>{application.memberId && <p className="mt-1 text-[11px] text-[#64748B]">{application.memberId}</p>}</td>
                <td className="whitespace-nowrap px-5 py-3 text-[#64748B]">{application.type}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-[#17212F] tabular-nums">{formatPeso(application.amount)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-[#64748B]">{formatSubmissionDate(application.submittedAt)}</td>
                <td className="whitespace-nowrap px-5 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusStyles[application.status]}`}>{application.status}</span></td>
                <td className="whitespace-nowrap px-5 py-3"><button type="button" onClick={() => setDetailId(application.id)} className="text-xs font-medium text-green-800 underline">View Details</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p role="status" className="sr-only">Loading recent loan applications</p>}
      {!loading && !error && applications.length > 0 && <p className="border-t border-[#F1F5F9] px-5 py-2 text-[11px] leading-5 text-[#64748B]">Application details are not yet available. Use View All to open the existing loan applications page.</p>}
    </section>
  );
}
