"use client";
import {getSupabaseClient} from "./supabase";
export type PortalSessionState={id:string;expiresAt:string;serverTime:string};
export async function portalSessionAction(operation:"start"|"touch"|"logout",idleSeconds=0){
  const {data}=await getSupabaseClient().auth.getSession();if(!data.session)throw new Error("Sign in to continue.");
  const response=await fetch("/api/portal-session",{method:"POST",headers:{Authorization:"Bearer "+data.session.access_token,"Content-Type":"application/json"},body:JSON.stringify({operation,idleSeconds}),cache:"no-store"});
  const result=await response.json();
  if(!response.ok){const error=new Error(result.error??"Portal session could not be checked.");Object.assign(error,{status:response.status});throw error;}
  return result as PortalSessionState;
}
