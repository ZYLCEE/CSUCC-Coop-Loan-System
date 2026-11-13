import {verifiedAdministratorAction,committeeServiceClient,committeeReply,committeeFailure,readCommitteeBody,validCommitteeUuid,CommitteeError,checkCommitteeError} from "@/lib/committeeServer";
export async function POST(request:Request){
 try{
  const body=await readCommitteeBody(request);
  if(typeof body.applicationId!=="string"||!body.applicationId.trim()||body.applicationId.length>100||!validCommitteeUuid(body.requestId)||typeof body.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(body.date)||typeof body.reference!=="string"||body.reference.trim().length<1||body.reference.trim().length>80||typeof body.notes!=="string"||body.notes.length>2000||!["number","string"].includes(typeof body.amount)||!Number.isFinite(Number(body.amount))||Number(body.amount)<=0)throw new CommitteeError("Enter valid release details.");
  const {user,session}=await verifiedAdministratorAction(request,body.password,"loans.release");
  let result=await committeeServiceClient(request).rpc("loan_release_action",{p_actor_id:user.id,p_args:{applicationId:body.applicationId,requestId:body.requestId,date:body.date,reference:body.reference.trim(),amount:body.amount,notes:body.notes}});
  if(result.error?.code==="PGRST202"){
   // Earlier databases expose the same atomic release under the caller's JWT.
   // Only a missing dispatcher permits fallback, never a failed release or an
   // ambiguous timeout. Keep its database role, final-decision and retry guards.
   result=await session.rpc("release_approved_loan",{p_application_id:body.applicationId,p_request_id:body.requestId,p_date:body.date,p_reference:body.reference.trim(),p_expected_amount:body.amount,p_notes:body.notes});
  }
  if(result.error?.code==="23505")throw new CommitteeError("That disbursement reference or request was already used. Refresh the loan before retrying.",409);
  if(["42883","PGRST202"].includes(result.error?.code??""))throw new CommitteeError("The loan release service is unavailable. Ask the system administrator to check the release database functions.",503);
  checkCommitteeError(result.error);return committeeReply(result.data);
 }catch(error){return committeeFailure(error);}
}
