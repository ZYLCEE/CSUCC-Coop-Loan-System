"use client";
import type {ApplicationVerification} from "@/lib/applicationWorkflow";
import type {AdminReviewState} from "@/lib/committeeReview";
import {committeeProgress} from "@/lib/applicationProcessing";
import {Badge} from "@/components/ui/StatusBadge";
import ProcessingRequirements from "./ProcessingRequirements";
import ProcessingReviewStep from "./ProcessingReviewStep";
import ApplicationSummaryDetails from "./ApplicationSummaryDetails";
import type {ReviewAction} from "./CommitteeReviewPanel";

export default function FinalApplicationSummary({application,review,onAction,onBusy}:{application:ApplicationVerification;review:AdminReviewState|null;onAction:(action:ReviewAction)=>void;onBusy:(value:boolean)=>void}){
 const crecom=committeeProgress(review,"CRECOM"),bod=committeeProgress(review,"BOD"),complete=!!review?.verified&&crecom.approved&&bod.approved;
 const finalRejected=review?.finalDecision?.decision==="reject"||application.loanStatus.toLowerCase()==="rejected";
 const rejected=crecom.rejected||bod.rejected||finalRejected;
 return <section aria-label="Final application summary" className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-4"><div><h3 className="text-section-title font-semibold">Final Application Summary</h3><p className="mt-1 text-support text-portal-secondary">Review the application, requirements and recorded committee decisions before the final decision.</p></div><Badge tone={rejected?"danger":complete?"success":"warning"}>{finalRejected?"Application rejected":rejected?"Committee rejection recorded":complete?"4 of 4 committee approvals":"Required approvals pending"}</Badge></div>
  <ApplicationSummaryDetails application={application} review={review}/>
  <ProcessingRequirements data={application} checks={application.checks} editable={false} canReview={false} dirty={false} busy={false} onCheck={()=>{}} onUpdated={async()=>{}} onBusy={onBusy}/>
  <ProcessingReviewStep step={4} currentStep={4} data={review} application={application} onAction={onAction}/>
 </section>;
}
