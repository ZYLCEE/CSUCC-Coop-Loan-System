import type {AdminReviewState,ReviewCycle,ReviewCandidate} from "../../src/lib/committeeReview";
import type {ApplicationVerification} from "../../src/lib/applicationWorkflow";
import {syntheticVerification} from "./verification-transport";

type State=Window & {verificationData?:ApplicationVerification;reviewAdmin?:AdminReviewState;reviewCalls?:Record<string,unknown>[];reviewReplies?:Record<string,unknown>;reviewFailure?:boolean};
const state=window as State;
const id=(n:number)=>"a0000000-0000-0000-0000-"+String(n).padStart(12,"0");
const candidates:ReviewCandidate[]=[1,2,3,4].map(n=>({id:id(n),name:n===4?"Synthetic BOD Chairperson":"Synthetic CRECOM "+n,role:n===4?"bod_member" as const:"crecom_member" as const,committeeSeat:n>=3?"chairperson" as const:"member" as const,committeeMemberNumber:n===1?1:n===2?2:null,title:""}));
export async function reviewRequest(_query="",init:RequestInit={},endpoint?:string) {
  void _query;
  const app=state.verificationData??=syntheticVerification();
  const data:AdminReviewState=state.reviewAdmin??={applicationId:app.applicationId,revision:app.revision,stateHash:app.stateHash,verificationStage:app.stage,
    verified:false,blockers:app.blockers,policyId:null,policyName:null,policyConfig:null,rules:null,candidates,cycles:[],events:[],finalDecision:null,canManage:true,canFinalize:false};
  if(app.stage==="ready_for_committee"&&!data.cycles.some(cycle=>cycle.stage==="CRECOM"&&cycle.status!=="superseded")){
    const reviewers=candidates.filter(candidate=>candidate.role==="crecom_member");
    data.cycles.unshift({id:crypto.randomUUID(),stage:"CRECOM",cycle:1,packetVersion:1,status:"open",outcome:null,requiredApprovals:3,reviewerTarget:3,bodRequired:true,routingReason:"Project workflow specification",createdAt:new Date().toISOString(),assignments:reviewers.map(candidate=>({id:crypto.randomUUID(),membershipId:candidate.id,name:candidate.name,signatoryRole:candidate.committeeSeat==="chairperson"?"crecom_chairperson":"crecom_member",committeeMemberNumber:candidate.committeeMemberNumber??null,state:"assigned",revision:1,decision:null,reason:null,decidedAt:null}))});
  }
  data.verificationStage=app.stage;data.revision=app.revision;data.verified=app.enrolled&&!app.stale&&!app.blockers.length&&!["needs_verification","not_started","returned_for_requirements"].includes(app.stage);
  data.blockers=app.blockers;data.policyId=app.policy?.id??null;data.policyName=app.policy?.name??null;
  data.policyConfig=app.policy?{reviewerCount:3,bodMode:"required",crecomAuthority:"recommendation"}:null;
  data.rules=app.policy?{crecomApprovals:3,bodReviewers:1,bodApprovals:1,bodAuthority:"recommendation",signatoryLayout:"manual_form_v1",finalMode:"super_admin",allowOverride:false,allResponses:true,ruleReference:"SYNTHETIC"}:null;
  data.canFinalize=app.stage==="ready_for_final";
  await new Promise(resolve=>setTimeout(resolve,40));
  if(init.method!=="POST")return structuredClone(data);
  const body=JSON.parse(String(init.body));(state.reviewCalls??=[]).push(body);
  if(state.reviewFailure)throw new Error("Synthetic review request failed. Retry.");
  state.reviewReplies??={};if(state.reviewReplies[body.requestId])return state.reviewReplies[body.requestId];
  if(endpoint==="/api/admin/loan-release"){
    if(!body.password)throw new Error("Enter your account password.");
    app.loanStatus="released";
    return state.reviewReplies[body.requestId]={id:app.applicationUuid,application_id:app.applicationId,status:"released",date_released:body.date,release_reference:body.reference,amount:1000,interest_rate_at_release:2,processing_fee_amount_at_release:10,service_fee_amount_at_release:5,net_proceeds:985};
  }
  if(body.operation==="forward"||body.operation==="forward_bod"){
    const stage=body.operation==="forward"?"CRECOM":"BOD";
    const selected=candidates.filter(candidate=>body.payload.reviewers.includes(candidate.id));
    const cycle:ReviewCycle={id:crypto.randomUUID(),stage,cycle:1,packetVersion:1,status:"open",outcome:null,requiredApprovals:selected.length,reviewerTarget:selected.length,bodRequired:true,routingReason:"Required",createdAt:new Date().toISOString(),assignments:selected.map(candidate=>({id:crypto.randomUUID(),membershipId:candidate.id,name:candidate.name,signatoryRole:candidate.role==="bod_member"?"bod_chairperson":candidate.committeeSeat==="chairperson"?"crecom_chairperson":"crecom_member",state:"assigned",revision:1,decision:null,reason:null,decidedAt:null}))};
    data.cycles.unshift(cycle);app.stage=stage==="CRECOM"?"crecom_review":"bod_review";app.canEnroll=false;
  }
  if(body.operation==="finalize"){
    data.finalDecision={decision:body.payload.decision,mode:"super_admin",reason:body.payload.reason,actor:"Synthetic Super Admin",createdAt:new Date().toISOString()};
    data.canFinalize=false;data.canManage=false;app.stage=body.payload.decision==="approve"?"final_approved":"final_rejected";app.canEnroll=false;
    app.loanStatus=body.payload.decision==="approve"?"approved":"rejected";
  }
  if(body.operation==="reopen"){
    data.cycles.forEach(cycle=>cycle.status="superseded");app.stale=false;app.stage="needs_verification";app.canEnroll=true;
  }
  app.revision++;data.events.unshift({id:crypto.randomUUID(),action:body.operation,actor:"Synthetic coordinator",createdAt:new Date().toISOString(),reason:body.payload.reason??"",assignmentId:null});
  return state.reviewReplies[body.requestId]={success:true};
}
