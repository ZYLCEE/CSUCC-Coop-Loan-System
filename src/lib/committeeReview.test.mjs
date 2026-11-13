import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const load=(path,imports={})=>{const exports={};new Function("require","exports",ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in imports))throw new Error("Unexpected import "+name);return imports[name];},exports);return exports;};
const model=load("./committeeReview.ts"),privileges=load("./adminPrivileges.ts"),roles=load("./auth/roles.ts"),committee=load("./committee.ts",{"./auth/roles":roles});
const id="10000000-0000-0000-0000-000000000001",assignment="b0000000-0000-0000-0000-000000000001",requestId="d0000000-0000-0000-0000-000000000001";
const rules={crecomApprovals:3,bodReviewers:1,bodApprovals:1,finalMode:"super_admin",allowOverride:false,bodAuthority:"recommendation",signatoryLayout:"manual_form_v1",allResponses:true,ruleReference:"Synthetic approved rules reference"};
const base={applicationId:"APP-TEST",revision:1,stateHash:"a".repeat(64),requestId};
const state={};const reset=()=>Object.assign(state,{role:"crecom_member",active:true,allowed:true,forward:false,finalize:false,badPassword:false,revokedAfterPassword:false,sqlError:null,legacyError:null,crecomApprovals:3,packetDenied:false,existingBodDecision:false,calls:[]});reset();
const user=()=>({id,email:"reviewer@example.invalid",app_metadata:{role:state.role,account_status:state.active?"active":"blocked"},user_metadata:{}});
const session={auth:{getUser:async()=>({data:{user:user()},error:null})},rpc:async(name,args)=>{
 state.calls.push({kind:"session",name,args});
 if(name==="release_approved_loan")return {data:state.legacyError?null:{application_id:"APP-TEST",status:"released",net_proceeds:985},error:state.legacyError};
 if(name==="committee_review_packet")return {data:{assignment:{id:assignment,applicationId:"APP-TEST",stage:"BOD"},myDecision:state.existingBodDecision?{decision:"approve"}:null},error:state.packetDenied?{code:"42501",message:"Assignment access revoked"}:null};
 if(name==="portal_session_access")return {data:{allowed:state.allowed,role:state.role},error:null};
 if(name==="document_staff_access")return {data:state.role==="super_admin"||(args.p_privilege==="applications.finalize"?state.finalize:state.forward),error:null};
 return {data:{cycles:[],rules},error:state.sqlError};
}};
const verifier={auth:{signInWithPassword:async()=>{
 state.calls.push({kind:"password"});if(state.revokedAfterPassword)state.allowed=false;
 return {data:{user:user(),session:state.badPassword?null:{}},error:state.badPassword?{status:400}:null};
},signOut:async()=>({error:null})}};
const service={rpc:async(name,args)=>{state.calls.push({kind:"service",name,args});return {data:{success:true},error:state.sqlError};}};
const sdk={createClient:(_url,key,options)=>key==="synthetic-service"?service:options?.global?.headers?.Authorization?session:verifier};
const server=load("./committeeServer.ts",{"@supabase/supabase-js":sdk,"./adminPrivileges":privileges,"./committee":committee,"./requestDeadline":load("./requestDeadline.ts"),"./portalActivityServer":{portalActivityHeaders:()=>({})}});
const api=load("../app/api/admin/reviews/route.ts",{"@supabase/supabase-js":sdk,"@/lib/committeeServer":server,"@/lib/adminPrivileges":privileges,"@/lib/committee":committee,"@/lib/committeeReview":model,"@/lib/committeeProgressServer":{withCommitteeApprovalProgress:async(_service,rows)=>{state.calls.push({kind:"crecom-proof"});return rows.map(row=>({...row,crecomConfirmations:Array.from({length:state.crecomApprovals},()=>({decision:"approve"}))}));}}});
const workflowModel=load("./applicationWorkflow.ts");
const workflowApi=load("../app/api/admin/application-workflow/route.ts",{"@supabase/supabase-js":sdk,"@/lib/committeeServer":server,"@/lib/adminPrivileges":privileges,"@/lib/applicationWorkflow":workflowModel});
const releaseApi=load("../app/api/admin/loan-release/route.ts",{"@/lib/committeeServer":server});
process.env.NEXT_PUBLIC_SUPABASE_URL="https://synthetic.example.invalid";process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="synthetic-public";process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-service";
const headers={authorization:"Bearer synthetic","content-type":"application/json"};
const post=body=>new Request("https://synthetic.example.invalid/api/admin/reviews",{method:"POST",headers,body:JSON.stringify(body)});
const approve={...base,operation:"approve",payload:{assignmentId:assignment,reason:"Reviewed.",confirmed:true},password:"Synthetic-Password1!"};
test("policy activation preserves 3-of-3 CRECOM, Super Admin final authority and no failed-panel override",()=>{
 assert.equal(model.validateExecutionRules(rules).crecomApprovals,3);
 for(const patch of [{crecomApprovals:2},{finalMode:"committee_binding"},{allowOverride:true},{allResponses:false},{ruleReference:""},{bodReviewers:3},{bodApprovals:2},{signatoryLayout:undefined},{bodAuthority:"pending"}])assert.throws(()=>model.validateExecutionRules({...rules,...patch}));
});
test("decision validation requires explicit packet acknowledgment and strips forged authority fields",()=>{
 assert.throws(()=>model.validateReviewMutation({...approve,payload:{assignmentId:assignment}}));
 assert.throws(()=>model.validateReviewMutation({...approve,operation:"reject",payload:{...approve.payload,reason:" "}}));
 assert.throws(()=>model.validateReviewMutation({...base,operation:"forward",payload:{reviewers:[assignment],dueAt:null,bodRequired:false,routingReason:""}}));
 const parsed=model.validateReviewMutation({...approve,actorId:"forged",payload:{...approve.payload,reviewerAuthId:"forged",decisionTime:"2030",signature:"forged"}});
 assert.deepEqual(parsed.payload,{assignmentId:assignment,reason:"Reviewed.",confirmed:true});assert.equal("password" in parsed,false);
 assert.throws(()=>model.validateReviewMutation({...base,operation:"forward",payload:{reviewers:[assignment,assignment],dueAt:null,bodRequired:true,routingReason:""}}));
});
test("review state requires an administrator and all responses are private and uncached",async()=>{
 reset();const missing=await api.GET(new Request("https://synthetic.example.invalid/api/admin/reviews?applicationId=APP-TEST"));assert.equal(missing.status,401);assert.equal(missing.headers.get("cache-control"),"no-store");
 assert.equal((await api.GET(new Request("https://synthetic.example.invalid/api/admin/reviews?applicationId=APP-TEST",{headers}))).status,403);
 state.role="admin";assert.equal((await api.GET(new Request("https://synthetic.example.invalid/api/admin/reviews?applicationId=APP-TEST",{headers}))).status,200);
});
test("reviewer decisions need the current account password and membership after verification",async()=>{
 for(const patch of [{badPassword:true},{allowed:false},{role:"member"},{revokedAfterPassword:true}]){reset();Object.assign(state,patch);assert.ok([401,403].includes((await api.POST(post(approve))).status));assert.equal(state.calls.some(call=>call.kind==="service"),false);}
 reset();assert.equal((await api.POST(post({...approve,password:""}))).status,400);
 reset();assert.equal((await api.POST(post(approve))).status,200);
 const call=state.calls.find(call=>call.kind==="service");assert.equal(call.name,"committee_review_action");assert.equal(call.args.p_actor_id,id);assert.equal(call.args.p_operation,"approve");assert.equal(JSON.stringify(call.args).includes("Synthetic-Password1!"),false);
 assert.ok(state.calls.findIndex(call=>call.kind==="password")<state.calls.findIndex(call=>call.kind==="service"));
});
test("Admin forwarding requires permission and password; final authority remains Super Admin",async()=>{
 const forward={...base,operation:"forward",password:approve.password,payload:{reviewers:[assignment,"b0000000-0000-0000-0000-000000000002","b0000000-0000-0000-0000-000000000003"],dueAt:null,bodRequired:true,routingReason:""}};
 reset();state.role="admin";assert.equal((await api.POST(post(forward))).status,403);assert.equal(state.calls.some(call=>call.kind==="service"),false);
 state.forward=true;assert.equal((await api.POST(post({...forward,password:undefined}))).status,400);assert.equal((await api.POST(post(forward))).status,200);
 assert.equal((await api.POST(post({...base,operation:"finalize",payload:{decision:"approve",reason:"Ready"},password:"Synthetic-Password1!"}))).status,403);
 state.finalize=true;assert.equal((await api.POST(post({...base,operation:"finalize",payload:{decision:"approve",reason:"Ready"},password:"Synthetic-Password1!"}))).status,403);
});
test("policy activation and final decisions require password-verified Super Admin service dispatch",async()=>{
 reset();state.role="super_admin";
 const body={operation:"activate_policy",policyId:assignment,requestId,rules,password:"Synthetic-Password1!"};
 assert.equal((await api.POST(post({...body,password:""}))).status,400);
 state.badPassword=true;assert.equal((await api.POST(post(body))).status,401);assert.equal(state.calls.some(call=>call.kind==="service"),false);
 reset();state.role="super_admin";assert.equal((await api.POST(post(body))).status,200);assert.equal(state.calls.find(call=>call.kind==="service").args.p_operation,"activate_policy");
});
test("stale review errors are recoverable conflicts without changing the chosen request identity",async()=>{
 reset();state.sqlError={code:"40001",message:"The review changed. Refresh before continuing."};
 const response=await api.POST(post(approve));assert.equal(response.status,409);assert.equal(state.calls.find(call=>call.kind==="service").args.p_args.requestId,requestId);
});

test("return requires the acting administrator's password, preserves the reason and never dispatches credentials to SQL",async()=>{
 const body={...base,operation:"return",payload:{category:"information",reason:"Correct the missing requirement.",affectedKinds:[]}};
 reset();state.role="admin";state.forward=true;
 assert.equal((await workflowApi.POST(post(body))).status,400);
 state.badPassword=true;assert.equal((await workflowApi.POST(post({...body,password:"wrong"}))).status,401);
 assert.equal(state.calls.some(call=>call.kind==="service"),false);
 state.badPassword=false;assert.equal((await workflowApi.POST(post({...body,password:"Synthetic-Password1!"}))).status,200);
 const saved=state.calls.find(call=>call.kind==="service");assert.equal(saved.name,"application_workflow_action");assert.equal(saved.args.p_actor_id,id);assert.equal(saved.args.p_args.payload.reason,body.payload.reason);assert.equal(JSON.stringify(saved).includes("Synthetic-Password1!"),false);
});

test("release requires own-password confirmation and its separate permission; SQL receives only validated release details",async()=>{
 const body={applicationId:"APP-TEST",requestId,date:"2026-11-11",reference:"DV-1",amount:1000,notes:"Voucher checked",password:"Synthetic-Password1!"};
 reset();state.role="admin";assert.equal((await releaseApi.POST(post(body))).status,403);
 state.forward=true;state.badPassword=true;assert.equal((await releaseApi.POST(post(body))).status,401);assert.equal(state.calls.some(call=>call.kind==="service"),false);
 state.badPassword=false;assert.equal((await releaseApi.POST(post(body))).status,200);
 const saved=state.calls.find(call=>call.kind==="service");assert.equal(saved.name,"loan_release_action");assert.equal(saved.args.p_actor_id,id);assert.equal(saved.args.p_args.amount,1000);assert.equal(JSON.stringify(saved).includes(body.password),false);
});

const releaseBody={applicationId:"APP-TEST",requestId,date:"2026-11-11",reference:" DV-1 ",amount:1000,notes:"Voucher checked",password:"Synthetic-Password1!"};
test("a missing release dispatcher uses the existing atomic procedure with the password-verified caller JWT",async()=>{
 reset();state.role="super_admin";state.sqlError={code:"PGRST202",message:"Missing loan_release_action"};
 const response=await releaseApi.POST(post(releaseBody));assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{application_id:"APP-TEST",status:"released",net_proceeds:985});
 const call=state.calls.find(call=>call.name==="release_approved_loan");
 assert.equal(call.kind,"session");assert.deepEqual(call.args,{p_application_id:"APP-TEST",p_request_id:requestId,p_date:"2026-11-11",p_reference:"DV-1",p_expected_amount:1000,p_notes:"Voucher checked"});
 assert.ok(state.calls.findIndex(call=>call.kind==="password")<state.calls.indexOf(call));
 assert.equal(JSON.stringify(call).includes(releaseBody.password),false);
 assert.equal(state.calls.filter(call=>call.name==="release_approved_loan").length,1);
});
test("release compatibility never retries permission failures, business failures, inner SQL errors, or ambiguous timeouts",async()=>{
 for(const error of [null,{code:"42501",message:"Denied"},{code:"P0001",message:"Not approved"},{code:"42883",message:"Missing dependency"},{code:"57014",message:"Timeout"},{code:"23505",message:"Duplicate"}]){
  reset();state.role="super_admin";state.sqlError=error;
  const response=await releaseApi.POST(post(releaseBody));assert.equal(response.status,error?error.code==="42501"?403:error.code==="P0001"?400:error.code==="23505"?409:503:200);
  assert.equal(state.calls.some(call=>call.name==="release_approved_loan"),false);
 }
});
test("compatibility preserves legacy release errors and never reports a release that failed",async()=>{
 for(const [error,status] of [[{code:"23505",message:"Duplicate reference"},409],[{code:"42501",message:"Super Admin access required."},403],[{code:"P0001",message:"Only approved loans can be released."},400],[{code:"PGRST202",message:"Missing procedure"},503]]){
  reset();state.role="super_admin";state.sqlError={code:"PGRST202"};state.legacyError=error;
  const response=await releaseApi.POST(post(releaseBody));assert.equal(response.status,status);assert.ok((await response.json()).error);
 }
});
test("compatibility still requires the current account password, active access, permission and valid input",async()=>{
 for(const patch of [{role:"member"},{role:"admin",forward:false},{role:"super_admin",badPassword:true},{role:"super_admin",active:false}]){
  reset();Object.assign(state,patch,{sqlError:{code:"PGRST202"}});
  assert.ok([401,403].includes((await releaseApi.POST(post(releaseBody))).status));assert.equal(state.calls.some(call=>call.kind==="service"||call.name==="release_approved_loan"),false);
 }
 reset();state.role="super_admin";assert.equal((await releaseApi.POST(post({...releaseBody,requestId:"bad"}))).status,400);assert.equal(state.calls.length,0);
});

test("BOD decisions verify the assigned application and three CRECOM confirmations before mutation",async()=>{
 reset();state.role="bod_member";state.crecomApprovals=2;
 assert.equal((await api.POST(post(approve))).status,409);assert.equal(state.calls.some(call=>call.kind==="service"),false);
 reset();state.role="bod_member";state.packetDenied=true;
 assert.equal((await api.POST(post(approve))).status,403);assert.equal(state.calls.some(call=>call.kind==="crecom-proof"||call.kind==="service"),false);
 reset();state.role="bod_member";
 assert.equal((await api.POST(post(approve))).status,200);
 assert.ok(state.calls.findIndex(call=>call.kind==="password")<state.calls.findIndex(call=>call.kind==="crecom-proof"));
 assert.ok(state.calls.findIndex(call=>call.kind==="crecom-proof")<state.calls.findIndex(call=>call.kind==="service"));
 reset();state.role="bod_member";state.existingBodDecision=true;
 assert.equal((await api.POST(post(approve))).status,200);assert.equal(state.calls.some(call=>call.kind==="crecom-proof"),false);
});


test("combined verification requires the current password and never dispatches credentials to SQL",async()=>{
 reset();state.role="admin";state.forward=true;
 const verify={...base,operation:"verify_and_forward",payload:{checks:{identity:true,eligibility:true,terms:true}}};
 assert.equal((await workflowApi.POST(post(verify))).status,400);assert.equal(state.calls.some(call=>call.kind==="service"),false);
 assert.equal((await workflowApi.POST(post({...verify,password:approve.password}))).status,200);
 const dispatch=state.calls.find(call=>call.kind==="service");assert.equal(dispatch.name,"portal_application_action");assert.equal(dispatch.args.p_operation,"verify_and_forward");assert.equal(JSON.stringify(dispatch.args).includes(approve.password),false);
 reset();state.role="admin";state.forward=true;state.finalize=true;
 assert.equal((await workflowApi.POST(post({...verify,operation:"reject_application",password:approve.password,payload:{reason:"Not eligible"}}))).status,403);
 assert.equal(state.calls.some(call=>call.kind==="service"),false);
});


test("standalone rejection dispatch requires own password, omits credentials and never falls back to legacy decisions",async()=>{
 reset();state.role="super_admin";
 const rejection={...base,operation:"reject_application",payload:{reason:"Synthetic rejection explanation"}};
 assert.equal((await workflowApi.POST(post(rejection))).status,400);assert.equal(state.calls.some(call=>call.kind==="service"),false);
 state.badPassword=true;assert.equal((await workflowApi.POST(post({...rejection,password:approve.password}))).status,401);
 state.badPassword=false;state.calls=[];
 assert.equal((await workflowApi.POST(post({...rejection,password:approve.password}))).status,200);
 const dispatch=state.calls.find(call=>call.kind==="service");assert.equal(dispatch.name,"portal_reject_application");assert.equal("p_operation" in dispatch.args,false);assert.equal(JSON.stringify(dispatch.args).includes(approve.password),false);
 state.sqlError={code:"PGRST202",message:"Missing function"};state.calls=[];
 const response=await workflowApi.POST(post({...rejection,password:approve.password}));assert.equal(response.status,503);assert.match((await response.json()).error,/No action was recorded/);
 assert.deepEqual(state.calls.filter(call=>call.kind==="service").map(call=>call.name),["portal_reject_application"]);reset();
});
