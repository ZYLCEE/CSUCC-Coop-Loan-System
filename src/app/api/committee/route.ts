import {createClient} from "@supabase/supabase-js";
import {committeeFailure,committeeReply,checkCommitteeError,committeeSession,CommitteeError,validCommitteeUuid,readCommitteeBody,committeeServiceClient} from "@/lib/committeeServer";
import {getCommitteeRole} from "@/lib/committee";
import {validatePasswordChange} from "@/lib/profileModel";
import {updateCommitteeAuthUser} from "@/lib/committeeAuthUpdate";

export async function GET(request:Request){
 try{
  const {session,user}=await committeeSession(request),params=new URL(request.url).searchParams,operation=params.get("operation")??"workspace";
  if(operation==="access"){
   const result=await session.rpc("portal_session_access");checkCommitteeError(result.error);return committeeReply(result.data);
  }
  if(!getCommitteeRole(user))throw new CommitteeError("Active committee membership is required.",403);
  if(operation==="workspace"){
   const result=await session.rpc("committee_workspace");checkCommitteeError(result.error);return committeeReply(result.data);
  }
  if(operation==="inbox"){
   const result=await session.rpc("committee_inbox");checkCommitteeError(result.error);return committeeReply(result.data);
  }
  const id=params.get("assignmentId");if(!validCommitteeUuid(id))throw new CommitteeError("Choose an assigned application.");
  if(operation==="packet"){
   const result=await session.rpc("committee_review_packet",{p_assignment_id:id});checkCommitteeError(result.error);return committeeReply(result.data);
  }
  if(operation==="file"){
   const documentId=params.get("documentId"),versionId=params.get("versionId");
   if(!validCommitteeUuid(documentId) || versionId!==null && !validCommitteeUuid(versionId))throw new CommitteeError("Choose a valid assigned file version.");
   const result=await session.rpc("committee_document_location",{p_assignment_id:id,p_document_id:documentId,p_version_id:versionId});checkCommitteeError(result.error);
   const link=await session.storage.from("loan-documents").createSignedUrl(result.data.path,300);
   if(link.error || !link.data?.signedUrl)throw new CommitteeError("The assigned file could not be opened. Refresh and retry.",503);
   return committeeReply({url:link.data.signedUrl,name:result.data.name,contentType:result.data.contentType,expiresAt:new Date(Date.now()+300000).toISOString()});
  }
  throw new CommitteeError("Unknown committee request.");
 }catch(error){return committeeFailure(error);}
}
export async function POST(request:Request){
 try{
  const body=await readCommitteeBody(request),context=await committeeSession(request),{session,user,url,key,options,token}=context;
  if(!getCommitteeRole(user))throw new CommitteeError("Committee membership is required.",403);
  const access=await session.rpc("portal_session_access");checkCommitteeError(access.error);
  if(body.operation==="setup"){
   if(access.data?.setupRequired!==true && access.data?.allowed!==true)throw new CommitteeError("This invitation or membership is no longer available.",403);
   if(typeof body.password!=="string" || typeof body.confirm!=="string" || body.password!==body.confirm || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/.test(body.password))throw new CommitteeError("Enter matching passwords of 8–128 characters with uppercase, lowercase, a number and a symbol.");
   if(access.data.setupRequired!==true){
    const claims=await session.auth.getClaims(token);
    const amr=claims.data?.claims.amr as {method?:string;timestamp?:number}[]|undefined;
    if(!amr?.some(item=>["otp","recovery","invite","magiclink"].includes(item.method??"") && Number(item.timestamp)>=Date.now()/1000-900))throw new CommitteeError("Open a recent setup/reset email link or use Change Password in your profile.",403);
   }
   await updateCommitteeAuthUser(context,{password:body.password});
   const result=await committeeServiceClient(request).rpc("committee_complete_setup",{p_user_id:user.id});checkCommitteeError(result.error);
   const current=await session.rpc("portal_session_access");checkCommitteeError(current.error);return committeeReply(current.data);
  }
  if(access.data?.allowed!==true)throw new CommitteeError("Active committee membership is no longer available.",403);
  if(body.operation==="read"){
   if(body.id!==null && body.id!==undefined && !validCommitteeUuid(body.id))throw new CommitteeError("Choose a valid notification.");
   const result=await session.rpc("committee_inbox",{p_read_id:body.id??null,p_all:body.all===true});checkCommitteeError(result.error);return committeeReply(result.data);
  }
  if(body.operation==="profile"){
   const name=typeof body.name==="string"?body.name.trim():"",phone=typeof body.phone==="string"?body.phone.trim():"";
   if(!name || name.length>160 || /[\u0000-\u001f\u007f]/.test(name) || phone.length>30 || phone && (!/^[+\d\s().-]+$/.test(phone) || phone.replace(/\D/g,"").length<7 || phone.replace(/\D/g,"").length>15))throw new CommitteeError("Enter a valid full name and contact number.");
   await updateCommitteeAuthUser(context,{data:{full_name:name,phone}});
   const audit=await session.rpc("committee_self_activity",{p_action:"profile"});
   return committeeReply({success:true,warning:audit.error?"Profile updated, but its activity record is unavailable.":null});
  }
  if(body.operation==="password"){
   const passwords=validatePasswordChange(body.payload);
   if(!user.email)throw new CommitteeError("Your sign-in email is unavailable.");
   const verifier=createClient(url,key,options),verified=await verifier.auth.signInWithPassword({email:user.email,password:passwords.current});
   try{
    if(verified.error || verified.data.user?.id!==user.id)throw new CommitteeError("Your current password could not be verified.",401);
    const current=await session.rpc("portal_session_access");checkCommitteeError(current.error);
    if(current.data?.allowed!==true)throw new CommitteeError("Committee access is no longer available.",403);
    const changed=await verifier.auth.updateUser({password:passwords.next,current_password:passwords.current});
    if(changed.error)throw new CommitteeError("The new password could not be saved. Check its requirements and retry.");
   }finally{if(verified.data.session)await verifier.auth.signOut({scope:"local"}).catch(()=>{});}
   const audit=await session.rpc("committee_self_activity",{p_action:"password"});
   return committeeReply({success:true,warning:audit.error?"Password updated, but its activity record is unavailable.":null});
  }
  throw new CommitteeError("Unknown committee action.");
 }catch(error){return committeeFailure(error);}
}
