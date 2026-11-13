import type {CommitteeAssignment,CommitteeConfirmation} from "./committee";

export function crecomConfirmationProgress(rows:CommitteeConfirmation[]|undefined){
 const approvals=rows?.filter(row=>row.decision==="approve")??[];
 const members=approvals.filter(row=>row.signatoryRole==="crecom_member");
 const complete=rows?.length===3&&approvals.length===3&&members.length===2&&new Set(members.map(row=>row.committeeMemberNumber)).size===2
  &&members.every(row=>row.committeeMemberNumber===1||row.committeeMemberNumber===2)&&approvals.filter(row=>row.signatoryRole==="crecom_chairperson").length===1;
 return {approved:approvals.length,complete:!!complete};
}

export function committeeDecisionLabel(row:Pick<CommitteeAssignment,"state"|"myDecision">){
 if(row.myDecision==="approve")return "Approved";
 if(row.myDecision==="reject")return "Rejected";
 return ({assigned:"Pending Review",decision_recorded:"Decision Submitted",awaiting_clarification:"Clarification Requested",recused:"Unable to Review",reassigned:"Reassigned",cancelled:"Closed"} as Record<string,string>)[row.state]??"Pending Review";
}
export function committeeApprovalLabel(row:CommitteeAssignment){
 const progress=row.approvalProgress;
 if(!progress)return "Approval progress unavailable";
 if(progress.rejected)return "Rejected · staff action needed";
 return `${progress.approved} of ${progress.total} approved`;
}
