import {createClient} from "@supabase/supabase-js";
import {isActiveAdministrator} from "@/lib/adminPrivileges";
import {validateVerificationDraft,validateWorkflowPolicy} from "@/lib/applicationWorkflow";
import {verifiedAdministratorAction,committeeServiceClient,CommitteeError} from "@/lib/committeeServer";

const uuid=(value:unknown):value is string=>typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request){return handle(request);}
export async function POST(request:Request){return handle(request);}
async function handle(request:Request){
  try{
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!url || !key)return reply({error:"Application verification is unavailable."},503);
    const token=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if(!token)return reply({error:"Sign in to continue."},401);
    const session=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
    const auth=await session.auth.getUser(token);
    if(auth.error || !auth.data.user)return reply({error:"Your session expired. Sign in again."},401);
    if(!isActiveAdministrator(auth.data.user))return reply({error:"Active administrator access is required."},403);
    const params=new URL(request.url).searchParams;
    let result;
    if(request.method==="GET"){
      const operation=params.get("operation") ?? "application";
      if(operation==="summary")result=await session.rpc("application_workflow_summaries");
      else if(operation==="policies")result=await session.rpc("get_approval_workflow_policies");
      else{
        const applicationId=params.get("applicationId") ?? "";
        if(!["application","evidence"].includes(operation) || !applicationId.trim() || applicationId.length>100)return reply({error:"Choose a valid application."},400);
        result=await session.rpc("get_application_verification",{p_application_id:applicationId});
      }
    }else{
      const raw=await request.text();
      if(raw.length>16000)return reply({error:"The verification request is too large."},413);
      let body:Record<string,unknown>;
      try{body=JSON.parse(raw);}catch{return reply({error:"The verification request is invalid."},400);}
      if(!body || typeof body!=="object" || Array.isArray(body) || !uuid(body.requestId))return reply({error:"Choose a valid verification request."},400);
      if(body.operation==="policy_draft"){
        if(body.expectedLatestId!==null && !uuid(body.expectedLatestId))return reply({error:"Reload the policy draft before saving."},400);
        const payload=validateWorkflowPolicy(body.payload);
        result=await session.rpc("save_approval_policy_draft",{p_expected_latest_id:body.expectedLatestId,p_payload:payload,p_request_id:body.requestId});
      }else{
        if(typeof body.applicationId!=="string" || !body.applicationId.trim() || body.applicationId.length>100 ||
          !Number.isSafeInteger(body.revision) || Number(body.revision)<0 || typeof body.stateHash!=="string" || !/^[0-9a-f]{64}$/i.test(body.stateHash) ||
          !["start","save_draft","mark_verified","return"].includes(String(body.operation)))return reply({error:"Refresh the application before saving."},400);
        let payload:unknown={};
        if(body.operation==="save_draft")payload=validateVerificationDraft(body.payload);
        if(body.operation==="return"){
          const correction=body.payload as Record<string,unknown>|null;
          if(!correction || !["documents","information","consent","other"].includes(String(correction.category)) ||
            typeof correction.reason!=="string" || !correction.reason.trim() || correction.reason.trim().length>2000 ||
            !Array.isArray(correction.affectedKinds) || correction.affectedKinds.length>4 ||
            correction.affectedKinds.some(kind=>!["validId","payslip","collateral","supporting"].includes(String(kind))))return reply({error:"Choose a correction category and enter member-visible instructions."},400);
          payload={category:correction.category,reason:correction.reason.trim(),affectedKinds:correction.affectedKinds};
          const confirmed=await verifiedAdministratorAction(request,body.password,"applications.return");
          if(confirmed.user.id!==auth.data.user.id)return reply({error:"Your session changed. Sign in again."},401);
        }
        result=await committeeServiceClient(request).rpc("application_workflow_action",{p_actor_id:auth.data.user.id,p_args:{applicationId:body.applicationId,operation:body.operation,
          revision:body.revision,stateHash:body.stateHash,payload,requestId:body.requestId}});
      }
    }
    if(result.error){
      const {code,message}=result.error;
      if(code==="42501")return reply({error:message || "Your account does not have permission for this workflow action."},403);
      if(code==="40001")return reply({error:message || "Verification changed. Refresh before saving."},409);
      if(code==="P0002")return reply({error:"The application is no longer available."},404);
      if(code==="P0001")return reply({error:message},400);
      return reply({error:"Application verification is unavailable. Refresh and retry."},503);
    }
    if(request.method==="GET"&&params.get("operation")==="evidence"){
      const state=result.data,packetHash=params.get("packetHash");
      if(!state||!uuid(state.applicationUuid)||!packetHash||!/^[0-9a-f]{64}$/i.test(packetHash)||packetHash!==state.packetHash)return reply({error:"The application changed. Refresh before viewing its evidence."},409);
      const evidence=await session.rpc("application_evidence_details",{p_application_id:state.applicationId??params.get("applicationId"),p_packet_hash:packetHash});
      if(evidence.error)return reply({error:evidence.error.message??"Evidence records could not be loaded. Refresh and retry."},evidence.error.code==="40001"?409:evidence.error.code==="42501"?403:503);
      return reply(evidence.data);
    }
    return reply(result.data);
  }catch(error){
    if(error instanceof CommitteeError)return reply({error:error.message},error.status);
    if(error instanceof Error && /^(Complete|Choose|Enter|Internal notes|Policy descriptions|The authorization reference)/.test(error.message))return reply({error:error.message},400);
    return reply({error:"Application verification is unavailable. Refresh and retry."},503);
  }
}
