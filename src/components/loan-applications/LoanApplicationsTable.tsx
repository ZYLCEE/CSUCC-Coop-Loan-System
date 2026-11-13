"use client";

import { navigateRecordMenu, recordMenuPosition } from "@/components/shared/recordMenu";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Eye, FileCheck2, MoreVertical, Undo2 } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { LoanApplication } from "@/lib/api";
import ApplicationTableRow,{ApplicationTableHead} from "./ApplicationTableRow";
import LoanDetailsModal from "./LoanDetailsModal";
import LoanDocumentsModal from "./LoanDocumentsModal";
import LoanReleaseDialog from "./LoanReleaseDialog";
import ReturnApplicationDialog from "./ReturnApplicationDialog";
import ProcessApplicationDialog from "./ProcessApplicationDialog";
import {workflowStageLabel,type WorkflowSummary} from "@/lib/applicationWorkflow";

interface LoanApplicationsTableProps {
  applications: LoanApplication[];
  hasActiveFilters: boolean;
  readOnly?: boolean;
  onApplicationUpdated: () => void;
  workflow?: Record<string,WorkflowSummary>;
}

type ActionMenuState = ReturnType<typeof recordMenuPosition> & { id: string };

const formatAmount = (amount: string) => {
  const numericAmount = Number(amount.replace(/[^\d.-]/g, ""));

  if (!Number.isFinite(numericAmount)) {
    return amount;
  }

  return `₱${numericAmount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};


export default function LoanApplicationsTable({
  applications,
  hasActiveFilters,
  readOnly = false,
  onApplicationUpdated,
  workflow = {},
}: LoanApplicationsTableProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<ActionMenuState | null>(null);
  const [documentApplicationId, setDocumentApplicationId] = useState<string | null>(null);
  const [releaseApplicationId, setReleaseApplicationId] = useState<string | null>(null);
  const [returnId,setReturnId]=useState<string|null>(null);
  const [verificationId,setVerificationId]=useState<string|null>(null);
  const { can } = useAdminAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (openMenu) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [openMenu]);
  const selectedApplication = openMenu
    ? applications.find((application) => application.id === openMenu.id)
    : null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (target.closest("[data-loan-action-button='true']")) {
        return;
      }

      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    const closeOnViewportChange = () => setOpenMenu(null);
    const closeOnScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) closeOnViewportChange();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnScroll, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, []);

  const handleActionButtonClick = (
    application: LoanApplication,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (openMenu?.id === application.id) {
      setOpenMenu(null);
      return;
    }

    menuTrigger.current = event.currentTarget;

    setOpenMenu({
      id: application.id,
      ...recordMenuPosition(event.currentTarget, 214, 216),
    });
  };

  const handleMenuAction = (action: string, application: LoanApplication) => {
    setOpenMenu(null);
    menuTrigger.current?.focus({ preventScroll: true });
    if (action === "release loan" && !readOnly && application.status === "Approved") {
      if(workflow[application.id]?.enrolled&&workflow[application.id]?.stage!=="final_approved")return;
      setReleaseApplicationId(application.id);
      return;
    }
    if (action === "view documents") {
      setDocumentApplicationId(application.id);
      return;
    }

    setDetailId(application.id);
  };

  return (
    <div className="relative">
      {detailId && <LoanDetailsModal applicationId={detailId} onClose={() => setDetailId(null)} onWorkflowUpdated={onApplicationUpdated} />}
      {verificationId && <ProcessApplicationDialog key={verificationId} applicationId={verificationId} onClose={()=>setVerificationId(null)} onUpdated={onApplicationUpdated} />}
      {returnId&&<ReturnApplicationDialog applicationId={returnId} onClose={()=>setReturnId(null)} onSaved={()=>{setReturnId(null);onApplicationUpdated();}} />}
      {releaseApplicationId && <LoanReleaseDialog key={releaseApplicationId} applicationId={releaseApplicationId} onClose={() => setReleaseApplicationId(null)} onReleased={onApplicationUpdated} />}
      {documentApplicationId && <LoanDocumentsModal key={documentApplicationId} applicationId={documentApplicationId} onClose={() => setDocumentApplicationId(null)} />}
      <DataTable label="Loan applications table" density="compact" className="min-w-[1000px] table-fixed">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[7%]" />
          </colgroup>
          <ApplicationTableHead/>
          <tbody>
            {applications.length > 0 ? (
              applications.map((application) => (
                <ApplicationTableRow key={application.id} record={{...application,amount:formatAmount(application.amount),workflowLabel:workflowStageLabel(workflow[application.id],application.status)}}>
<button
                        type="button"
                        data-loan-action-button="true"
                        onClick={(event) => handleActionButtonClick(application, event)}
                        className="ui-icon-button"
                        aria-label={`Open actions for ${application.id}`}
                        aria-haspopup="menu"
                        aria-expanded={openMenu?.id === application.id}
                      >
                        <MoreVertical className="size-icon" aria-hidden="true" />
                      </button>                </ApplicationTableRow>
              ))
            ) : null}
          </tbody>
      </DataTable>
      {!applications.length && <EmptyState title="No loan applications found." description={hasActiveFilters ? "Try changing your search or filters." : "No loan applications have been submitted yet."} />}

      {openMenu && selectedApplication && (
        <div
          ref={menuRef}
          style={{ top: openMenu.top, bottom: openMenu.bottom, left: openMenu.left, maxHeight: openMenu.maxHeight }}
          onKeyDown={event => navigateRecordMenu(event, () => { setOpenMenu(null); menuTrigger.current?.focus({ preventScroll: true }); })}
          className="ui-card fixed z-[60] w-[214px] overflow-y-auto p-1 shadow-portal-dropdown"
          role="menu"
        >
          <button
            type="button"
            onClick={() => handleMenuAction("view details", selectedApplication)}
            className="ui-button ui-button--compact ui-button--ghost w-full justify-start text-start text-[#374151] transition-colors hover:bg-surface-muted hover:text-coop-dashboard-green"
            role="menuitem"
          >
            <Eye className="h-4 w-4" />
            View Details
          </button>
          <button type="button" role="menuitem" className="ui-button ui-button--compact ui-button--ghost w-full justify-start text-start" onClick={()=>{setOpenMenu(null);setVerificationId(selectedApplication.id);}}>
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />Process Application
          </button>
          {!readOnly && can("loans.release") && (!workflow[selectedApplication.id]?.enrolled||workflow[selectedApplication.id]?.stage==="final_approved") && selectedApplication.status === "Approved" && <button
            type="button"
            onClick={() => handleMenuAction("release loan", selectedApplication)}
            className="ui-button ui-button--compact ui-button--ghost w-full justify-start text-start text-[#047857] transition-colors hover:bg-[#ECFDF5]"
            role="menuitem"
          >
            <CheckCircle2 className="h-4 w-4" />
            Record Loan Release
          </button>}
          {!readOnly&&can("applications.return")&&["Pending"].includes(selectedApplication.status)&&<button type="button" role="menuitem" className="ui-button ui-button--compact ui-button--ghost w-full justify-start text-start" onClick={()=>{setOpenMenu(null);setReturnId(selectedApplication.id);}}><Undo2 className="h-4 w-4" aria-hidden="true" />Return Application</button>}
        </div>
      )}
    </div>
  );
}
