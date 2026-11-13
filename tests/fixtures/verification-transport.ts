import type {ApplicationVerification,WorkflowPolicy} from "../../src/lib/applicationWorkflow";
type WindowState=Window & {verificationData?:ApplicationVerification;verificationPolicies?:WorkflowPolicy[];verificationCalls?:Record<string,unknown>[];verificationFailure?:boolean;verificationReplies?:Record<string,unknown>;verificationDelay?:number;verificationScenario?:string;testRole?:string;testPrivileges?:string[];};
const initial:ApplicationVerification={
 applicationId:"APP-TEST",applicationUuid:"30000000-0000-0000-0000-000000000001",memberName:"Synthetic Maria Cruz",memberNumber:"CSUCC-TEST-1",loanType:"Business",loanStatus:"pending",
 stage:"not_started",revision:0,enrolled:false,stale:false,stateHash:"a".repeat(64),packetHash:"b".repeat(64),
 checks:{identity:false,eligibility:false,terms:false},notes:"",
 documents:[{id:"40000000-0000-0000-0000-000000000001",kind:"validId",versionId:null,version:1,name:"id.pdf",reviewStatus:"verified",reviewId:"r1"},{id:"40000000-0000-0000-0000-000000000002",kind:"payslip",versionId:null,version:1,name:"payslip.pdf",reviewStatus:"verified",reviewId:"r2"}],
 requiredKinds:["validId","payslip"],policy:null,blockers:["CSUCC-approved verification and consent requirements have not been configured.","Borrower consent evidence is not available.","Co-maker consent evidence is not available.","Witness requirements are pending CSUCC configuration."],
 evidence:{borrower:0,coMaker:0,witnesses:0},history:[],lastReturned:null,permissions:{verify:true,return:true,policyManage:true},canEnroll:true,
 loanSummary:{amount:1000,months:12,monthlyPayment:100,purpose:"Synthetic business loan"},
};
export const syntheticVerification=()=>structuredClone(initial);
const readyVerification=():ApplicationVerification=>({
 ...structuredClone(initial),
 policy:{id:"50000000-0000-0000-0000-000000000001",version:1,name:"Synthetic project workflow",status:"approved",authorizationReference:"PROJECT_WORKFLOW_POLICY.md",createdAt:"2026-11-13T00:00:00Z",createdBy:"Synthetic coordinator",config:{reviewerCount:3,quorumRule:"All assigned reviewers must respond.",crecomAuthority:"recommendation",bodMode:"required",bodCriteria:"Every application.",finalAuthority:"super_admin",borrowerConsentRequired:true,coMakerConsentRequired:true,witnessCount:2,allowedConsentMethods:["otp","paper"],requirementsReference:"PROJECT_WORKFLOW_POLICY.md"}},
 blockers:[],
 evidence:{borrower:1,coMaker:1,witnesses:2},
});
export async function workflowRequest(query="",options?:RequestInit){
 const state=window as WindowState;
 if(!state.verificationData){
  if(state.verificationScenario==="verification-ready")state.verificationData=readyVerification();
  else if(state.verificationScenario==="review-stage"||state.verificationScenario==="stale-review"){
   state.verificationData={...readyVerification(),enrolled:true,stage:state.verificationScenario==="stale-review"?"ready_for_committee":"crecom_review",stale:state.verificationScenario==="stale-review"};
  }else state.verificationData=structuredClone(initial);
 }
 state.verificationPolicies??=[];
 const data=state.verificationData,params=new URLSearchParams(query);
 if(!options){
   if(params.get("operation")==="evidence")return {records:[...Array.from({length:data.evidence.borrower},(_,i)=>({id:"borrower-"+i,kind:"borrower",subject_reference:data.memberName,method:"otp",occurred_at:new Date().toISOString(),evidence_reference:"SYNTHETIC-BORROWER-"+i,terms_accepted:true,information_certified:true,terms_version:"synthetic-v1",terms_text:"SYNTHETIC exact accepted agreement text."})),...Array.from({length:data.evidence.coMaker},(_,i)=>({id:"co-maker-"+i,kind:"co_maker",subject_reference:"Synthetic co-maker",method:"paper",occurred_at:new Date().toISOString(),evidence_reference:"SYNTHETIC-CO-MAKER-"+i,status:"approved"})),...Array.from({length:data.evidence.witnesses},(_,i)=>({id:"witness-"+i,kind:"witness",subject_reference:"Synthetic witness "+(i+1),method:"paper",occurred_at:new Date().toISOString(),evidence_reference:"SYNTHETIC-WITNESS-"+i}))]};
   if(params.get("operation")==="summary")return data.enrolled?[{applicationId:data.applicationId,stage:data.stage,revision:data.revision,enrolled:true,stale:data.stale}]:[];
   if(params.get("operation")==="policies")return {policies:structuredClone(state.verificationPolicies),canManage:true};
   return structuredClone(data);
 }
 const body=JSON.parse(String(options.body));state.verificationCalls??=[];state.verificationCalls.push(body);
 await new Promise(resolve=>setTimeout(resolve,state.verificationDelay??100));
 if(state.verificationFailure)throw new Error("Synthetic verification service failed. Retry.");
 state.verificationReplies??={};
 if(state.verificationReplies[body.requestId])return state.verificationReplies[body.requestId];
 if(body.operation==="policy_draft"){
   state.verificationPolicies.unshift({id:crypto.randomUUID(),version:state.verificationPolicies.length+1,name:body.payload.name,status:"draft",config:body.payload.config,authorizationReference:body.payload.authorizationReference,createdAt:new Date().toISOString(),createdBy:"Synthetic coordinator"});
 }else{
   data.revision++;data.enrolled=true;
   if(body.operation==="start")data.stage="needs_verification";
   if(body.operation==="save_draft"){data.checks=body.payload.checks;data.notes=body.payload.notes;data.stage="needs_verification";}
   if(body.operation==="return"){if(!body.password)throw new Error("Enter your account password.");data.loanStatus="returned";data.canEnroll=false;data.stage="returned_for_requirements";data.lastReturned={...body.payload,createdAt:new Date().toISOString()};}
   if(body.operation==="verify_and_forward"){data.checks=body.payload.checks;data.notes="";data.blockers=[];data.stage="ready_for_committee";data.canEnroll=false;}
   if(body.operation==="recommend_rejection"&&!body.password)throw new Error("Enter your account password.");
   if(body.operation==="reject_application"){if(!body.password)throw new Error("Enter your account password.");data.loanStatus="rejected";data.canEnroll=false;data.stage="final_rejected";}
   data.history.unshift({id:crypto.randomUUID(),action:body.operation,actor:"Synthetic coordinator",createdAt:new Date().toISOString(),details:body.payload});
 }
 const result={revision:data.revision};state.verificationReplies[body.requestId]=result;return result;
}
