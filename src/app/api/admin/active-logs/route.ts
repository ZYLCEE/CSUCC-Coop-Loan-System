import {createClient} from "@supabase/supabase-js";
import {activeLogIdentityRole} from "@/lib/accountPresentation";
import {activeLogFilters} from "@/lib/activeLogs";
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request){
 try{
  const authorization=request.headers.get("authorization");
  const token=authorization?.match(/^Bearer\s+/i)?authorization.replace(/^Bearer\s+/i,""):null;
  if(!token)return reply({error:"Sign in to continue."},401);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return reply({error:"Active Logs is unavailable."},503);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
  const auth=await client.auth.getUser(token);if(auth.error||!auth.data.user)return reply({error:"Your session expired."},401);
  if(!activeLogIdentityRole(auth.data.user))return reply({error:"An active cooperative account is required."},403);
  let filters;try{filters=activeLogFilters(new URL(request.url).searchParams);}catch{return reply({error:"Choose a valid search, role and date range."},400);}
  const result=await client.rpc("read_portal_active_logs",{p_search:filters.search,p_role:filters.role,p_from:filters.from?filters.from+"T00:00:00+08:00":null,p_to:filters.to?new Date(Date.parse(filters.to+"T00:00:00+08:00")+86400000).toISOString():null,p_page:filters.page,p_page_size:filters.pageSize});
  if(result.error){
   return reply({error:"Active Logs could not be loaded. Retry shortly."},result.error.code==="42501"?403:503);
  }
  return reply(result.data);
 }catch{return reply({error:"Active Logs could not be loaded. Retry shortly."},503);}
}
