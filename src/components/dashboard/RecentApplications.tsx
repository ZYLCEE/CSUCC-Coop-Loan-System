"use client";

import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";
import { StatusBadge } from "@/components/ui/StatusBadge";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { useState } from "react";
import LoanDetailsModal from "../loan-applications/LoanDetailsModal";
import Link from "next/link";
import { ArrowRight, FileText, RefreshCw } from "lucide-react";
import { formatPeso, formatSubmissionDate, type DashboardLoan } from "./dashboard-model";

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
    <Card padded={false} aria-labelledby="recent-applications-heading" aria-busy={loading} className="min-w-0 overflow-hidden">
      {detailId && <LoanDetailsModal applicationId={detailId} onClose={() => setDetailId(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 id="recent-applications-heading" className="text-card-title">Recent Loan Applications</h2>
          <p className="mt-1 text-xs leading-5 text-portal-secondary">The five most recently submitted applications</p>
        </div>
        <Link href={applicationsHref} className={actionButtonStyles()}>View All<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
      </div>
      <DataTable label="Recent loan applications table" className="min-w-[960px]">
          <caption className="sr-only">Five most recent loan applications, sorted by submission date, newest first</caption>
          <thead>
            <tr>{["Application ID", "Member Name", "Loan Type", "Requested Amount", "Date Submitted", "Status", "Action"].map((heading) => <th key={heading} scope="col" className={`whitespace-nowrap px-5 py-3 ${heading === "Requested Amount" ? "text-right" : ""}`}>{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading ? Array.from({ length: 5 }, (_, index) => (
              <tr key={index} aria-hidden="true">{Array.from({ length: 7 }, (_, column) => <td key={column} className="px-5 py-4"><div className="h-4 w-full animate-pulse rounded bg-slate-100 motion-reduce:animate-none" /></td>)}</tr>
            )) : error ? null : applications.map((application) => (
              <tr key={application.id} className="transition-colors hover:bg-[#F8FAFC]">
                <td className="whitespace-nowrap px-5 py-3 font-semibold text-coop-primary">{application.id}</td>
                <td className="px-5 py-3"><p className="max-w-48 truncate font-medium text-portal-primary" title={application.member}>{application.member.trim() || "Member name not recorded"}</p><p className="mt-1 text-caption text-portal-secondary">{application.memberId.trim() || "Member ID not recorded"}</p></td>
                <td className="whitespace-nowrap px-5 py-3 text-portal-secondary">{application.type.trim() || "Loan type not recorded"}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-portal-primary tabular-nums">{formatPeso(application.amount)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-portal-secondary">{formatSubmissionDate(application.submittedAt)}</td>
                <td className="whitespace-nowrap px-5 py-3"><StatusBadge status={application.status} /></td>
                <td className="whitespace-nowrap px-5 py-3"><button type="button" aria-label={`View details for ${application.id}`} onClick={() => setDetailId(application.id)} className={actionButtonStyles()}>View Details</button></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      {!loading && error && (
        <div role="alert" className="px-5 py-4">
          <EmptyState title="Unable to load recent applications" description={error}
            action={onRetry && <button type="button" onClick={onRetry} className={actionButtonStyles()}><RefreshCw className="size-icon-compact" aria-hidden="true" />Retry</button>} />
        </div>
      )}
      {!loading && !error && !applications.length && (
        <EmptyState icon={FileText} title="No loan applications found" description="Recent loan applications will appear here once members submit their requests." />
      )}
      {loading && <p role="status" className="sr-only">Loading recent loan applications</p>}
    </Card>
  );
}
