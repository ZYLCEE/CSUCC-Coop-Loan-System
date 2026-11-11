import {getSupabaseClient} from "./supabase";
import type {ActiveLogFilters,ActiveLogPage} from "./activeLogs";
export async function fetchActiveLogs(filters:ActiveLogFilters,signal?:AbortSignal):Promise<ActiveLogPage>{
 const {data}=await getSupabaseClient().auth.getSession();if(!data.session)throw new Error("Sign in to view Active Logs.");
 const query=new URLSearchParams({...filters,page:String(filters.page),pageSize:String(filters.pageSize)});
 const response=await fetch("/api/active-logs?"+query,{headers:{Authorization:"Bearer "+data.session.access_token},cache:"no-store",signal});
 const result=await response.json();if(!response.ok)throw new Error(result.error??"Active Logs could not be loaded.");return result;
}
export function watchActiveLogs(onChange:()=>void,onStatus:(connected:boolean)=>void){
 const client=getSupabaseClient();
 const channel=client.channel("portal-active-logs-"+crypto.randomUUID())
  .on("postgres_changes",{event:"INSERT",schema:"public",table:"portal_active_log_entries"},onChange)
  .on("postgres_changes",{event:"*",schema:"public",table:"portal_log_sessions"},onChange)
  .subscribe(status=>{const connected=status==="SUBSCRIBED";onStatus(connected);if(connected)onChange();});
 return()=>{void client.removeChannel(channel);};
}
