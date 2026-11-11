import type {WorkflowPolicy} from "../../src/lib/applicationWorkflow";
import {emptyWorkflowPolicy} from "../../src/lib/applicationWorkflow";
const state=window as unknown as Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const uuid=(prefix:string,n:number)=>prefix+"0000000-0000-0000-0000-"+String(n).padStart(12,"0");
const reviewer=(n:number)=>({id:uuid("8",n),name:"Synthetic Reviewer "+n,role:"crecom_member",committeeSeat:n>=3?"chairperson":"member",committeeMemberNumber:n<=2?n:null,title:"CRECOM"});
const assignment=(n:number)=>({id:uuid("b",n),membershipId:uuid("8",n),name:"Synthetic Reviewer "+n,signatoryRole:n>=3?"crecom_chairperson":"crecom_member",committeeMemberNumber:n<=2?n:null,state:"assigned",revision:1,decision:null,reason:null,decidedAt:null});
export function syntheticReviewPolicy():WorkflowPolicy{
 return {id:uuid("9",1),version:1,status:"draft",name:"SYNTHETIC TEST POLICY",createdBy:"Synthetic coordinator",createdAt:"2026-11-11",authorizationReference:"SYNTHETIC TEST ONLY",
 config:{...emptyWorkflowPolicy,reviewerCount:3,crecomAuthority:"recommendation",bodMode:state.reviewBodPending?"pending":"required",quorumRule:"All 3 approve",finalAuthority:"Super Admin",borrowerConsentRequired:false,coMakerConsentRequired:false,witnessCount:0,allowedConsentMethods:["paper"],requirementsReference:"SYNTHETIC TEST ONLY"}};
}
const execution={crecomApprovals:3,bodReviewers:1,bodApprovals:1,bodAuthority:"recommendation",signatoryLayout:"manual_form_v1",finalMode:"super_admin",allowOverride:false,allResponses:true,ruleReference:"SYNTHETIC TEST ONLY"};
function initialize(){
 state.reviewCalls??=[];state.reviewReplies??={};
 state.reviewAdmin??={applicationId:"APP-TEST",revision:1,stateHash:"a".repeat(64),verificationStage:state.reviewFinalReady?"ready_for_final":"ready_for_committee",verified:true,blockers:[],
  policyId:uuid("9",1),policyName:"SYNTHETIC TEST POLICY",policyConfig:syntheticReviewPolicy().config,rules:state.reviewNeedsPolicy?null:execution,candidates:[1,2,3,4].map(reviewer),events:[],finalDecision:null,canManage:true,canFinalize:!!state.reviewFinalReady,
  cycles:state.reviewFinalReady?[{id:uuid("a",1),stage:"CRECOM",cycle:1,packetVersion:1,status:"completed",outcome:state.reviewPanelRejected?"reject":"approve",requiredApprovals:3,reviewerTarget:3,bodRequired:true,routingReason:"",createdAt:"2026-11-11",assignments:[1,2,3].map(n=>({...assignment(n),state:"decision_recorded",confirmationReference:uuid("d",n),confirmationText:"Synthetic recorded confirmation for packet version 1.",confirmationMethod:"account_password",decidedAt:"2026-11-11T02:00:00Z",decision:state.reviewPanelRejected&&n===3?"reject":"approve"}))}]:[]};
 if(state.reviewFinalReady&&!state.reviewAdmin.cycles.some((item:{stage:string})=>item.stage==="BOD"))state.reviewAdmin.cycles.push({id:uuid("a",2),stage:"BOD",cycle:1,packetVersion:1,status:"completed",outcome:"approve",requiredApprovals:1,reviewerTarget:1,bodRequired:true,routingReason:"Required for every loan",createdAt:"2026-11-11",assignments:[{...assignment(5),signatoryRole:"bod_chairperson",state:"decision_recorded",decision:"approve",confirmationReference:uuid("d",5),confirmationText:"Synthetic BOD chairperson confirmation for packet version 1.",confirmationMethod:"account_password",decidedAt:"2026-11-11T02:30:00Z"}]});
 state.reviewPacket??={assignment:{id:uuid("b",1),applicationId:"APP-TEST",applicant:"Synthetic Borrower",memberNumber:"TEST-4",loanType:"Business",amount:1000,stage:"CRECOM",signatoryRole:"crecom_member",cycle:1,packetVersion:1,assignedAt:"2026-11-11T00:00:00Z",dueAt:null,state:"assigned",responded:0,assigned:3},
  summary:{purpose:"Synthetic purpose",tenureMonths:12},findings:"Verified synthetic findings",consentSummary:"Synthetic consent summary",documents:[],appRevision:1,stateHash:"a".repeat(64),stale:!!state.reviewStale,canRespond:!state.reviewStale,requiredApprovals:3,reviewerTarget:3,myDecision:null,thread:[],cycleStatus:"open",outcome:null};
}
export function useCommitteeAuth(){return {prototype:true,role:"crecom_member",access:{name:"Synthetic Reviewer 1"},user:{id:uuid("1",1),email:"reviewer@example.invalid",user_metadata:{}},refresh:async()=>{},signOut:async()=>{}};}
export async function committeeRequest(){initialize();return structuredClone(state.reviewPacket);}
export async function reviewRequest(_query="",init:RequestInit={}){
 void _query;
 initialize();await new Promise(resolve=>setTimeout(resolve,80));
 if(init.method!=="POST")return structuredClone(state.reviewAdmin);
 const body=JSON.parse(String(init.body));state.reviewCalls.push(body);
 if(state.reviewFailure)throw new Error("Synthetic review request failed. Retry this request.");
 if(state.reviewReplies[body.requestId])return state.reviewReplies[body.requestId];
 const admin=state.reviewAdmin,packet=state.reviewPacket;
 if(body.operation==="forward"){
  admin.cycles=[{id:uuid("a",1),stage:"CRECOM",cycle:1,packetVersion:1,status:"open",outcome:null,requiredApprovals:3,reviewerTarget:3,bodRequired:body.payload.bodRequired,routingReason:body.payload.routingReason,createdAt:"2026-11-11",assignments:[1,2,3].map(assignment)}];
  admin.verificationStage="crecom_review";admin.revision++;
 }
 if(["approve","reject"].includes(body.operation)){
  packet.myDecision={id:uuid("d",1),decision:body.operation,reason:body.payload.reason,createdAt:"2026-11-11T02:00:00Z",reviewer:"Synthetic Reviewer 1",confirmation:"I record "+body.operation+" as CRECOM Member for APP-TEST, packet version 1.",signatoryRole:"crecom_member",method:"account_password"};packet.canRespond=false;packet.assignment.state="decision_recorded";
 }
 if(body.operation==="clarify"){packet.canRespond=false;packet.assignment.state="awaiting_clarification";packet.thread=[{id:uuid("e",1),action:"clarify",actor:"Synthetic Reviewer 1",reason:body.payload.reason,createdAt:"2026-11-11T02:00:00Z"}];}
 if(body.operation==="recuse"){packet.canRespond=false;packet.assignment.state="recused";}
 if(body.operation==="finalize"){admin.finalDecision={decision:body.payload.decision,mode:"super_admin",reason:body.payload.reason,actor:"Synthetic coordinator",createdAt:"2026-11-11T03:00:00Z"};admin.canFinalize=false;admin.canManage=false;admin.verificationStage="final_"+(body.payload.decision==="approve"?"approved":"rejected");}
 const result={success:true};state.reviewReplies[body.requestId]=result;return result;
}
