import {getSupabaseClient} from "./supabase";
export async function reviewRequest<T>(query="",init:RequestInit={},endpoint:"/api/admin/reviews"|"/api/admin/loan-release"="/api/admin/reviews"):Promise<T>{
 const {data}=await getSupabaseClient().auth.getSession();
 if(!data.session)throw new Error("Your session expired. Sign in again.");
 const headers=new Headers(init.headers);headers.set("Authorization","Bearer "+data.session.access_token);
 if(init.body)headers.set("Content-Type","application/json");
 const response=await fetch(endpoint+(query?"?"+query:""),{...init,headers,cache:"no-store"});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error??"The review request could not be completed. Refresh and retry.");
 return result as T;
}
