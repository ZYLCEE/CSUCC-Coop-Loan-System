import {createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {isActiveAdministrator} from "@/lib/adminPrivileges";
import {portalSessionId} from "@/lib/portalActivityServer";
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request){
 try{
  const token=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1],url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!token)return reply({error:"Sign in to continue."},401);if(!url||!key||!secret)return reply({error:"Account actions are unavailable."},503);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
  const auth=await client.auth.getUser(token);if(auth.error||!auth.data.user)return reply({error:"Your session expired."},401);
  if(!isActiveAdministrator(auth.data.user))return reply({error:"Administrator access is required."},403);
  const raw=await request.text();if(raw.length>24000)return reply({error:"The action request is too large."},413);
  const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))return reply({error:"Invalid action request."},400);
  // The existing function retains all grants, password checks, privileges and business rules.
  const response=await fetch(url+"/functions/v1/secure-admin-action",{method:"POST",headers:{Authorization:"Bearer "+token,apikey:key,"Content-Type":"application/json"},body:raw,cache:"no-store"});
  const result=await response.json();
  const sessionId=portalSessionId(token);
  if(response.ok&&result.success===true&&body.mode==="execute"&&typeof body.grant==="string"&&sessionId){
   try{
   const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
   const receipt=createHash("sha256").update(body.grant).digest("hex");
   const args={p_actor_id:auth.data.user.id,p_auth_session_id:sessionId,p_source_key:"protected:"+receipt,p_action:String(body.action??""),p_target:String(body.target??"").slice(0,200),p_reason:typeof body.payload?.reason==="string"?body.payload.reason.slice(0,500):""};
   let logged=await admin.rpc("append_completed_portal_action",args);
   if(logged.error)logged=await admin.rpc("append_completed_portal_action",args);
   if(logged.error||logged.data===false)result.warning="The action completed, but its activity entry could not be saved.";
   }catch{result.warning="The action completed, but its activity entry could not be saved.";}
  }
  return reply(result,response.status);
 }catch{return reply({error:"The action service is temporarily unavailable. Please retry."},503);}
}
