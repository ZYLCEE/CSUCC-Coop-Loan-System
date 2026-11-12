import type { DocumentKind } from "./documentWorkspace";

export const workflowStages = ["not_started","needs_verification","returned_for_requirements","ready_for_committee","crecom_review","bod_review","review_attention","review_stale","ready_for_bod","ready_for_final","final_approved","final_rejected"] as const;
export type WorkflowStage = typeof workflowStages[number];
export const workflowStageLabels:Record<WorkflowStage,string> = {
  not_started:"Verification not started",needs_verification:"Needs verification",
  returned_for_requirements:"Returned for requirements",ready_for_committee:"Ready to forward",
  crecom_review:"CRECOM review",bod_review:"BOD review",review_attention:"Review needs attention",review_stale:"Packet needs re-verification",
  ready_for_bod:"Ready for BOD",ready_for_final:"Awaiting final authority",final_approved:"Final approval recorded",final_rejected:"Final rejection recorded",
};
export type VerificationChecks={identity:boolean;eligibility:boolean;terms:boolean};
export const verificationCheckLabels:Record<keyof VerificationChecks,string>={
  identity:"Member identity and application details checked",
  eligibility:"Membership eligibility and affordability checked",
  terms:"Loan amount, term and payment projection checked",
};
export function displayVerificationBlocker(message:string):string{
  return message==="Required witness attestations have not been recorded for this packet."
    ?"Required witness names have not been recorded for this packet."
    :message;
}
export type WorkflowSummary={applicationId:string;stage:WorkflowStage;revision:number;stale:boolean;enrolled:boolean};
export type VerificationDocument={id:string;kind:DocumentKind;versionId:string|null;version:number;name:string;reviewStatus:string;reviewId:string|null};
export type ConsentEvidenceRecord={id:string;kind:"borrower"|"co_maker"|"witness";subject_reference:string;subject_name?:string;method:string;occurred_at:string;evidence_reference:string;status?:"recorded"|"approved"|"named";source?:string;relationship?:string;borrower_name?:string;amount?:number;tenure_months?:number;loan_type?:string;terms_accepted?:boolean|null;information_certified?:boolean|null;terms_version?:string|null;terms_text?:string|null};
export type WorkflowPolicyConfig={
  reviewerCount:number|null;quorumRule:string;crecomAuthority:"pending"|"recommendation"|"binding_decision";
  bodMode:"pending"|"none"|"conditional"|"required";bodCriteria:string;finalAuthority:string;
  borrowerConsentRequired:boolean|null;coMakerConsentRequired:boolean|null;witnessCount:number|null;
  allowedConsentMethods:("otp"|"paper")[];requirementsReference:string;
};
export const emptyWorkflowPolicy:WorkflowPolicyConfig={
  reviewerCount:null,quorumRule:"",crecomAuthority:"pending",bodMode:"pending",bodCriteria:"",finalAuthority:"",
  borrowerConsentRequired:null,coMakerConsentRequired:null,witnessCount:null,allowedConsentMethods:[],requirementsReference:"",
};
export type WorkflowPolicy={
  id:string;version:number;name:string;status:"draft"|"approved"|"retired";config:WorkflowPolicyConfig;
  authorizationReference:string;createdAt:string;createdBy:string;
  executionRules?:import("./committeeReview").PolicyExecutionRules|null;
};
export type WorkflowEvent={id:string;action:string;actor:string;createdAt:string;details:Record<string,unknown>};
export type ApplicationVerification={
  applicationId:string;applicationUuid:string;memberName:string;memberNumber:string;loanType:string;loanStatus:string;
  stage:WorkflowStage;revision:number;enrolled:boolean;stale:boolean;stateHash:string;packetHash:string;
  checks:VerificationChecks;notes:string;documents:VerificationDocument[];requiredKinds:DocumentKind[];
  policy:WorkflowPolicy|null;blockers:string[];evidence:{borrower:number;coMaker:number;witnesses:number};
  history:WorkflowEvent[];lastReturned:{reason:string;category:string;createdAt:string}|null;
  loanSummary?:{amount:number;months:number;monthlyPayment:number;purpose:string};returnEmailStatus?:string|null;
  permissions:{verify:boolean;return:boolean;policyManage:boolean};canEnroll:boolean;
};
export type WorkflowPolicyList={policies:WorkflowPolicy[];canManage:boolean};
export function validateVerificationDraft(value:unknown):{checks:VerificationChecks;notes:string}{
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Complete the verification draft.");
  const payload=value as Record<string,unknown>,checks=payload.checks as Record<string,unknown>|undefined;
  if(!checks || typeof checks!=="object" || Array.isArray(checks) ||
    Object.keys(checks).some(key=>!["identity","eligibility","terms"].includes(key)) ||
    ["identity","eligibility","terms"].some(key=>typeof checks[key]!=="boolean"))throw new Error("Choose valid verification checks.");
  if(typeof payload.notes!=="string" || payload.notes.length>2000)throw new Error("Internal notes must be at most 2,000 characters.");
  return {checks:checks as VerificationChecks,notes:payload.notes.trim()};
}
export function validateWorkflowPolicy(value:unknown):{name:string;config:WorkflowPolicyConfig;authorizationReference:string}{
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Complete the policy draft.");
  const payload=value as Record<string,unknown>,config=payload.config as WorkflowPolicyConfig|undefined;
  if(typeof payload.name!=="string" || !payload.name.trim() || payload.name.trim().length>160)throw new Error("Enter a policy name of up to 160 characters.");
  if(!config || typeof config!=="object" || Array.isArray(config))throw new Error("Complete the policy draft.");
  for(const key of ["reviewerCount","witnessCount"] as const){
    const count=config[key];
    if(count!==null && (!Number.isInteger(count) || count<(key==="reviewerCount"?1:0) || count>100))throw new Error("Enter valid reviewer and witness counts, or leave them pending.");
  }
  if(!["pending","recommendation","binding_decision"].includes(config.crecomAuthority) ||
    !["pending","none","conditional","required"].includes(config.bodMode) ||
    [config.borrowerConsentRequired,config.coMakerConsentRequired].some(value=>value!==null && typeof value!=="boolean"))throw new Error("Choose valid policy options.");
  if(!Array.isArray(config.allowedConsentMethods) || new Set(config.allowedConsentMethods).size!==config.allowedConsentMethods.length ||
    config.allowedConsentMethods.some(method=>!["otp","paper"].includes(method)))throw new Error("Choose valid consent evidence methods.");
  for(const key of ["quorumRule","bodCriteria","finalAuthority","requirementsReference"] as const){
    if(typeof config[key]!=="string" || config[key].length>2000)throw new Error("Policy descriptions must be at most 2,000 characters.");
  }
  if(typeof payload.authorizationReference!=="string" || payload.authorizationReference.length>500)throw new Error("The authorization reference must be at most 500 characters.");
  return {name:payload.name.trim(),config,authorizationReference:payload.authorizationReference.trim()};
}
