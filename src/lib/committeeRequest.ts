import {getSupabaseClient} from "./supabase";
import {withRequestDeadline} from "./requestDeadline";
export async function committeeRequest<T>(query="",init:RequestInit={},management=false):Promise<T>{
 return withRequestDeadline(async signal=>{
  const {data}=await getSupabaseClient().auth.getSession();
  signal.throwIfAborted();
  if(!data.session)throw new Error("Your session expired. Sign in again.");
  const headers=new Headers(init.headers);headers.set("Authorization","Bearer "+data.session.access_token);
  if(init.body)headers.set("Content-Type","application/json");
  const response=await fetch((management?"/api/admin/committee-accounts":"/api/committee")+(query?"?"+query:""),{...init,headers,cache:"no-store",signal});
  let dataResponse;
  try{dataResponse=await response.json();}catch{signal.throwIfAborted();throw new Error(management?"The committee service returned an incomplete response. Refresh Committee Accounts to check its status before retrying.":"The committee service returned an incomplete response. Refresh this page to check its status before retrying.");}
  if(!response.ok)throw new Error(dataResponse?.error??"Committee service is unavailable. Refresh and retry.");
  return dataResponse as T;
 },60000,management?"The committee request took too long. Refresh Committee Accounts to check its status, then retry the saved request.":"The committee request took too long. Refresh this page to check its status before retrying.",init.signal);
}
