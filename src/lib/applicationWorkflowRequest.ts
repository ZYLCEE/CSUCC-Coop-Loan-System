import {getSupabaseClient} from "./supabase";
export async function workflowRequest<T>(query="",init:RequestInit={}):Promise<T>{
  const {data}=await getSupabaseClient().auth.getSession();
  if(!data.session)throw new Error("Your session expired. Sign in again.");
  const headers=new Headers(init.headers);headers.set("Authorization","Bearer "+data.session.access_token);
  if(init.body)headers.set("Content-Type","application/json");
  const response=await fetch("/api/admin/application-workflow"+(query?"?"+query:""),{...init,headers,cache:"no-store"});
  let result: unknown = null;
  try { result=await response.json(); } catch { /* A stale dev server can respond with an HTML 404 page. */ }
  if(!response.ok){
    const message=typeof result==="object"&&result!==null&&"error" in result&&typeof result.error==="string"?result.error:"Application verification is unavailable. Refresh and retry.";
    throw new Error(message);
  }
  if(result===null)throw new Error("The application workflow returned an invalid response. Refresh and retry.");
  return result as T;
}
