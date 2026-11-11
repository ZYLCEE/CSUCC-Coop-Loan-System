import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import { applyReasonPatches } from "./prepare-account-reasons-backend.mjs";
const source=readFileSync(process.env.COOP_SECURE_ACTION_SOURCE??"../coop_backend/supabase/edge-functions/secure-admin-action/index.ts","utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const actorId="11111111-1111-4111-8111-111111111111", targetId="22222222-2222-4222-8222-222222222222";
const base={mode:"verify",action:"block-account",target:"CSUCC-2026-0001",payload:{reason:"  Recorded synthetic reason  "},password:"SyntheticActor123"};
function setup(options={}) {
  let handler;const calls=[],grants=new Map(),state={role:"super_admin",...options};
  const user=()=>({id:actorId,email:"actor@example.invalid",app_metadata:{role:state.role,account_status:"active"},banned_until:state.banned?"2099-01-01T00:00:00Z":null});
  const client={auth:{getUser:async()=>({data:{user:state.unauthenticated?null:user()},error:null}),signInWithPassword:async()=>({error:state.badPassword?{}:null}),admin:{
    getUserById:async()=>({data:{user:{id:state.self?actorId:targetId,app_metadata:{role:state.targetSuper?"super_admin":"member"}}},error:null}),
    updateUserById:async(id,data)=>{calls.push({mutation:"auth-update",id,data});return {error:state.authFailure?{}:null};},
    deleteUser:async id=>{calls.push({mutation:"auth-delete",id});return {error:state.authFailure?{}:null};},
  }},from:table=>{
    const query={field:null,updated:null,select(){return this;},eq(field){this.field=field;return this;},
      maybeSingle:async()=>({data:query.field==="user_id"?{status:state.blocked?"blocked":"active"}:{id:"synthetic-profile",user_id:state.self?actorId:targetId,member_id:base.target,role:state.targetProfileSuper?"Super Admin":"Member",email:"member@example.invalid",status:"active"},error:null}),
      limit:async()=>({data:[],error:state.auditReadFailure?{}:null}),
      update(data){this.updated=data;calls.push({mutation:"profile-update",data});return this;},
      single:async()=>({data:{member_id:base.target,status:query.updated?.status},error:null}),
      insert:async data=>{calls.push({table,data});return {error:state.auditFailure&&data.action_name.startsWith("authorize:")?{}:null};},
    };return query;
  },rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==="is_admin_security_rate_limited")return {data:false,error:null};
    if(name==="issue_admin_action_grant"){grants.set(args.p_grant_token_hash,{...args,used:false});return {data:"synthetic-grant",error:null};}
    if(name==="consume_admin_action_grant"){const g=grants.get(args.p_grant_token_hash);const valid=g&&!g.used&&["p_user_id","p_action_name","p_target_id","p_request_fingerprint"].every(key=>g[key]===args[key]);if(valid)g.used=true;return {data:!!valid,error:null};}
    return {data:null,error:null};
  }};
  new Function("require","exports","Deno",code)(name=>name.includes("/http/")?{serve:callback=>{handler=callback;}}:{createClient:()=>client},{},{env:{get:name=>({SUPABASE_URL:"https://synthetic.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SUPABASE_ANON_KEY:"synthetic-public"})[name]}});
  const send=async body=>{const response=await handler(new Request("https://synthetic.invalid/functions/v1/secure-admin-action",{method:"POST",headers:{Authorization:"Bearer synthetic-session","Content-Type":"application/json"},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};};
  const execute=async(action="block-account")=>{const request={...base,action};const grant=(await send(request)).body.grant;return send({...request,mode:"execute",grant});};
  return {send,execute,calls,state};
}
test("capability and operations require an active trusted Super Admin",async()=>{
  for(const options of[{unauthenticated:true},{role:"admin"},{role:"coop_admin"},{role:"member"},{blocked:true},{banned:true}]){
    const f=setup(options);assert.ok([401,403].includes((await f.send({mode:"account-action-reason-capability"})).status));assert.ok([401,403].includes((await f.send(base)).status));assert.ok(!f.calls.some(c=>c.mutation));
  }
  const capability=(await setup().send({mode:"account-action-reason-capability"})).body;
  assert.deepEqual(capability,{version:1,reason_max_length:2000,actions:["block-account","delete-account"],audit_mode:"authorized-request-and-result"});
  assert.equal((await setup({auditReadFailure:true}).send({mode:"account-action-reason-capability"})).status,503);
});
test("both actions require nonempty bounded reason and real password verification",async()=>{
  for(const action of["block-account","delete-account"])for(const reason of[undefined,""," \n ","x".repeat(2001)]){
    const f=setup();assert.equal((await f.send({...base,action,payload:{reason}})).status,400);assert.ok(!f.calls.some(c=>c.name==="issue_admin_action_grant"||c.mutation));
  }
  const f=setup({badPassword:true});assert.equal((await f.send(base)).status,401);assert.ok(!f.calls.some(c=>c.name==="issue_admin_action_grant"||c.mutation));
});
test("grant binds reason, account, action and actor authority and cannot be replayed",async()=>{
  for(const change of[{payload:{reason:"Changed reason"}},{target:"CSUCC-OTHER"},{action:"delete-account"}]){
    const f=setup();const grant=(await f.send(base)).body.grant;assert.equal((await f.send({...base,mode:"execute",grant,...change})).status,403);assert.ok(!f.calls.some(c=>c.mutation));
  }
  const f=setup();const grant=(await f.send(base)).body.grant;assert.equal((await f.send({...base,mode:"execute",grant})).body.success,true);assert.equal((await f.send({...base,mode:"execute",grant})).status,403);
  assert.equal(f.calls.filter(c=>c.mutation==="auth-update").length,1);
  const revoked=setup();const oldGrant=(await revoked.send(base)).body.grant;revoked.state.role="admin";assert.equal((await revoked.send({...base,mode:"execute",grant:oldGrant})).status,403);
});
test("Create, Edit and Reset Password deny execution without server password verification and a matching grant",async()=>{
  for(const request of[
    {...base,action:"create-account",target:"new-account",payload:{fullName:"Sample Member",email:"member@example.invalid",phone:"09123456789",address:"Synthetic address",role:"Member",membershipType:"regular",department:"Cooperative Services",identityVerified:true},secret:{temporaryPassword:"SyntheticTemp123"}},
    {...base,action:"edit-account",payload:{fullName:"Sample Member",email:"member@example.invalid",phone:"09123456789",address:"Synthetic address",role:"Member",membershipType:"regular",department:"Cooperative Services"}},
    {...base,action:"reset-account-password",payload:{},secret:{temporaryPassword:"SyntheticTemp123"}},
  ]){
    const f=setup({badPassword:true});assert.equal((await f.send(request)).status,401);
    assert.equal((await f.send({...request,mode:"execute",grant:"unverified"})).status,403);
    assert.equal((await f.send({...request,mode:"execute",grant:undefined})).status,400);
    assert.ok(!f.calls.some(c=>c.mutation));
    const verified=setup();assert.ok((await verified.send(request)).body.grant);assert.ok(!verified.calls.some(c=>c.mutation));
  }
});
test("authorized reason is audited before each mutation and correlated with the confirmed result",async()=>{
  for(const action of["block-account","delete-account"]){
    const f=setup();assert.equal((await f.execute(action)).body.success,true);
    const audits=f.calls.filter(c=>c.table==="admin_activity_logs");assert.equal(audits.length,2);
    assert.equal(audits[0].data.action_name,`authorize:${action}`);assert.equal(audits[0].data.details.operation_completed,false);
    for(const audit of audits){assert.equal(audit.data.actor_id,actorId);assert.equal(audit.data.target_id,base.target);assert.equal(audit.data.details.reason,"Recorded synthetic reason");assert.ok(!JSON.stringify(audit).includes(base.password));}
    assert.ok(f.calls.indexOf(audits[0])<f.calls.findIndex(c=>c.mutation));assert.equal(audits[1].data.details.operation_completed,true);
    assert.equal(audits[1].data.details.request_id,audits[0].data.details.request_id);
  }
});
test("failed audit prevents account mutation; failed Auth update preserves reason and existing profile compensation",async()=>{
  const noAudit=setup({auditFailure:true});assert.equal((await noAudit.execute()).status,400);assert.ok(!noAudit.calls.some(c=>c.mutation));
  const failed=setup({authFailure:true});assert.equal((await failed.execute()).body.success,undefined);
  assert.equal(failed.calls.find(c=>c.table==="admin_activity_logs"&&c.data.action_name==="authorize:block-account").data.details.reason,"Recorded synthetic reason");
  assert.deepEqual(failed.calls.filter(c=>c.mutation==="profile-update").map(c=>c.data.status),["blocked","active"]);
  assert.ok(!failed.calls.some(c=>c.data?.details?.operation_completed===true));
});
test("Super Admin target and self protections remain unchanged",async()=>{
  for(const options of[{targetSuper:true},{targetProfileSuper:true},{self:true}])for(const action of["block-account","delete-account"]){
    const f=setup(options);assert.equal((await f.execute(action)).status,400);assert.ok(!f.calls.some(c=>c.mutation||c.data?.action_name?.startsWith("authorize:")));
  }
});
test("minimal canonical-derived bundle changes only account reason handling; security and financial code remain identical",()=>{
  const base=readFileSync("docs/loan-rejection-deploy/deployed-source-v9/supabase/edge-functions/secure-admin-action/index.ts.txt","utf8").replaceAll("\r\n","\n");
  const staged=readFileSync("node_modules/.cache/coop-account-reasons-deploy/supabase/edge-functions/secure-admin-action/index.ts","utf8");
  assert.equal(staged,applyReasonPatches(base));
  const declaration=(s,name)=>{const ast=ts.createSourceFile("s.ts",s,ts.ScriptTarget.Latest,true);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);};
  for(const name of["executeLoanAction","executeLoanPolicyAction","canonicalJson","sha256","hmacSha256","containsSensitiveField","validateActionSecret","getRoleMetadata"])assert.equal(declaration(staged,name),declaration(base,name));
  const auth=s=>s.slice(s.indexOf("  const bearer ="),s.indexOf("  let body: JsonObject;"));assert.equal(auth(staged),auth(base));
  assert.match(readFileSync("node_modules/.cache/coop-account-reasons-deploy/supabase/config.toml","utf8"),/verify_jwt = true/);
  assert.equal(readFileSync("node_modules/.cache/coop-account-reasons-deploy/supabase/functions/secure-admin-action/index.ts","utf8"),readFileSync("../coop_backend/supabase/functions/secure-admin-action/index.ts","utf8"));
});
