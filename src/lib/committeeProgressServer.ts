import type {SupabaseClient} from "@supabase/supabase-js";
import type {CommitteeAssignment,CommitteeApproval,CommitteeConfirmation,SignatoryRole} from "./committee";
import {checkCommitteeError,CommitteeError} from "./committeeServer";

// Only call after the caller's JWT-scoped workspace/assigned-application RPC admits
// these assignment IDs. Other reviewers' private reasons are never selected.
export async function withCommitteeApprovalProgress(service:SupabaseClient,assignments:CommitteeAssignment[]):Promise<CommitteeAssignment[]>{
 if(!assignments.length)return assignments;
 const output=new Map<string,CommitteeAssignment>();
 for(let start=0;start<assignments.length;start+=100){
  const batch=assignments.slice(start,start+100),ids=batch.map(row=>row.id);
  const own=await service.from("review_assignments").select("id,review_cycle_id").in("id",ids);checkCommitteeError(own.error);
  const cycles=[...new Set<string>((own.data??[]).map(row=>row.review_cycle_id))];
  if(own.data?.length!==ids.length)throw new CommitteeError("An assigned application changed. Refresh the list.",409);
  const reviewers=await service.from("review_assignments").select("id,review_cycle_id,signatory_role,member_number,state").in("review_cycle_id",cycles).in("state",["assigned","decision_recorded","awaiting_clarification","recused"]);checkCommitteeError(reviewers.error);
  const reviewerIds=(reviewers.data??[]).map(row=>row.id);
  const decisions=reviewerIds.length?await service.from("individual_review_decisions").select("assignment_id,decision,reviewer_name,created_at").in("assignment_id",reviewerIds):{data:[],error:null};checkCommitteeError(decisions.error);
  for(const assignment of batch){
   const cycle=own.data!.find(row=>row.id===assignment.id)!.review_cycle_id;
   const panel:CommitteeApproval[]=(reviewers.data??[]).filter(row=>row.review_cycle_id===cycle).map(row=>{
    const decision=row.state==="decision_recorded"?decisions.data?.find(item=>item.assignment_id===row.id):null;
    return {id:row.id,position:row.signatory_role as SignatoryRole|null,memberNumber:row.member_number as 1|2|null,reviewer:decision?.reviewer_name??null,state:row.state,decision:decision?.decision??null,decidedAt:decision?.created_at??null};
   });
   output.set(assignment.id,{...assignment,myDecision:panel.find(row=>row.id===assignment.id)?.decision??null,approvalProgress:{approved:panel.filter(row=>row.decision==="approve").length,rejected:panel.filter(row=>row.decision==="reject").length,total:panel.length,reviewers:panel}});
  }
  const bod=batch.filter(row=>row.stage==="BOD");
  if(bod.length){
   const confirmations=await readBodCrecomConfirmations(service,bod.map(row=>({assignmentId:row.id,cycleId:own.data!.find(item=>item.id===row.id)!.review_cycle_id})));
   for(const row of bod)output.set(row.id,{...output.get(row.id)!,crecomConfirmations:confirmations.get(row.id)??[]});
  }
 }
 return assignments.map(row=>output.get(row.id)!);
}

// Compatibility with the existing database RPC: enrich only BOD assignments
// already admitted by that RPC. Match the original cycle, policy and snapshot;
// never substitute the most recent approvals from another review version.
async function readBodCrecomConfirmations(service:SupabaseClient,admitted:{assignmentId:string;cycleId:string}[]){
 const fields="id,application_id,cycle_no,packet_version,stage,status,outcome,policy_id,required_approvals,reviewer_target,snapshot_hash:packet_snapshot->>stateHash";
 const bod=await service.from("application_review_cycles").select(fields).in("id",admitted.map(row=>row.cycleId)).in("stage",["BOD"]).in("status",["open","completed"]);checkCommitteeError(bod.error);
 const output=new Map<string,CommitteeConfirmation[]>();
 if(!bod.data?.length)return output;
 const parents=await service.from("application_review_cycles").select(fields).in("application_id",[...new Set(bod.data.map(row=>row.application_id))]).in("stage",["CRECOM"]).in("status",["completed"]).in("outcome",["approve"]);checkCommitteeError(parents.error);
 const matched=bod.data.map(row=>({bod:row,parent:parents.data?.find(parent=>parent.application_id===row.application_id&&parent.cycle_no===row.cycle_no&&parent.packet_version===row.packet_version&&parent.policy_id===row.policy_id&&typeof row.snapshot_hash==="string"&&row.snapshot_hash.length>0&&parent.snapshot_hash===row.snapshot_hash&&parent.required_approvals===3&&parent.reviewer_target===3)}));
 const parentIds=[...new Set(matched.flatMap(row=>row.parent?[row.parent.id]:[]))];
 if(!parentIds.length)return output;
 const panel=await service.from("review_assignments").select("id,review_cycle_id,reviewer_auth_id,signatory_role,member_number,state").in("review_cycle_id",parentIds).in("state",["assigned","decision_recorded","awaiting_clarification","recused"]);checkCommitteeError(panel.error);
 if(!panel.data?.length)return output;
 const decisions=await service.from("individual_review_decisions").select("id,assignment_id,reviewer_auth_id,signatory_role,member_number,packet_version,decision,reviewer_name,created_at").in("assignment_id",panel.data.map(row=>row.id));checkCommitteeError(decisions.error);
 for(const {bod:cycle,parent} of matched){
  if(!parent)continue;
  const reviewers=panel.data.filter(row=>row.review_cycle_id===parent.id);
  if(reviewers.length!==3||new Set(reviewers.map(row=>row.reviewer_auth_id)).size!==3)continue;
  const confirmations:CommitteeConfirmation[]=[];
  for(const reviewer of reviewers){
   const decision=decisions.data?.find(row=>row.assignment_id===reviewer.id);
   if(reviewer.state!=="decision_recorded"||!decision||decision.decision!=="approve"||decision.reviewer_auth_id!==reviewer.reviewer_auth_id||decision.signatory_role!==reviewer.signatory_role||decision.packet_version!==parent.packet_version||decision.member_number!==null&&decision.member_number!==reviewer.member_number||typeof decision.reviewer_name!=="string"||!decision.reviewer_name.trim()||typeof decision.created_at!=="string"||!decision.created_at)continue;
   confirmations.push({reviewer:decision.reviewer_name,signatoryRole:decision.signatory_role as SignatoryRole,committeeMemberNumber:decision.member_number??reviewer.member_number,decision:"approve",createdAt:decision.created_at,reference:decision.id});
  }
  const members=confirmations.filter(row=>row.signatoryRole==="crecom_member");
  if(confirmations.length!==3||members.length!==2||!members.some(row=>row.committeeMemberNumber===1)||!members.some(row=>row.committeeMemberNumber===2)||confirmations.filter(row=>row.signatoryRole==="crecom_chairperson").length!==1)continue;
  confirmations.sort((a,b)=>(a.signatoryRole==="crecom_chairperson"?3:a.committeeMemberNumber??0)-(b.signatoryRole==="crecom_chairperson"?3:b.committeeMemberNumber??0));
  for(const assignment of admitted.filter(row=>row.cycleId===cycle.id))output.set(assignment.assignmentId,confirmations);
 }
 return output;
}
