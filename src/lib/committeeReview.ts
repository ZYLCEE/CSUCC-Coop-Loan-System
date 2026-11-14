import type {CommitteeRole,CommitteeSeat,CommitteePacket,SignatoryRole} from "./committee";
export type PolicyExecutionRules={
 crecomApprovals:number|null;bodReviewers:number|null;bodApprovals:number|null;
 finalMode:"pending"|"super_admin"|"authorized_admin";allowOverride:boolean|null;
 bodAuthority:"pending"|"recommendation"|"binding_decision";
 allResponses:boolean;ruleReference:string;
 signatoryLayout?:"manual_form_v1";
};
export const emptyExecutionRules:PolicyExecutionRules={crecomApprovals:null,bodReviewers:null,bodApprovals:null,finalMode:"pending",allowOverride:null,bodAuthority:"pending",allResponses:false,ruleReference:""};
export type ReviewCandidate={id:string;name:string;role:CommitteeRole;committeeSeat:CommitteeSeat;committeeMemberNumber?:1|2|null;title:string};
export type ReviewAssignment={id:string;membershipId:string;name:string;signatoryRole?:SignatoryRole|null;committeeMemberNumber?:1|2|null;state:string;revision:number;decision:string|null;reason:string|null;decidedAt:string|null;confirmationReference?:string|null;confirmationText?:string|null;confirmationMethod?:string|null};
export type ReviewCycle={id:string;stage:"CRECOM"|"BOD";cycle:number;packetVersion:number;status:string;outcome:"approve"|"reject"|null;requiredApprovals:number;reviewerTarget:number;bodRequired:boolean;routingReason:string;createdAt:string;assignments:ReviewAssignment[]};
export type ReviewEvent={id:string;action:string;actor:string;reason:string;createdAt:string;assignmentId:string|null};
export type AdminReviewState={
 applicationSummary?:{applicationId?:string;applicant?:string;memberNumber?:string;loanType?:string;amount?:number;tenureMonths?:number;monthlyPayment?:number;purpose?:string}|null;
 bodHandoffVersion?:number;
 applicationId:string;revision:number;stateHash:string;verificationStage:string;verified:boolean;blockers:string[];
 policyId:string|null;policyName:string|null;policyConfig:{reviewerCount:number;bodMode:string;crecomAuthority:string}|null;
 rules:PolicyExecutionRules|null;candidates:ReviewCandidate[];cycles:ReviewCycle[];events:ReviewEvent[];
 finalDecision:{decision:"approve"|"reject";mode:string;reason:string;createdAt:string;actor:string}|null;canManage:boolean;canFinalize:boolean;
};
export type ReviewerPacket=CommitteePacket&{
 crecomConfirmations?:{reviewer:string;signatoryRole:SignatoryRole;committeeMemberNumber?:1|2|null;decision:string;createdAt:string}[];
 appRevision:number;stateHash:string;stale:boolean;canRespond:boolean;requiredApprovals:number;reviewerTarget:number;
 myDecision:{id:string;decision:string;reason:string|null;createdAt:string;reviewer:string;confirmation:string;method:string;signatoryRole?:SignatoryRole|null;committeeMemberNumber?:1|2|null}|null;thread:ReviewEvent[];cycleStatus:string;outcome:string|null;
};
export function validateExecutionRules(value:unknown):PolicyExecutionRules{
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Complete the committee voting rules.");
 const row=value as PolicyExecutionRules;
 for(const key of ["crecomApprovals","bodReviewers","bodApprovals"] as const)if(row[key]!==null&&(!Number.isInteger(row[key])||Number(row[key])<1||Number(row[key])>100))throw new Error("Enter valid reviewer and approval counts.");
 if(!["super_admin","authorized_admin"].includes(row.finalMode)||row.allowOverride!==false||!["pending","recommendation","binding_decision"].includes(row.bodAuthority))throw new Error("Authorized staff records the final decision; a failed committee approval cannot be overridden.");
 if(row.allResponses!==true)throw new Error("Confirm that all assigned reviewers must respond before a panel outcome is recorded.");
 if(typeof row.ruleReference!=="string"||!row.ruleReference.trim()||row.ruleReference.length>500)throw new Error("Enter the authorization reference for these voting rules.");
 if(row.crecomApprovals!==3)throw new Error("All 3 CRECOM reviewers must approve.");
 if(row.signatoryLayout!=="manual_form_v1"||row.bodReviewers!==1||row.bodApprovals!==1||row.bodAuthority!=="recommendation")throw new Error("Every loan requires two CRECOM members, one CRECOM chairperson and one BOD chairperson before the authorized staff final decision.");
 return {...row,ruleReference:row.ruleReference.trim()};
}
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateReviewMutation(value:unknown){
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Choose a valid review action.");
 const row=value as Record<string,unknown>;
 if(typeof row.applicationId!=="string"||!row.applicationId.trim()||row.applicationId.length>100||!uuid(row.requestId)||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||typeof row.stateHash!=="string"||!/^[0-9a-f]{64}$/.test(row.stateHash))throw new Error("Refresh the application before recording a review action.");
 const payload=row.payload as Record<string,unknown>;
 if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("Complete the review details.");
 const action=String(row.operation),reason=typeof payload.reason==="string"?payload.reason.trim():"";
 if(reason.length>2000)throw new Error("Enter a reason of up to 2,000 characters.");
 let clean:Record<string,unknown>;
 if(action==="forward"||action==="forward_bod"){
  if(!Array.isArray(payload.reviewers)||!payload.reviewers.length||payload.reviewers.length>100||payload.reviewers.some(id=>!uuid(id))||new Set(payload.reviewers).size!==payload.reviewers.length)throw new Error("Choose distinct eligible reviewers.");
  if(payload.dueAt!==null&&(typeof payload.dueAt!=="string"||!Number.isFinite(Date.parse(payload.dueAt))||Date.parse(payload.dueAt)<=Date.now()))throw new Error("Choose a future review deadline or leave it empty.");
  if(action==="forward"&&(typeof payload.bodRequired!=="boolean"||typeof payload.routingReason!=="string"||payload.routingReason.length>2000))throw new Error("Confirm whether this application requires BOD review.");
  if(action==="forward"&&payload.bodRequired!==true)throw new Error("BOD chairperson review is required for every loan.");
  clean={reviewers:payload.reviewers,dueAt:payload.dueAt,...(action==="forward"?{bodRequired:payload.bodRequired,routingReason:String(payload.routingReason).trim()}:{})};
 }else if(["approve","reject","clarify","recuse","reply","reassign"].includes(action)){
  if(!uuid(payload.assignmentId))throw new Error("Choose an assigned reviewer.");
  if(action!=="approve"&&!reason)throw new Error("Enter a reason or clarification.");
  if(action==="reassign"&&!uuid(payload.membershipId))throw new Error("Choose an eligible replacement reviewer.");
  if((action==="approve"||action==="reject")&&payload.confirmed!==true)throw new Error("Confirm your decision for this exact application packet.");
  clean={assignmentId:payload.assignmentId,reason,...(action==="reassign"?{membershipId:payload.membershipId}:{}),...(["approve","reject"].includes(action)?{confirmed:true}:{})};
 }else if(action==="reopen"){if(!reason)throw new Error("Enter the reason for returning this case to verification.");clean={reason};}
 else if(action==="finalize"){
  if(!["approve","reject"].includes(String(payload.decision))||(payload.decision==="reject"&&!reason))throw new Error("Choose the final decision and enter a rejection reason.");clean={decision:payload.decision,reason:payload.decision==="approve"?(reason||"Approved"):reason};
 }else throw new Error("Choose a supported review action.");
 return {operation:action,applicationId:row.applicationId,requestId:row.requestId,revision:Number(row.revision),stateHash:row.stateHash,payload:clean};
}
