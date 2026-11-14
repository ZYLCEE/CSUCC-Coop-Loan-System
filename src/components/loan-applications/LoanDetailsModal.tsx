"use client";

import { useCallback, useEffect, useState } from "react";
import {usePortalLiveUpdates} from "@/lib/usePortalLiveUpdates";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { LoadingState } from "@/components/ui/Feedback";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getSupabaseClient } from "@/lib/supabase";
import { loadLoanRejectionDetails, type LoanRejectionDetails } from "@/lib/loanRejection";
import { loanDetailsPresentation } from "./loanDetailsPresentation";
import ApplicationRequirementsSummary from "./ApplicationRequirementsSummary";

type Props = { applicationId: string; onClose: () => void; onWorkflowUpdated?:()=>void };

export default function LoanDetailsModal(props: Props) {
  // Switching applications remounts the complete view, including nested dialogs.
  return <LoanApplicationDetails key={props.applicationId} {...props} />;
}

function LoanApplicationDetails({ applicationId, onClose }: Props) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const refresh=useCallback(()=>setAttempt(value=>value+1),[]);
  usePortalLiveUpdates(refresh);
  const [rejection, setRejection] = useState<LoanRejectionDetails | null>(null);
  const [rejectionError, setRejectionError] = useState("");
  const presentation = record ? loanDetailsPresentation(record, applicationId, rejection) : null;

  useEffect(() => {
    let active = true;
    void (async () => {
      // Reuse the member relationship already selected by lib/api.ts. RLS still applies.
      const { data, error } = await getSupabaseClient().from("loan_applications")
        .select("*, members:members!loan_applications_member_id_fkey(*)")
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
  }, [applicationId, attempt]);

  return (
    <>
      <DetailDialog title="Loan Application Details" subtitle={applicationId} onClose={onClose} className="max-w-[900px]" dismissOnBackdrop
        footer={<>
          <button type="button" data-dialog-close className={actionButtonStyles()}>Close</button>

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
              <section key={section.title} aria-label={section.title} className="py-3 first:pt-0 last:pb-0">
                <h3 className="mb-2 text-sm font-semibold text-coop-primary">{section.title}</h3>
                {section.fields.length > 0 && <dl className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {section.fields.map(field => <div key={field.label} className={`min-w-0 ${field.wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
                    <dt className="text-xs font-medium text-portal-secondary">{field.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-5 text-portal-primary [overflow-wrap:anywhere]">
                      {field.status ? <StatusBadge status={presentation.status} label={field.value} /> : field.value}
                    </dd>
                  </div>)}
                </dl>}
                {section.message && <p className={`${section.fields.length ? "mt-2 " : ""}text-sm leading-5 text-portal-secondary`}>{section.message}</p>}
              </section>
            ))}
            <ApplicationRequirementsSummary applicationId={applicationId} refreshVersion={attempt}/>
          </div>
        )}
      </DetailDialog>
    </>
  );
}
