import {getSupabaseClient} from "@/lib/supabase";
export type DashboardFinancials={pending:number;collections:number;disbursement:number|null};
export async function fetchDashboardFinancials(start:string,end:string):Promise<DashboardFinancials>{
 const {data,error}=await getSupabaseClient().rpc("portal_dashboard_totals",{p_start:start,p_end:end});
 if(error)throw new Error(error.code==="PGRST202"?"Dashboard reporting setup is pending. Confirmed totals are unavailable.":"Confirmed dashboard totals could not be loaded. Please retry.");
 if(!data||!Number.isSafeInteger(data.pending)||data.pending<0||![data.collections,data.disbursement].every(value=>value===null||typeof value==="number"&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100)))||data.collections===null)throw new Error("The reporting service returned incomplete totals. Please retry.");
 return data;
}
