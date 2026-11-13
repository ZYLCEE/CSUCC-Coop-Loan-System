import type {ApplicationVerification} from "./applicationWorkflow";
import type {AdminReviewState} from "./committeeReview";

export const processingSteps = [
  {number:1, label:"Requirements"},
  {number:2, label:"CRECOM"},
  {number:3, label:"BOD"},
  {number:4, label:"Final Decision"},
  {number:5, label:"Release"},
] as const;
export type ProcessingStep = typeof processingSteps[number]["number"];

export function currentProcessingStep(application:ApplicationVerification, review:AdminReviewState|null):ProcessingStep {
  if (isLoanReleased(application) || review?.finalDecision?.decision === "approve" || application.stage === "final_approved" || application.loanStatus?.toLowerCase() === "approved") return 5;
  if (review?.finalDecision || application.stage === "final_rejected") return 4;
  if (application.stale || application.stage === "review_stale" || review?.verificationStage === "review_stale") return 1;
  if (!application.enrolled || ["not_started","needs_verification","returned_for_requirements"].includes(application.stage)) return 1;
  const stage = review?.verificationStage ?? application.stage;
  if (["ready_for_final","final_approved","final_rejected"].includes(stage)) return 4;
  if (["ready_for_bod","bod_review"].includes(stage)) return 3;
  if (stage === "review_attention" && review?.cycles.some(cycle=>cycle.status!=="superseded"&&cycle.status==="completed"&&cycle.outcome==="reject") && review.cycles.filter(cycle=>cycle.status!=="superseded").every(cycle=>cycle.status==="completed")) return 4;
  if (stage === "review_attention") {
    return review?.cycles.some(cycle=>cycle.status !== "superseded" && cycle.stage === "BOD") ? 3 : 2;
  }
  if (["ready_for_committee","crecom_review"].includes(stage)) return 2;
  return 1;
}

export function isLoanReleased(application:ApplicationVerification) {
  return ["released","overdue","completed"].includes(application.loanStatus?.toLowerCase());
}

export function committeeProgress(review:AdminReviewState|null, stage:"CRECOM"|"BOD") {
  const cycle=review?.cycles.find(item=>item.stage===stage&&item.status!=="superseded");
  const assignments=cycle?.assignments.filter(item=>!["reassigned","cancelled"].includes(item.state))??[];
  const approvals=assignments.filter(item=>item.state==="decision_recorded"&&item.decision==="approve");
  const required=stage==="CRECOM"?3:1;
  const positions=stage==="CRECOM"
    ? approvals.filter(item=>item.signatoryRole==="crecom_member").length===2&&approvals.filter(item=>item.signatoryRole==="crecom_chairperson").length===1
    : approvals.filter(item=>item.signatoryRole==="bod_chairperson").length===1;
  const approved=cycle?.status==="completed"&&cycle.outcome==="approve"&&assignments.length===required&&approvals.length===required&&positions;
  const rejected=cycle?.outcome==="reject"||assignments.some(item=>item.decision==="reject");
  const attention=assignments.some(item=>["awaiting_clarification","recused"].includes(item.state));
  return {cycle,assignments,approvedCount:approvals.length,required,approved,rejected,attention};
}

export function processingStepState(step:ProcessingStep,application:ApplicationVerification,review:AdminReviewState|null) {
  if(step===1)return application.stale||review?.verificationStage==="review_stale"?"attention":review?.verified||["ready_for_committee","crecom_review","bod_review","ready_for_bod","ready_for_final","final_approved"].includes(application.stage)?"complete":"pending";
  if(step===2||step===3){
    const progress=committeeProgress(review,step===2?"CRECOM":"BOD");
    if(application.stale||review?.verificationStage==="review_stale")return "pending";
    return progress.rejected?"rejected":progress.approved?"complete":progress.attention?"attention":"pending";
  }
  if(step===4)return review?.finalDecision?.decision==="reject"||application.stage==="final_rejected"?"rejected":review?.finalDecision?.decision==="approve"||application.stage==="final_approved"?"complete":"pending";
  return isLoanReleased(application)?"complete":"pending";
}

export function processingStepDescription(step:ProcessingStep, application:ApplicationVerification, review:AdminReviewState|null):string {
  if(step===5)return isLoanReleased(application)?"Release recorded. This loan is available in Active Loans.":"Approved — awaiting release. Record the actual disbursement to move this loan to Active Loans.";
  if (review?.finalDecision) return review.finalDecision.decision === "approve"
    ? "Final approval is recorded. Continue to Release to record the disbursement."
    : "The final rejection is recorded. The decision and confirmations remain in the history.";
  if (!application.canEnroll && !application.enrolled) return "This application already left the review stage. Its existing approval or servicing flow is unchanged.";
  if (step === 1) {
    if (application.stale || review?.verificationStage === "review_stale") return "The application or its requirements changed. Restart the requirements check before collecting new confirmations.";
    if (application.stage === "returned_for_requirements") return "The member has been asked to make corrections. Check the updated requirements before continuing.";
    return application.enrolled ? "Check the documents, complete the staff checklist and confirm the required consent evidence."
      : "Start the requirements check, then review the documents and member information.";
  }
  if (!review) return "Review progress could not be loaded. Refresh before continuing.";
  if (step === 4) return "Review the CRECOM and BOD confirmations. The Super Admin records final approval after all four approvals, or final rejection after the assigned reviewers respond.";
  const stage = step === 2 ? "CRECOM" : "BOD";
  const cycle = review.cycles.find(cycle=>cycle.stage === stage && cycle.status !== "superseded");
  if (!cycle) return step === 2 ? "Send the verified application to two CRECOM members and one CRECOM chairperson. All three must approve."
    : "CRECOM review is complete. Send the application and recorded confirmations to one BOD chairperson.";
  if(cycle.outcome === "reject")return "A committee reviewer rejected this application. All assigned reviewers must respond. Super Admin can then record final rejection, or authorized staff can use Return Application from the application menu for a fixable issue.";
  const active = cycle.assignments.filter(item=>!["reassigned","cancelled"].includes(item.state));
  const approved = active.filter(item=>item.state === "decision_recorded" && item.decision === "approve").length;
  if (active.some(item=>["awaiting_clarification","recused"].includes(item.state))) return "A reviewer needs clarification or a replacement. Open Reviewer actions below to resolve it.";
  return `${approved} of ${cycle.reviewerTarget} ${stage === "CRECOM" ? "CRECOM confirmations" : "BOD confirmation"} approved. Waiting for the assigned reviewers to respond in their own portals.`;
}
