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
          !["start","save_draft","mark_verified","return","verify_and_forward","recommend_rejection","reject_application"].includes(String(body.operation)))return reply({error:"Refresh the application before saving."},400);
        let payload:unknown={};
        const operation=String(body.operation),custom=["verify_and_forward","recommend_rejection","reject_application"].includes(operation);
        const privilege=operation==="return"?"applications.return":operation==="reject_application"?"applications.finalize":"applications.verify";
        const confirmed=await verifiedAdministratorAction(request,body.password,privilege);
        if(operation==="reject_application"&&confirmed.user.app_metadata?.role!=="super_admin")return reply({error:"Only Super Admin may record the final decision."},403);
        if(confirmed.user.id!==auth.data.user.id)return reply({error:"Your session changed. Sign in again."},401);
        if(operation==="verify_and_forward")payload=validateVerificationDraft({...(body.payload as Record<string,unknown>),notes:""});
        if(operation==="recommend_rejection"||operation==="reject_application"){
          const reason=(body.payload as Record<string,unknown>)?.reason;
          if(typeof reason!=="string"||!reason.trim()||reason.trim().length>2000)return reply({error:"Enter a member-facing reason of up to 2,000 characters."},400);
          payload={reason:reason.trim()};
        }
        if(body.operation==="save_draft")payload=validateVerificationDraft(body.payload);
        if(body.operation==="return"){
          const correction=body.payload as Record<string,unknown>|null;
          if(!correction || !["documents","information","consent","other"].includes(String(correction.category)) ||
            typeof correction.reason!=="string" || !correction.reason.trim() || correction.reason.trim().length>2000 ||
            !Array.isArray(correction.affectedKinds) || correction.affectedKinds.length>4 ||
            correction.affectedKinds.some(kind=>!["validId","payslip","collateral","supporting"].includes(String(kind))))return reply({error:"Choose a correction category and enter member-visible instructions."},400);
          payload={category:correction.category,reason:correction.reason.trim(),affectedKinds:correction.affectedKinds};
        }
        result=await committeeServiceClient(request).rpc(operation==="reject_application"?"portal_reject_application":custom?"portal_application_action":"application_workflow_action",{p_actor_id:auth.data.user.id,...(custom&&operation!=="reject_application"?{p_operation:operation}:{}),p_args:{applicationId:body.applicationId,operation:body.operation,
          revision:body.revision,stateHash:body.stateHash,payload,requestId:body.requestId}});
      }
    }
    if(result.error){
      const {code,message}=result.error;
      if(code==="PGRST202"||code==="42883")return reply({error:"This action is unavailable until workflow setup is completed. Contact the system administrator. No action was recorded."},503);
      if(code==="42P01")return reply({error:"A required workflow database object is missing. No changes were saved; ask an administrator to review the database migration."},503);
      if(code==="42501")return reply({error:message || "Your account does not have permission for this workflow action."},403);
      if(code==="40001")return reply({error:message || "Verification changed. Refresh before saving."},409);
      if(code==="P0002")return reply({error:"The application is no longer available."},404);
      if(code==="P0001")return reply({error:message},400);
      console.error("[application-workflow] RPC failed",{code,message});
      return reply({error:`The return request failed at the database (${code || "unknown error"}). No changes were saved. Contact the system administrator.`},503);
    }
    if(request.method==="GET"&&params.get("operation")==="evidence"){
      const state=result.data,packetHash=params.get("packetHash");
      if(!state||!uuid(state.applicationUuid)||!packetHash||!/^[0-9a-f]{64}$/i.test(packetHash)||packetHash!==state.packetHash)return reply({error:"The application changed. Refresh before viewing its evidence."},409);
      let evidence=await session.rpc("portal_application_evidence",{p_application_id:state.applicationId??params.get("applicationId"),p_packet_hash:packetHash});
      if(evidence.error?.code==="PGRST202"||evidence.error?.code==="42883")evidence=await session.rpc("application_evidence_details",{p_application_id:state.applicationId??params.get("applicationId"),p_packet_hash:packetHash});
      if(evidence.error)return reply({error:evidence.error.message??"Evidence records could not be loaded. Refresh and retry."},evidence.error.code==="40001"?409:evidence.error.code==="42501"?403:503);
      if(!evidence.data||!Array.isArray(evidence.data.records))return reply({error:"Recorded evidence could not be confirmed. Please retry."},503);
      return reply(evidence.data);
    }
    if(request.method==="GET"&&(params.get("operation")??"application")==="application"&&result.data?.applicationId){
      const delivery=await session.rpc("portal_application_delivery",{p_application_id:result.data.applicationId});
      return reply({...result.data,emailDelivery:delivery.error||!["queued","sent","failed"].every(key=>Number.isSafeInteger(delivery.data?.[key])&&delivery.data[key]>=0)?null:delivery.data});
    }
    return reply(result.data);
  }catch(error){
    if(error instanceof CommitteeError)return reply({error:error.message},error.status);
    if(error instanceof Error && /^(Complete|Choose|Enter|Internal notes|Policy descriptions|The authorization reference)/.test(error.message))return reply({error:error.message},400);
    const errorType=error instanceof Error?error.name:"UnknownError";
    console.error("[application-workflow] Request failed",error);
    return reply({error:`Application workflow failed (${errorType}). Check the server terminal for details.`},503);
  }
}
