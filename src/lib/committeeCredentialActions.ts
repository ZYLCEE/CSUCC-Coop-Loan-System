import {createHmac} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {validateCommitteeCredentials} from "./committee";
import {committeeServiceClient,checkCommitteeError,CommitteeError,validCommitteeUuid} from "./committeeServer";

export async function changeCommitteeCredentials(session:SupabaseClient,request:Request,body:Record<string,unknown>){
 if(!validCommitteeUuid(body.id)||!validCommitteeUuid(body.requestId)||!Number.isSafeInteger(body.revision)||!["reset","delete"].includes(String(body.operation)))throw new CommitteeError("Choose a valid committee account action.");
 const operation=body.operation as "reset"|"delete",reason=typeof (body.payload as {reason?:unknown})?.reason==="string"?String((body.payload as {reason:string}).reason).trim():"";
 if(!reason||reason.length>2000)throw new CommitteeError("Enter a reason of up to 2000 characters.");
 const credentials=operation==="reset"?validateCommitteeCredentials(body.credentials):null;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)throw new CommitteeError("Committee account actions are unavailable.",503);
 // A keyed digest binds retries to the exact secret without saving the password.
 const fingerprint=createHmac("sha256",key).update(JSON.stringify({id:body.id,revision:body.revision,operation,reason,temporary:credentials?.password??null})).digest("hex");
 const attemptId=crypto.randomUUID();
 const claimed=await session.rpc("committee_begin_credential_action",{p_id:body.id,p_revision:body.revision,p_operation:operation,p_request_id:body.requestId,p_attempt_id:attemptId,p_fingerprint:fingerprint,p_reason:reason});
 if(claimed.error?.code==="PGRST202"||claimed.error?.code==="42883")throw new CommitteeError("Committee password reset and deletion are not enabled yet. Ask your system administrator to complete the account-actions update.",503);
 checkCommitteeError(claimed.error);
 if(claimed.data?.complete)return claimed.data.result;
 try{
  if(operation==="delete"&&claimed.data.authDeleted){
   const finished=await session.rpc("committee_finish_credential_action",{p_request_id:body.requestId,p_attempt_id:attemptId});checkCommitteeError(finished.error);return finished.data;
  }
  const service=committeeServiceClient(request),lookup=await service.auth.admin.getUserById(claimed.data.userId),user=lookup.data.user;
  const deleted=user&&(user as typeof user&{deleted_at?:string|null}).deleted_at;
  if(lookup.error||!user||user.id!==claimed.data.userId||!deleted&&user.app_metadata.role!==claimed.data.role)throw new CommitteeError("The committee sign-in account could not be verified. Retry this saved request.",409);
  if(operation==="reset"){
   // Receipt prevents a retry from overwriting a password already chosen after this reset.
   if(user.app_metadata.committee_credential_action_id!==body.requestId){
    const updated=await service.auth.admin.updateUserById(user.id,{password:credentials!.password,app_metadata:{...user.app_metadata,committee_credential_action_id:body.requestId}});
    if(updated.error)throw new CommitteeError("The temporary password could not be saved. Check its requirements and retry this request.",503);
   }
  }else if(!deleted){
   // Soft Auth deletion preserves the referenced reviewer ID and immutable decisions.
   const removed=await service.auth.admin.deleteUser(user.id,true);
   if(removed.error)throw new CommitteeError("Sign-in access could not be deleted. Retry this saved request.",503);
  }
  const finished=await session.rpc("committee_finish_credential_action",{p_request_id:body.requestId,p_attempt_id:attemptId});checkCommitteeError(finished.error);
  return finished.data;
 }catch(error){
  try{await session.rpc("committee_fail_credential_action",{p_request_id:body.requestId,p_attempt_id:attemptId});}catch{}
  throw error;
 }
}
