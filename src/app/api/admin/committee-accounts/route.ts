import {committeeFailure,committeeReply,checkCommitteeError,readCommitteeBody,verifiedCommitteeAdministrator,inviteCommitteeAccount,createCommitteeAccount,sendCommitteeSetupLink,validCommitteeUuid,CommitteeError} from "@/lib/committeeServer";
import {withRequestDeadline} from "@/lib/requestDeadline";
import {changeCommitteeCredentials} from "@/lib/committeeCredentialActions";
export async function GET(request:Request){
 try{
  const {session}=await verifiedCommitteeAdministrator(request),params=new URL(request.url).searchParams;
  const id=params.get("id");
  if(id){
   if(!validCommitteeUuid(id))throw new CommitteeError("Choose a valid committee account.");
   const result=await session.rpc("committee_account_assignments",{p_id:id});checkCommitteeError(result.error);return committeeReply(result.data);
  }
  const result=await session.rpc("committee_accounts");checkCommitteeError(result.error);return committeeReply(result.data);
 }catch(error){return committeeFailure(error);}
}
export async function POST(request:Request){
 try{
  return await withRequestDeadline(async signal=>{
  const body=await readCommitteeBody(request);
  signal.throwIfAborted();
  const actionRequest=new Request(request.url,{headers:request.headers,signal});
  if(typeof body.password!=="string" || !body.password)throw new CommitteeError("Enter your account password.");
  const {session}=await verifiedCommitteeAdministrator(actionRequest,body.password);
  signal.throwIfAborted();
  if(body.operation==="verify")return committeeReply({verified:true});
  if(body.operation==="reset"||body.operation==="delete")return committeeReply(await changeCommitteeCredentials(session,actionRequest,body));
  if(body.operation==="create")return committeeReply(await createCommitteeAccount(session,body,actionRequest));
  if(body.operation==="invite")return committeeReply(await inviteCommitteeAccount(session,actionRequest,body));
  if(body.operation==="link")return committeeReply(await sendCommitteeSetupLink(session,actionRequest,body));
  if(!["edit","deactivate","reactivate"].includes(String(body.operation)) || !validCommitteeUuid(body.id) || !validCommitteeUuid(body.requestId) || !Number.isSafeInteger(body.revision))throw new CommitteeError("Choose a valid membership action.");
  const result=await session.rpc("committee_change_membership",{p_id:body.id,p_revision:body.revision,p_action:body.operation,p_payload:body.payload,p_request_id:body.requestId});
  checkCommitteeError(result.error);return committeeReply({success:true,message:"Committee membership updated."});
  },40000,"Account processing took too long. Refresh Committee Accounts to check its status, then retry the saved request.",request.signal);
 }catch(error){return committeeFailure(error);}
}
