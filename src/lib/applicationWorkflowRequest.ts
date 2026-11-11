import {getSupabaseClient} from "./supabase";
export async function workflowRequest<T>(query="",init:RequestInit={}):Promise<T>{
  const {data}=await getSupabaseClient().auth.getSession();
  if(!data.session)throw new Error("Your session expired. Sign in again.");
  const headers=new Headers(init.headers);headers.set("Authorization","Bearer "+data.session.access_token);
  if(init.body)headers.set("Content-Type","application/json");
  const response=await fetch("/api/admin/application-workflow"+(query?"?"+query:""),{...init,headers,cache:"no-store"});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error ?? "Application verification is unavailable. Refresh and retry.");
  return result as T;
}
