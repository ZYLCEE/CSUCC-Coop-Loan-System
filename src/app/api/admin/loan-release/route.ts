import {verifiedAdministratorAction,committeeServiceClient,committeeReply,committeeFailure,readCommitteeBody,validCommitteeUuid,CommitteeError,checkCommitteeError} from "@/lib/committeeServer";
export async function POST(request:Request){
 try{
  const body=await readCommitteeBody(request);
  if(typeof body.applicationId!=="string"||!body.applicationId.trim()||body.applicationId.length>100||!validCommitteeUuid(body.requestId)||typeof body.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(body.date)||typeof body.reference!=="string"||body.reference.trim().length<1||body.reference.trim().length>80||typeof body.notes!=="string"||body.notes.length>2000||!["number","string"].includes(typeof body.amount)||!Number.isFinite(Number(body.amount))||Number(body.amount)<=0)throw new CommitteeError("Enter valid release details.");
  const {user}=await verifiedAdministratorAction(request,body.password,"loans.release");
  const result=await committeeServiceClient(request).rpc("loan_release_action",{p_actor_id:user.id,p_args:{applicationId:body.applicationId,requestId:body.requestId,date:body.date,reference:body.reference.trim(),amount:body.amount,notes:body.notes}});
  if(result.error?.code==="23505")throw new CommitteeError("That disbursement reference or request was already used. Refresh the loan before retrying.",409);
  if(["42883","PGRST202"].includes(result.error?.code??""))throw new CommitteeError("Loan release setup is pending. Apply the approval-workflow database migration.",503);
  checkCommitteeError(result.error);return committeeReply(result.data);
 }catch(error){return committeeFailure(error);}
}
