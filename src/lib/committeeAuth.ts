"use client";
import {getSupabaseClient} from "./supabase";
import type {PortalAccess} from "./committee";
export async function resolvePortalAccess():Promise<PortalAccess>{
  const result=await getSupabaseClient().rpc("portal_session_access");
  if(result.error||!result.data)throw new Error("Your committee access could not be checked. Please retry.");
  return result.data as PortalAccess;
}
export function hasCommitteeEmailLink(){
 if(typeof window==="undefined")return false;
 const query=new URLSearchParams(window.location.search),hash=new URLSearchParams(window.location.hash.slice(1));
 return ["invite","recovery"].includes(query.get("type")??hash.get("type")??"");
}
export async function acceptCommitteeEmailLink(){
 const client=getSupabaseClient(),query=new URLSearchParams(window.location.search);
 const tokenHash=query.get("token_hash"),type=query.get("type");
 if(tokenHash && (type==="invite" || type==="recovery")){
  const result=await client.auth.verifyOtp({token_hash:tokenHash,type});
  if(result.error)throw new Error("This setup link is invalid or expired. Ask your Super Admin for a new link.");
 }else if(query.get("code")){
  const result=await client.auth.exchangeCodeForSession(query.get("code")!);
  if(result.error)throw new Error("This setup link could not be verified. Request a new link.");
 }else{
  const result=await client.auth.getSession();
  if(result.error || !result.data.session)throw new Error("Open a valid committee setup link from your email.");
 }
 window.history.replaceState(null,"",window.location.pathname);
}
