import type {ApplicationVerification} from "@/lib/applicationWorkflow";
import type {AdminReviewState} from "@/lib/committeeReview";
import {committeeMoney} from "@/lib/committeePresentation";

export default function ApplicationSummaryDetails({application,review}:{application:ApplicationVerification;review:AdminReviewState|null}){
  const saved=review?.applicationSummary,summary=application.loanSummary;
  const amount=summary?.amount??saved?.amount,months=summary?.months??saved?.tenureMonths,payment=summary?.monthlyPayment??saved?.monthlyPayment,purpose=summary?.purpose??saved?.purpose;
  const fields:[string,string][]=[
    ["Borrower",application.memberName],
    ["Member ID",application.memberNumber],
    ["Application No.",application.applicationId],
    ["Loan Type",application.loanType],
    ["Loan Amount",amount===undefined?"Not recorded":committeeMoney(amount)],
    ["Loan Term",months===undefined?"Not recorded":months+" months"],
    ["Monthly Payment",payment===undefined?"Not recorded":committeeMoney(payment)],
  ];
  return <dl className="grid gap-4 rounded-xl border border-portal-border p-4 text-support sm:grid-cols-2 lg:grid-cols-3">
    {fields.map(([label,value])=><div key={label}><dt className="text-caption text-portal-secondary">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
    {purpose&&<div className="sm:col-span-2 lg:col-span-3"><dt className="text-caption text-portal-secondary">Loan Purpose</dt><dd className="mt-1 whitespace-pre-wrap break-words">{purpose}</dd></div>}
  </dl>;
}
