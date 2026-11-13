import {createClient} from "@supabase/supabase-js";
import {committeeSession,verifiedSuperAdmin,verifiedAdministratorAction,committeeServiceClient,committeeReply,committeeFailure,CommitteeError,checkCommitteeError,readCommitteeBody,validCommitteeUuid} from "@/lib/committeeServer";
import {isActiveAdministrator} from "@/lib/adminPrivileges";
import {getCommitteeRole} from "@/lib/committee";
import {validateExecutionRules,validateReviewMutation} from "@/lib/committeeReview";
import {withCommitteeApprovalProgress} from "@/lib/committeeProgressServer";
export async function GET(request:Request){
 try{
  const {session,user}=await committeeSession(request);
  if(!isActiveAdministrator(user))throw new CommitteeError("Active administrator access is required.",403);
  const id=new URL(request.url).searchParams.get("applicationId");
  if(!id?.trim()||id.length>100)throw new CommitteeError("Choose an application.");
  const result=await session.rpc("committee_review_state",{p_application_id:id});checkCommitteeError(result.error);
  return committeeReply({...result.data,canFinalize:user.app_metadata.role==="super_admin"&&result.data?.canFinalize===true});
 }catch(error){return committeeFailure(error);}
}
export async function POST(request:Request){
 try{
  const body=await readCommitteeBody(request);
  if(body.operation==="activate_policy"){
   if(!validCommitteeUuid(body.policyId)||!validCommitteeUuid(body.requestId))throw new CommitteeError("Choose the latest saved policy draft.");
   if(typeof body.password!=="string"||!body.password)throw new CommitteeError("Enter your Super Admin password.");
   let rules;try{rules=validateExecutionRules(body.rules);}catch(error){throw new CommitteeError(error instanceof Error?error.message:"Complete the approved voting rules.");}
   const {user}=await verifiedSuperAdmin(request,body.password);
   const result=await committeeServiceClient(request).rpc("committee_review_action",{p_actor_id:user.id,p_operation:"activate_policy",p_args:{policyId:body.policyId,requestId:body.requestId,rules}});
   checkCommitteeError(result.error);return committeeReply(result.data);
  }
  let input;try{input=validateReviewMutation(body);}catch(error){throw new CommitteeError(error instanceof Error?error.message:"Complete the review action.");}
  let actorId:string;
  if(input.operation==="finalize"){
   const confirmed=await verifiedAdministratorAction(request,body.password,"applications.finalize");
   if(confirmed.user.app_metadata.role!=="super_admin")throw new CommitteeError("Only Super Admin may record the final decision.",403);
   actorId=confirmed.user.id;
  }else{
   const context=await committeeSession(request),{session,user}=context;
   actorId=user.id;
   if(["approve","reject","clarify","recuse"].includes(input.operation)){
    if(!getCommitteeRole(user)||!user.email)throw new CommitteeError("Active committee membership is required.",403);
    if(typeof body.password!=="string"||!body.password||body.password.length>1024)throw new CommitteeError("Enter your account password to confirm your review.");
    const access=await session.rpc("portal_session_access");checkCommitteeError(access.error);
    if(access.data?.allowed!==true)throw new CommitteeError("Committee membership is no longer active.",403);
    const verifier=createClient(context.url,context.key,context.options);
    const verified=await verifier.auth.signInWithPassword({email:user.email,password:body.password});
    try{
     if(verified.error||verified.data.user?.id!==user.id)throw new CommitteeError(verified.error?.status===429?"Too many attempts. Wait and retry.":"Your account password could not be verified.",verified.error?.status===429?429:401);
     const current=await session.rpc("portal_session_access");checkCommitteeError(current.error);
     if(current.data?.allowed!==true)throw new CommitteeError("Committee membership changed. Sign in again.",403);
    }finally{if(verified.data.session)await verifier.auth.signOut({scope:"local"}).catch(()=>{});}
    if(getCommitteeRole(user)==="bod_member"&&["approve","reject"].includes(input.operation)){
     const assigned=await session.rpc("committee_review_packet",{p_assignment_id:input.payload.assignmentId});checkCommitteeError(assigned.error);
     if(assigned.data?.assignment?.stage!=="BOD"||assigned.data.assignment.applicationId!==input.applicationId)throw new CommitteeError("This BOD review is not assigned to the selected application.",403);
     // Recorded-decision retries still go through SQL's immutable request replay.
     if(!assigned.data.myDecision){
      const [current]=await withCommitteeApprovalProgress(committeeServiceClient(request),[assigned.data.assignment]);
      if(current.crecomConfirmations?.length!==3)throw new CommitteeError("All three CRECOM approvals for this application must be recorded before the BOD decision.",409);
     }
    }
   }else{
    if(!isActiveAdministrator(user))throw new CommitteeError("Administrator forwarding permission is required.",403);
    const permission=await session.rpc("document_staff_access",{p_privilege:"applications.forward"});checkCommitteeError(permission.error);
    if(permission.data!==true)throw new CommitteeError("Application forwarding permission is required.",403);
    await verifiedAdministratorAction(request,body.password,"applications.forward");
   }
  }
  const {operation,...args}=input;
  const result=await committeeServiceClient(request).rpc("committee_review_action",{p_actor_id:actorId,p_operation:operation,p_args:args});
  checkCommitteeError(result.error);return committeeReply(result.data);
 }catch(error){return committeeFailure(error);}
}
