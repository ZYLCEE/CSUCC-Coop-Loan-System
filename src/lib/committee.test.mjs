import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const load=(path,imports={})=>{const exports={};new Function("require","exports",ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in imports))throw new Error("Unexpected import "+name);return imports[name];},exports);return exports;};
const roles=load("./auth/roles.ts"),model=load("./committee.ts",{"./auth/roles":roles}),privileges=load("./adminPrivileges.ts"),profile=load("./profileModel.ts");
const uid="10000000-0000-0000-0000-000000000001",requestId="60000000-0000-0000-0000-000000000001",memberId="80000000-0000-0000-0000-000000000001";
const payload={name:"Synthetic Reviewer",email:"REVIEWER@example.invalid",role:"crecom_member",committeeSeat:"member",committeeMemberNumber:1,title:"Member",startsAt:"2026-11-10T00:00:00+08:00",endsAt:null};
const state={};const reset=()=>Object.assign(state,{role:"super_admin",privileged:false,active:true,allowed:true,setupRequired:false,calls:[],passwordError:false,providerError:false,complete:false,confirmed:false,sqlError:null,updatedPasswordError:null});
reset();
const user=()=>({id:uid,email:"actor@example.invalid",app_metadata:{role:state.role,account_status:state.active?"active":"blocked"},user_metadata:{}});
const session={auth:{getUser:async()=>({data:{user:user()},error:null}),getClaims:async()=>({data:{claims:{amr:state.recentLink?[{method:"recovery",timestamp:Date.now()/1000}]:[]}}}),updateUser:async changes=>{state.calls.push({kind:"own-update",changes});return {error:state.updatedPasswordError};}},
 rpc:async(name,args)=>{state.calls.push({kind:"session-rpc",name,args});if(name==="document_staff_access")return {data:state.allowed&&state.active&&(state.role==="super_admin"||state.role==="admin"&&state.privileged),error:null};if(name==="portal_session_access")return {data:{allowed:state.allowed,role:state.role,setupRequired:state.setupRequired},error:null};if(name==="committee_document_location")return {data:{path:"own/pinned.pdf",name:"file.pdf",contentType:"application/pdf"},error:state.sqlError};return {data:[],error:state.sqlError};},
 storage:{from:()=>({createSignedUrl:async(path,ttl)=>{state.calls.push({kind:"signed-url",path,ttl});return {data:{signedUrl:"https://synthetic.example.invalid/file"},error:null};}})}};
const verifier={auth:{signInWithPassword:async()=>{state.calls.push({kind:"verify-password"});return {data:{user:user(),session:state.passwordError?null:{}},error:state.passwordError?{status:400}:null};},signOut:async()=>({error:null}),updateUser:async()=>({error:null})}};
const providerUser=()=>({id:"10000000-0000-0000-0000-000000000004",email:"reviewer@example.invalid",app_metadata:{}});
const service={rpc:async(name,args)=>{
 state.calls.push({kind:"service-rpc",name,args});
 if(name==="committee_complete_setup")return {data:{success:true},error:null};
 if(name!=="committee_account_action")throw new Error("Unexpected service RPC");
 if(args.p_operation==="committee_reserve_invite")return {data:{complete:state.complete,authUserId:null},error:state.sqlError};
 if(args.p_operation==="committee_begin_link")return {data:{complete:false,userId:providerUser().id,email:providerUser().email,confirmed:state.confirmed},error:null};
 return {data:{success:true},error:null};
},auth:{admin:{
 createUser:async input=>{state.calls.push({kind:"create-auth",input});return {data:{user:{...providerUser(),app_metadata:input.app_metadata}},error:null};},
 inviteUserByEmail:async(email,options)=>{state.calls.push({kind:"invite",email,options});return {data:{user:state.providerError?null:providerUser()},error:state.providerError?{code:"email_address_not_authorized",status:400}:null};},
 getUserById:async()=>({data:{user:providerUser()},error:null}),
 updateUserById:async(id,changes)=>{state.calls.push({kind:"authorize",id,changes});return {error:null};}},
 resetPasswordForEmail:async(email,options)=>{state.calls.push({kind:"reset-email",email,options});return {error:null};}}};
const createClient=(_url,key,options)=>key==="synthetic-service"?service:options?.global?.headers?.Authorization?session:verifier;
const sdk={createClient};
const deadlines=load("./requestDeadline.ts");
const server=load("./committeeServer.ts",{"@supabase/supabase-js":sdk,"./adminPrivileges":privileges,"./committee":model,"./requestDeadline":deadlines,"./portalActivityServer":{portalActivityHeaders:()=>({})}});
const management=load("../app/api/admin/committee-accounts/route.ts",{"@/lib/committeeServer":server,"@/lib/requestDeadline":deadlines});
const portal=load("../app/api/committee/route.ts",{"@supabase/supabase-js":sdk,"@/lib/committeeServer":server,"@/lib/committee":model,"@/lib/profileModel":profile,"@/lib/committeeAuthUpdate":{updateCommitteeAuthUser:async(_context,attributes)=>{const result=await session.auth.updateUser(attributes);if(result.error)throw new server.CommitteeError("The password could not be updated.");}}});
process.env.NEXT_PUBLIC_SUPABASE_URL="https://synthetic.example.invalid";process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="synthetic-public";process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-service";
const headers={authorization:"Bearer synthetic","content-type":"application/json"};
const post=(body,path="admin/committee-accounts")=>new Request("https://synthetic.example.invalid/api/"+path,{method:"POST",headers,body:JSON.stringify(body)});
const invite={operation:"invite",requestId,payload,password:"Synthetic-Password1!"};

test("dedicated creation verifies Super Admin, validates temporary credentials and keeps passwords out of SQL/audits",async()=>{
 reset();const body={...invite,operation:"create",identityVerified:true,credentials:{password:"Temporary-Review1!",confirm:"Temporary-Review1!"}};
 assert.equal((await management.POST(post({...body,identityVerified:false}))).status,400);
 assert.equal(state.calls.some(call=>call.kind==="create-auth"),false);
 assert.equal((await management.POST(post({...body,credentials:{password:"weak",confirm:"weak"}}))).status,400);
 reset();assert.equal((await management.POST(post(body))).status,200);
 const created=state.calls.find(call=>call.kind==="create-auth");assert.equal(created.input.app_metadata.role,"crecom_member");assert.equal(created.input.password,body.credentials.password);
 assert.equal(state.calls.some(call=>call.kind==="invite"),false);
 const sql=state.calls.filter(call=>call.kind==="service-rpc");assert.equal(JSON.stringify(sql).includes(body.credentials.password),false);
 assert.equal(sql.find(call=>call.args.p_operation==="committee_reserve_invite").args.p_args.p_payload.provisioningMode,"password");
 reset();state.role="admin";assert.equal((await management.POST(post(body))).status,403);assert.equal(state.calls.some(call=>call.kind==="create-auth"),false);
});
test("committee roles use only trusted app metadata and never acquire administrator privileges",()=>{
 const reviewer={...user(),app_metadata:{role:"crecom_member"},user_metadata:{role:"super_admin",admin_privileges:["accounts.manage"]}};
 assert.equal(model.getCommitteeRole(reviewer),"crecom_member");assert.equal(roles.getAdminRole(reviewer),null);assert.equal(privileges.isActiveAdministrator(reviewer),false);
 assert.equal(model.getCommitteeRole({...reviewer,app_metadata:{}}),null);
 assert.equal(model.getPortalDashboardPath("crecom_member"),"/crecom/dashboard");assert.equal(model.getPortalDashboardPath("bod_member"),"/bod/dashboard");
});
test("membership input validates fields and uses inclusive Manila end dates",()=>{
 assert.equal(model.validateCommitteeInvite(payload).email,"reviewer@example.invalid");
 assert.throws(()=>model.validateCommitteeInvite({...payload,role:"super_admin"}));
 assert.throws(()=>model.validateCommitteeInvite({...payload,endsAt:payload.startsAt}));
 assert.throws(()=>model.validateCommitteeInvite({...payload,name:"Bad\nName"}));
 assert.throws(()=>model.validateCommitteeInvite({...payload,committeeSeat:"chair"}));
 assert.throws(()=>model.validateCommitteeInvite({...payload,role:"bod_member",committeeSeat:"member"}));
 assert.equal(model.validateCommitteeInvite({...payload,role:"bod_member",committeeSeat:"chairperson"}).committeeSeat,"chairperson");
 assert.equal(model.committeePositionLabel("crecom_member","chairperson"),"CRECOM Chairperson");
 assert.equal(model.committeePositionLabel("crecom_member","member",1),"CRECOM Member 1");assert.equal(model.committeePositionLabel("crecom_member","member",2),"CRECOM Member 2");
 for(const committeeMemberNumber of [undefined,null,0,3,"1"])assert.throws(()=>model.validateCommitteeInvite({...payload,committeeMemberNumber}));
 assert.equal(model.validateCommitteeInvite({...payload,committeeSeat:"chairperson"}).committeeMemberNumber,null);
 const dates=model.membershipDates("2026-11-10","2026-11-10");
 assert.equal(Date.parse(dates.endsAt)-Date.parse(dates.startsAt),86400000);
 assert.equal(model.membershipDateInput(dates.endsAt,true),"2026-11-10");
});

test("an Admin with the explicit committee permission can create after own-password verification, without gaining other authority",async()=>{
 reset();state.role="admin";state.privileged=true;
 assert.equal((await management.GET(new Request('https://synthetic.example.invalid/api/admin/committee-accounts',{headers}))).status,200);
 const body={...invite,operation:"create",identityVerified:true,credentials:{password:"Temporary-Review1!",confirm:"Temporary-Review1!"}};
 assert.equal((await management.POST(post(body))).status,200);assert.ok(state.calls.findIndex(call=>call.kind==="verify-password")<state.calls.findIndex(call=>call.kind==="create-auth"));
 assert.equal(state.calls.find(call=>call.kind==="create-auth").input.app_metadata.role,"crecom_member");
 reset();state.role="admin";state.privileged=true;state.passwordError=true;
 assert.equal((await management.POST(post(body))).status,401);assert.equal(state.calls.some(call=>call.kind==="create-auth"),false);
 reset();state.role="admin";state.privileged=true;state.allowed=false;
 assert.equal((await management.POST(post(body))).status,403);assert.equal(state.calls.some(call=>call.kind==="create-auth"),false);
});
test("management endpoints reject missing sessions, ordinary Admins, reviewers and incorrect passwords before invitation",async()=>{
 reset();const missing=await management.GET(new Request("https://synthetic.example.invalid/api/admin/committee-accounts"));assert.equal(missing.status,401);assert.equal(missing.headers.get("cache-control"),"no-store");
 for(const role of ["admin","member","crecom_member","bod_member"]){reset();state.role=role;assert.equal((await management.POST(post(invite))).status,403);assert.equal(state.calls.some(call=>call.kind==="invite"),false);}
 reset();state.passwordError=true;assert.equal((await management.POST(post(invite))).status,401);assert.equal(state.calls.some(call=>call.kind==="service-rpc"),false);
 reset();assert.equal((await management.POST(post({...invite,password:undefined}))).status,400);
});
test("invitation sets the exact trusted role, uses a personal setup URL, and invokes service-only mutations after password verification",async()=>{
 reset();const response=await management.POST(post(invite));assert.equal(response.status,200);
 const verify=state.calls.findIndex(call=>call.kind==="verify-password"),reserve=state.calls.findIndex(call=>call.kind==="service-rpc");assert.ok(verify>=0&&reserve>verify);
 const mail=state.calls.find(call=>call.kind==="invite");assert.equal(mail.email,"reviewer@example.invalid");assert.equal(mail.options.redirectTo,"https://synthetic.example.invalid/auth/committee-setup");assert.equal("password" in mail.options,false);
 const update=state.calls.find(call=>call.kind==="authorize");assert.equal(update.changes.app_metadata.role,"crecom_member");assert.equal(update.changes.app_metadata.committee_invitation_request_id,requestId);
 assert.equal(state.calls.some(call=>call.kind==="session-rpc"&&!["portal_session_access","document_staff_access"].includes(call.name)),false);
 assert.equal(JSON.stringify(await response.json()).includes("Synthetic-Password1!"),false);
});
test("failed provider requests retain their request ID for retry and completed replays send no mail",async()=>{
 reset();state.providerError=true;assert.equal((await management.POST(post(invite))).status,503);
 assert.equal(state.calls.find(call=>call.args?.p_operation==="committee_request_failed").args.p_args.p_request_id,requestId);
 reset();state.complete=true;assert.equal((await management.POST(post(invite))).status,200);assert.equal(state.calls.some(call=>call.kind==="invite"),false);
 reset();state.sqlError={code:"P0001",message:"BOD membership requires an approved policy."};assert.equal((await management.POST(post({...invite,payload:{...payload,role:"bod_member"}}))).status,400);assert.equal(state.calls.some(call=>call.kind==="invite"),false);
});
test("BOD chairperson creation follows the validated account flow without requiring policy activation",async()=>{
 reset();
 const body={...invite,operation:"create",identityVerified:true,payload:{...payload,role:"bod_member",committeeSeat:"chairperson",committeeMemberNumber:null},credentials:{password:"Synthetic-Temporary1!",confirm:"Synthetic-Temporary1!"}};
 const response=await management.POST(post(body));assert.equal(response.status,200);
 const create=state.calls.find(call=>call.kind==="create-auth");assert.equal(create.input.app_metadata.role,"bod_member");
 const reserve=state.calls.find(call=>call.args?.p_operation==="committee_reserve_invite");
 assert.equal(reserve.args.p_args.p_payload.committeeSeat,"chairperson");assert.equal(reserve.args.p_args.p_payload.committeeMemberNumber,null);
 assert.equal(state.calls.some(call=>/activate_policy/.test(call.name??call.args?.p_operation??"")),false);
});

test("setup links select reset email for confirmed reviewers and do not expose provider links",async()=>{
 reset();state.confirmed=true;const response=await management.POST(post({operation:"link",id:memberId,revision:2,requestId,password:invite.password}));assert.equal(response.status,200);
 assert.equal(state.calls.filter(call=>call.kind==="reset-email").length,1);assert.equal(state.calls.filter(call=>call.kind==="invite").length,0);
});
test("case denial cannot generate a signed URL and assigned file requests use session RLS with five-minute expiry",async()=>{
 reset();state.role="crecom_member";state.sqlError={code:"42501",message:"Access is no longer available."};
 const url="https://synthetic.example.invalid/api/committee?operation=file&assignmentId="+memberId+"&documentId="+requestId;
 assert.equal((await portal.GET(new Request(url,{headers}))).status,403);assert.equal(state.calls.some(call=>call.kind==="signed-url"),false);
 state.sqlError=null;assert.equal((await portal.GET(new Request(url,{headers}))).status,200);assert.equal(state.calls.find(call=>call.kind==="signed-url").ttl,300);
});
test("setup completion occurs only after a successful provider password change and existing accounts require a fresh link",async()=>{
 reset();state.role="crecom_member";state.allowed=false;state.setupRequired=true;
 const body={operation:"setup",password:"New-Synthetic1!",confirm:"New-Synthetic1!"};
 state.updatedPasswordError={code:"weak_password"};assert.equal((await portal.POST(post(body,"committee"))).status,400);assert.equal(state.calls.some(call=>call.name==="committee_complete_setup"),false);
 state.calls=[];state.updatedPasswordError=null;assert.equal((await portal.POST(post(body,"committee"))).status,200);
 assert.ok(state.calls.findIndex(call=>call.kind==="own-update")<state.calls.findIndex(call=>call.name==="committee_complete_setup"));
 reset();state.role="crecom_member";state.setupRequired=false;state.recentLink=false;assert.equal((await portal.POST(post(body,"committee"))).status,403);
 state.recentLink=true;assert.equal((await portal.POST(post(body,"committee"))).status,200);
});
