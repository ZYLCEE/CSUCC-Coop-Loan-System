"use client";
import type {ApplicationVerification} from "@/lib/applicationWorkflow";
import type {AdminReviewState} from "@/lib/committeeReview";
import {committeeMoney,committeeDate} from "@/lib/committeePresentation";
import {committeeProgress} from "@/lib/applicationProcessing";
import {Badge} from "@/components/ui/StatusBadge";
import ProcessingRequirements from "./ProcessingRequirements";
import ProcessingReviewStep from "./ProcessingReviewStep";
import type {ReviewAction} from "./CommitteeReviewPanel";

export default function FinalApplicationSummary({application,review,onAction,onBusy}:{application:ApplicationVerification;review:AdminReviewState|null;onAction:(action:ReviewAction)=>void;onBusy:(value:boolean)=>void}){
 const saved=review?.applicationSummary,summary=application.loanSummary;
 const amount=summary?.amount??saved?.amount,months=summary?.months??saved?.tenureMonths,payment=summary?.monthlyPayment??saved?.monthlyPayment,purpose=summary?.purpose??saved?.purpose;
 const crecom=committeeProgress(review,"CRECOM"),bod=committeeProgress(review,"BOD"),complete=!!review?.verified&&crecom.approved&&bod.approved;
 const finalRejected=review?.finalDecision?.decision==="reject"||application.loanStatus.toLowerCase()==="rejected";
 const rejected=crecom.rejected||bod.rejected||finalRejected;
 const verification=application.history.find(event=>event.action==="mark_verified");
 return <section aria-label="Final application summary" className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted p-4"><div><h3 className="text-section-title font-semibold">Final Application Summary</h3><p className="mt-1 text-support text-portal-secondary">Review the application, requirements and recorded committee decisions before the final decision.</p></div><Badge tone={rejected?"danger":complete?"success":"warning"}>{finalRejected?"Application rejected":rejected?"Committee rejection recorded":complete?"4 of 4 committee approvals":"Required approvals pending"}</Badge></div>
  <dl className="grid gap-4 rounded-xl border border-portal-border p-4 text-support sm:grid-cols-2 lg:grid-cols-3">{[
   ["Borrower",application.memberName],["Member ID",application.memberNumber],["Application No.",application.applicationId],["Loan Type",application.loanType],
   ["Loan Amount",amount===undefined?"Not recorded":committeeMoney(amount)],["Loan Term",months===undefined?"Not recorded":months+" months"],["Monthly Payment",payment===undefined?"Not recorded":committeeMoney(payment)],
  ].map(([label,value])=><div key={label}><dt className="text-caption text-portal-secondary">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}{purpose&&<div className="sm:col-span-2 lg:col-span-3"><dt className="text-caption text-portal-secondary">Loan Purpose</dt><dd className="mt-1 whitespace-pre-wrap break-words">{purpose}</dd></div>}</dl>
  {verification&&<p className="text-caption text-portal-secondary">Requirements verified by {verification.actor} · {committeeDate(verification.createdAt)}</p>}
  <ProcessingRequirements data={application} checks={application.checks} editable={false} canReview={false} dirty={false} busy={false} onCheck={()=>{}} onUpdated={async()=>{}} onBusy={onBusy}/>
  <ProcessingReviewStep step={4} currentStep={4} data={review} onAction={onAction}/>
  {!review?.finalDecision&&<p className="text-caption text-portal-secondary">The Super Admin confirms the final decision with their own password. An approved loan proceeds to Release; it enters Active Loans only after the actual release is recorded.</p>}
 </section>;
}
