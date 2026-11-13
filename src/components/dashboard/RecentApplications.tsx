"use client";

import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";
import ApplicationTableRow,{ApplicationTableHead} from "../loan-applications/ApplicationTableRow";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { useState } from "react";
import LoanDetailsModal from "../loan-applications/LoanDetailsModal";
import { Eye, FileText, RefreshCw } from "lucide-react";
import { formatPeso, type DashboardLoan } from "./dashboard-model";

interface RecentApplicationsProps {
  applications?: DashboardLoan[];
  loading?: boolean;
  error?: string | null;
  applicationsHref?: string;
  onRetry?: () => void;
}

export default function RecentApplications({
  applications = [], loading = false, error, onRetry,
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
      </div>
      <DataTable label="Recent loan applications table" density="compact" className="min-w-[1000px] table-fixed">
          <caption className="sr-only">Five most recent loan applications, sorted by submission date, newest first</caption>
          <colgroup>{[16,16,12,14,12,11,12,7].map((width,index)=><col key={index} style={{width:width+"%"}}/>)}</colgroup>
          <ApplicationTableHead/>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading ? Array.from({ length: 5 }, (_, index) => (
              <tr key={index} aria-hidden="true">{Array.from({ length: 8 }, (_, column) => <td key={column} className="px-5 py-4"><div className="h-4 w-full animate-pulse rounded bg-slate-100 motion-reduce:animate-none" /></td>)}</tr>
            )) : error ? null : applications.map((application) => (
              <ApplicationTableRow key={application.id} record={{...application,amount:formatPeso(application.amount),date:application.submittedAt}}>
<button type="button" aria-label={`View details for ${application.id}`} onClick={() => setDetailId(application.id)} className="ui-icon-button" title="View Details"><Eye className="size-icon" aria-hidden="true"/></button>              </ApplicationTableRow>
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
