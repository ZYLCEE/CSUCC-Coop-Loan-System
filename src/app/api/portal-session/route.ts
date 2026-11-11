import {createClient} from "@supabase/supabase-js";
import {portalSessionId,portalDevice} from "@/lib/portalActivityServer";
export const runtime="nodejs";
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:Request){
 try{
  const authorization=request.headers.get("authorization");
  const token=authorization?.match(/^Bearer\s+/i)?authorization.replace(/^Bearer\s+/i,""):null;
  if(!token)return reply({error:"Sign in to continue."},401);
  const {url,key,secret}=process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?{url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret:process.env.SUPABASE_SERVICE_ROLE_KEY}:{url:null,key:null,secret:null};
  if(!url||!key||!secret)return reply({error:"Portal sessions are unavailable."},503);
  const session=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
  const auth=await session.auth.getUser(token);if(auth.error||!auth.data.user)return reply({error:"Your session expired. Sign in again."},401);
  const id=portalSessionId(token);if(!id)return reply({error:"Sign in again to start a tracked portal session."},401);
  const raw=await request.text();if(raw.length>1000)return reply({error:"Invalid session request."},400);
  const body=JSON.parse(raw);if(!["start","touch","logout"].includes(body.operation)||!Number.isFinite(body.idleSeconds??0)||(body.idleSeconds??0)<0)return reply({error:"Invalid session request."},400);
  const access=await session.rpc("portal_session_access");
  if(access.error||!access.data)return reply({error:"Portal membership could not be checked."},503);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  if(!access.data.allowed||access.data.setupRequired){
   await admin.rpc("manage_portal_log_session",{p_actor_id:auth.data.user.id,p_auth_session_id:id,p_operation:"revoke"});
   return reply({error:"Portal access is inactive or unavailable."},403);
  }
  const device=portalDevice(request);
  const result=await admin.rpc("manage_portal_log_session",{p_actor_id:auth.data.user.id,p_auth_session_id:id,p_operation:body.operation,p_browser:device.browser,p_os:device.os,p_ip:device.ip,p_idle_seconds:Math.min(Math.floor(body.idleSeconds??0),86400)});
  if(result.error){
   return reply({error:result.error.code==="42501"?"Your portal session ended. Sign in again.":"Portal session tracking is unavailable. Retry."},result.error.code==="42501"?401:503);
  }
  if(result.data?.expired)return reply({error:"Your portal session ended after inactivity. Sign in again."},401);
  return reply(result.data);
 }catch{return reply({error:"The session request could not be completed."},400);}
}
