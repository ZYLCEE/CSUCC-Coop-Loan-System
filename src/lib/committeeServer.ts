import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import {isActiveAdministrator} from "./adminPrivileges";
import {validateCommitteeInvite,validateCommitteeCredentials} from "./committee";
import {portalActivityHeaders} from "./portalActivityServer";
import {fetchWithDeadline,RequestTimeoutError} from "./requestDeadline";
export class CommitteeError extends Error{constructor(message:string,public status=400){super(message);}}
export const validCommitteeUuid=(value:unknown):value is string=>typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const committeeReply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export function checkCommitteeError(error:{code?:string;message?:string}|null){
 if(!error)return;
 if(error.code==="42501")throw new CommitteeError(error.message??"Access is no longer available.",403);
 if(error.code==="40001")throw new CommitteeError(error.message??"This record changed. Refresh before saving.",409);
 if(error.code==="55P03")throw new CommitteeError(error.message??"Please wait before retrying.",429);
 if(error.code==="P0002")throw new CommitteeError("This account or assignment is no longer available.",404);
 if(error.code==="P0001")throw new CommitteeError(error.message??"The committee request could not be completed.");
 if(["22007","22008"].includes(error.code??""))throw new CommitteeError("Choose valid membership dates.");
 throw new CommitteeError("The committee service is unavailable. Refresh and retry.",503);
}
export async function committeeSession(request:Request){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url || !key)throw new CommitteeError("The account service is not configured.",503);
 const token=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
 if(!token)throw new CommitteeError("Sign in to continue.",401);
 const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchWithDeadline(request.signal)}};
 const session=createClient(url,key,{...options,global:{...options.global,headers:{Authorization:"Bearer "+token}}});
 const {data,error}=await session.auth.getUser(token);
 if(error?.status===0)throw new CommitteeError("The sign-in service is taking too long to respond. Refresh and retry.",504);
 if(error || !data.user)throw new CommitteeError("Your session expired. Sign in again.",401);
 return {session,user:data.user,token,url,key,options};
}
export async function verifiedSuperAdmin(request:Request,password?:unknown){
 const context=await committeeSession(request);
 if(!isActiveAdministrator(context.user) || context.user.app_metadata.role!=="super_admin")throw new CommitteeError("Super Admin access is required.",403);
 const access=await context.session.rpc("portal_session_access");checkCommitteeError(access.error);
 if(access.data?.allowed!==true || access.data.role!=="super_admin")throw new CommitteeError("Super Admin access is no longer available.",403);
 if(password!==undefined){
  if(typeof password!=="string" || !password || password.length>1024 || !context.user.email)throw new CommitteeError("Enter your Super Admin password.");
  const verifier=createClient(context.url,context.key,context.options);
  const result=await verifier.auth.signInWithPassword({email:context.user.email,password});
  try{
   if(result.error || result.data.user?.id!==context.user.id)throw new CommitteeError(result.error?.status===429?"Too many attempts. Wait and retry.":"Your account password could not be verified.",result.error?.status===429?429:401);
   const current=await context.session.rpc("portal_session_access");checkCommitteeError(current.error);
   if(current.data?.allowed!==true || current.data.role!=="super_admin")throw new CommitteeError("Super Admin access is no longer available.",403);
  }finally{if(result.data.session)await verifier.auth.signOut({scope:"local"}).catch(()=>{});}
 }
 if(password!==undefined){
  // Management RPCs are service-only. Browser tokens cannot skip password verification.
  const protectedSession=new Proxy(context.session,{get(target,key,receiver){
   if(key==="rpc")return (operation:string,args:Record<string,unknown>)=>committeeServiceClient(request).rpc("committee_account_action",{p_actor_id:context.user.id,p_operation:operation,p_args:args});
   return Reflect.get(target,key,receiver);
  }});
  return {...context,session:protectedSession};
 }
 return context;
}
export async function verifiedAdministratorAction(request:Request,password:unknown,privilege:string){
 const context=await committeeSession(request);
 if(!isActiveAdministrator(context.user))throw new CommitteeError("Active administrator access is required.",403);
 if(typeof password!=="string"||!password||password.length>1024||!context.user.email)throw new CommitteeError("Enter your account password.");
 const permitted=await context.session.rpc("document_staff_access",{p_privilege:privilege});checkCommitteeError(permitted.error);
 if(permitted.data!==true)throw new CommitteeError("Your account does not have permission for this action.",403);
 const verifier=createClient(context.url,context.key,context.options);
 const result=await verifier.auth.signInWithPassword({email:context.user.email,password});
 try{
  if(result.error?.status===0)throw new CommitteeError("The sign-in service is taking too long to respond. Refresh and retry.",504);
  if(result.error||result.data.user?.id!==context.user.id)throw new CommitteeError(result.error?.status===429?"Too many attempts. Wait and retry.":"Your account password could not be verified.",result.error?.status===429?429:401);
  const current=await context.session.rpc("document_staff_access",{p_privilege:privilege});checkCommitteeError(current.error);
  if(current.data!==true)throw new CommitteeError("Your permission changed. Sign in again.",403);
 }finally{if(result.data.session)await verifier.auth.signOut({scope:"local"}).catch(()=>{});}
 return context;
}
export async function verifiedCommitteeAdministrator(request:Request,password?:unknown){
 const context=password===undefined?await committeeSession(request):await verifiedAdministratorAction(request,password,"committee.accounts.manage");
 if(!isActiveAdministrator(context.user))throw new CommitteeError("Active administrator access is required.",403);
 const access=await context.session.rpc("document_staff_access",{p_privilege:"committee.accounts.manage"});checkCommitteeError(access.error);
 if(access.data!==true)throw new CommitteeError("Committee account management permission is required.",403);
 if(password===undefined)return context;
 const protectedSession=new Proxy(context.session,{get(target,key,receiver){
  if(key==="rpc")return (operation:string,args:Record<string,unknown>)=>committeeServiceClient(request).rpc("committee_account_action",{p_actor_id:context.user.id,p_operation:operation,p_args:args});
  return Reflect.get(target,key,receiver);
 }});
 return {...context,session:protectedSession};
}
export function committeeServiceClient(request?:Request){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !secret)throw new CommitteeError("Committee invitation service is unavailable.",503);
 return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchWithDeadline(request?.signal),headers:request?portalActivityHeaders(request):{}}});
}
function providerFailure(error:{code?:string;status?:number}|null){
 if(error?.status===429 || ["over_email_send_rate_limit","over_request_rate_limit"].includes(error?.code??""))return new CommitteeError("The account provider reached its email or request limit. Wait before retrying.",429);
 if(["email_exists","user_already_exists"].includes(error?.code??""))return new CommitteeError("This email is already registered. Use the saved account's setup link action.");
 if(error?.code==="email_address_not_authorized")return new CommitteeError("The email provider is not configured to send invitations to this address. Check Supabase SMTP settings.",503);
 return new CommitteeError("The account provider could not complete the email request. Retry the saved request or check the email service configuration.",503);
}
export function setupRedirect(request:Request){return new URL("/auth/committee-setup",request.url).toString();}
export async function createCommitteeAccount(session:SupabaseClient,body:Record<string,unknown>,request?:Request){
 if(!validCommitteeUuid(body.requestId))throw new CommitteeError("Reopen the account form and retry.");
 const details=validateCommitteeInvite(body.payload),credentials=validateCommitteeCredentials(body.credentials);
 if(body.identityVerified!==true)throw new CommitteeError("Confirm the reviewer's identity and assigned committee position.");
 const payload={...details,provisioningMode:"password"},attemptId=crypto.randomUUID();
 const reserved=await session.rpc("committee_reserve_invite",{p_request_id:body.requestId,p_attempt_id:attemptId,p_payload:payload});checkCommitteeError(reserved.error);
 if(reserved.data.complete)return {success:true,message:"This committee account has already been created."};
 try{
  const service=committeeServiceClient(request);
  const metadata={role:details.role,account_status:"active",committee_invitation_request_id:body.requestId};
  let user;
  if(reserved.data.authUserId){
   const existing=await service.auth.admin.getUserById(reserved.data.authUserId);
   if(existing.error||existing.data.user?.app_metadata.committee_invitation_request_id!==body.requestId)throw new CommitteeError("This account does not match the saved creation request.",409);
   const updated=await service.auth.admin.updateUserById(existing.data.user.id,{password:credentials.password,app_metadata:metadata});
   if(updated.error?.status===0)throw new CommitteeError("Account creation took too long. Refresh Committee Accounts to check its status, then retry the saved request.",504);
   if(updated.error||!updated.data.user)throw new CommitteeError("The initial credentials could not be saved. Retry this request.",503);user=updated.data.user;
  }else{
   const created=await service.auth.admin.createUser({email:details.email,password:credentials.password,email_confirm:true,app_metadata:metadata,user_metadata:{full_name:details.name}});
   if(created.error||!created.data.user){
    if(created.error?.status===0)throw new CommitteeError("Account creation took too long. Refresh Committee Accounts to check its status, then retry the saved request.",504);
    if(["email_exists","user_already_exists"].includes(created.error?.code??""))throw new CommitteeError("This email is already registered. Use the existing account or its saved Retry creation action.",409);
    throw new CommitteeError(created.error?.code==="weak_password"?"Choose a stronger temporary password that meets the password requirements.":"The committee account could not be created. Check the email and password requirements, then retry.",created.error?.status===429?429:400);
   }user=created.data.user;
  }
  const finished=await session.rpc("committee_finish_invite",{p_request_id:body.requestId,p_attempt_id:attemptId,p_user_id:user.id});checkCommitteeError(finished.error);
  return {success:true,message:"Committee account created. Share the temporary credentials privately. The reviewer signs in on the main login page and sets their own password before reviewing loans."};
 }catch(error){
  await session.rpc("committee_request_failed",{p_request_id:body.requestId,p_attempt_id:attemptId,p_message:error instanceof CommitteeError?error.message:"Account creation failed. Retry the saved request."});throw error;
 }
}
export async function inviteCommitteeAccount(session:SupabaseClient,request:Request,body:Record<string,unknown>){
 if(!validCommitteeUuid(body.requestId))throw new CommitteeError("Reopen the invitation form and retry.");
 const payload=validateCommitteeInvite(body.payload),attemptId=crypto.randomUUID();
 const reserved=await session.rpc("committee_reserve_invite",{p_request_id:body.requestId,p_attempt_id:attemptId,p_payload:payload});
 checkCommitteeError(reserved.error);
 if(reserved.data.complete)return {success:true,message:"This committee invitation was already recorded."};
 try{
  const service=committeeServiceClient();
  let user;
  if(reserved.data.authUserId){
   const lookup=await service.auth.admin.getUserById(reserved.data.authUserId);
   if(lookup.error || !lookup.data.user)throw new CommitteeError("The pending account could not be loaded. Retry.",503);
   user=lookup.data.user;
  }else{
   const invited=await service.auth.admin.inviteUserByEmail(payload.email,{redirectTo:setupRedirect(request),
    data:{full_name:payload.name,committee_invitation_request_id:body.requestId}});
   if(invited.error || !invited.data.user)throw providerFailure(invited.error);
   user=invited.data.user;
  }
  const existingRole=user.app_metadata.role;
  if(existingRole && (existingRole!==payload.role || user.app_metadata.committee_invitation_request_id!==body.requestId))throw new CommitteeError("This account does not match the pending invitation.",409);
  const metadata:Record<string,unknown>={...user.app_metadata,role:payload.role,account_status:"active",committee_invitation_request_id:body.requestId};
  delete metadata.admin_privileges;
  const updated=await service.auth.admin.updateUserById(user.id,{app_metadata:metadata});
  if(updated.error)throw new CommitteeError("The invitation was requested, but account authorization could not be completed. Retry this saved invitation.",503);
  const finished=await session.rpc("committee_finish_invite",{p_request_id:body.requestId,p_attempt_id:attemptId,p_user_id:user.id});
  checkCommitteeError(finished.error);
  return {success:true,message:"Committee invitation recorded. The reviewer must complete their own password setup."};
 }catch(error){
  await session.rpc("committee_request_failed",{p_request_id:body.requestId,p_attempt_id:attemptId,p_message:error instanceof CommitteeError?error.message:"Invitation processing failed. Retry the saved request."});
  throw error;
 }
}
export async function sendCommitteeSetupLink(session:SupabaseClient,request:Request,body:Record<string,unknown>){
 if(!validCommitteeUuid(body.id) || !validCommitteeUuid(body.requestId) || !Number.isSafeInteger(body.revision))throw new CommitteeError("Refresh the committee account before sending a setup link.");
 const attemptId=crypto.randomUUID();
 const claimed=await session.rpc("committee_begin_link",{p_id:body.id,p_revision:body.revision,p_request_id:body.requestId,p_attempt_id:attemptId});
 checkCommitteeError(claimed.error);if(claimed.data.complete)return {success:true,message:"This setup link request was already processed."};
 try{
  const service=committeeServiceClient(),lookup=await service.auth.admin.getUserById(claimed.data.userId);
  if(lookup.error || !lookup.data.user || lookup.data.user.email!==claimed.data.email)throw new CommitteeError("The committee account could not be verified.",503);
  const sent=claimed.data.confirmed
   ?await service.auth.resetPasswordForEmail(claimed.data.email,{redirectTo:setupRedirect(request)})
   :await service.auth.admin.inviteUserByEmail(claimed.data.email,{redirectTo:setupRedirect(request)});
  if(sent.error)throw providerFailure(sent.error);
  const finished=await session.rpc("committee_finish_link",{p_request_id:body.requestId,p_attempt_id:attemptId});checkCommitteeError(finished.error);
  return {success:true,message:"The account provider accepted the setup/reset link request."};
 }catch(error){
  await session.rpc("committee_request_failed",{p_request_id:body.requestId,p_attempt_id:attemptId,p_message:error instanceof CommitteeError?error.message:"Setup link processing failed. Retry later."});throw error;
 }
}
export async function readCommitteeBody(request:Request){
 const raw=await request.text();if(raw.length>12000)throw new CommitteeError("The committee request is too large.",413);
 let body;try{body=JSON.parse(raw);}catch{throw new CommitteeError("The committee request is invalid.");}
 if(!body || typeof body!=="object" || Array.isArray(body))throw new CommitteeError("The committee request is invalid.");
 return body as Record<string,unknown>;
}
export function committeeFailure(error:unknown){
 if(error instanceof RequestTimeoutError)return committeeReply({error:error.message},504);
 return committeeReply({error:error instanceof Error && /^(Enter|Choose|Complete)/.test(error.message)?error.message:error instanceof CommitteeError?error.message:"The committee service is unavailable. Refresh and retry."},error instanceof CommitteeError?error.status:error instanceof Error && /^(Enter|Choose|Complete)/.test(error.message)?400:503);
}
