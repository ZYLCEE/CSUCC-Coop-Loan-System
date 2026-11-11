"use client";

import { Files, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import RepaymentDetailsDialog from "@/components/active-loans/RepaymentDetailsDialog";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { LoadingState } from "@/components/ui/Feedback";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getSupabaseClient } from "@/lib/supabase";
import { loadLoanRejectionDetails, type LoanRejectionDetails } from "@/lib/loanRejection";
import LoanDocumentsModal from "./LoanDocumentsModal";
import { loanDetailsPresentation } from "./loanDetailsPresentation";
import ProcessApplicationDialog from "./ProcessApplicationDialog";

type Props = { applicationId: string; onClose: () => void; onWorkflowUpdated?:()=>void };

export default function LoanDetailsModal(props: Props) {
  // Switching applications remounts the complete view, including nested dialogs.
  return <LoanApplicationDetails key={props.applicationId} {...props} />;
}

function LoanApplicationDetails({ applicationId, onClose, onWorkflowUpdated }: Props) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [rejection, setRejection] = useState<LoanRejectionDetails | null>(null);
  const [rejectionError, setRejectionError] = useState("");
  const [documents, setDocuments] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [verificationOpen,setVerificationOpen]=useState(false);
  const detailAction = useRef<HTMLButtonElement | null>(null);
  const presentation = record ? loanDetailsPresentation(record, applicationId, rejection) : null;

  useEffect(() => {
    if (!documents && !paymentOpen && !verificationOpen && detailAction.current) {
      detailAction.current.focus({ preventScroll: true });
      detailAction.current = null;
    }
  }, [documents, paymentOpen,verificationOpen]);

  useEffect(() => {
    if (paymentOpen) return;
    let active = true;
    void (async () => {
      // Reuse the member relationship already selected by lib/api.ts. RLS still applies.
      const { data, error } = await getSupabaseClient().from("loan_applications")
        .select("*, members:members!loan_applications_member_id_fkey(id, member_id, first_name, last_name, membership_type)")
        .eq("application_id", applicationId).single();
      if (error) throw error;
      if (!data) throw new Error("Loan application details are not available.");
      let decision: LoanRejectionDetails | null = null;
      let decisionError = "";
      if (String(data.status).trim().toLowerCase() === "rejected") {
        try { decision = await loadLoanRejectionDetails(applicationId); }
        catch (error) { decisionError = (error as Error).message; }
      }
      if (active) { setRecord(data); setRejection(decision); setRejectionError(decisionError); setError(""); }
    })().catch(error => { if (active) setError(error.message || "Unable to load loan application details."); });
    return () => { active = false; };
  }, [applicationId, paymentOpen, attempt]);

  return (
    <>
      <DetailDialog title="Loan Application Details" subtitle={applicationId} onClose={onClose} className="max-w-[900px]" dismissOnBackdrop
        footer={<>
          <button type="button" data-dialog-close className={actionButtonStyles()}>Close</button>
          {record && !error && <>
            {["pending","under review","returned","approved","released","overdue","completed","rejected"].includes(String(record.status).toLowerCase()) && <button type="button" className={actionButtonStyles()} onClick={event=>{detailAction.current=event.currentTarget;setVerificationOpen(true);}}>Process Application</button>}
            <button type="button" className={actionButtonStyles(presentation?.operational ? "secondary" : "primary")} onClick={event => {
              detailAction.current = event.currentTarget; setDocuments(true);
            }}><Files className="h-4 w-4" aria-hidden="true" />View documents</button>
            {presentation?.operational && <button type="button" className={`${actionButtonStyles("primary")} max-w-full whitespace-normal!`} onClick={event => {
              detailAction.current = event.currentTarget; setPaymentOpen(true);
            }}><History className="h-4 w-4" aria-hidden="true" />Open repayment details</button>}
          </>}
        </>}>
        {error ? <div className="space-y-3">
          <p role="alert" className="text-body text-status-danger">{error}</p>
          <button type="button" className={actionButtonStyles()} onClick={() => { setRecord(null); setError(""); setAttempt(value => value + 1); }}>Try again</button>
        </div> : !presentation ? <LoadingState label="Loading loan application…" /> : (
          <div className="divide-y divide-portal-border-subtle">
            {rejectionError && <div className="pb-4">
              <p role="alert" className="ui-action-feedback ui-action-feedback--error">{rejectionError}</p>
              <button type="button" className={actionButtonStyles()} onClick={() => { setRecord(null); setRejection(null); setRejectionError(""); setAttempt(value => value + 1); }}>Retry rejection information</button>
            </div>}
            {presentation.sections.map(section => (
              <section key={section.title} aria-label={section.title} className="py-4 first:pt-0 last:pb-0">
                <h3 className="mb-3 text-sm font-semibold text-coop-primary">{section.title}</h3>
                {section.fields.length > 0 && <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  {section.fields.map(field => <div key={field.label} className={`min-w-0 ${field.wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
                    <dt className="text-xs font-medium text-portal-secondary">{field.label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-portal-primary [overflow-wrap:anywhere]">
                      {field.status ? <StatusBadge status={presentation.status} label={field.value} /> : field.value}
                    </dd>
                  </div>)}
                </dl>}
                {section.message && <p className={`${section.fields.length ? "mt-3 " : ""}text-sm leading-6 text-portal-secondary`}>{section.message}</p>}
              </section>
            ))}
          </div>
        )}
      </DetailDialog>
      {documents && <LoanDocumentsModal applicationId={applicationId} onClose={() => setDocuments(false)} />}
      {verificationOpen && <ProcessApplicationDialog applicationId={applicationId} onClose={()=>setVerificationOpen(false)} onUpdated={onWorkflowUpdated} />}
      {paymentOpen && record && <RepaymentDetailsDialog loanId={String(record.id)} onClose={() => setPaymentOpen(false)} />}
    </>
  );
}
