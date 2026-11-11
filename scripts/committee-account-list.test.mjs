import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import ts from "typescript";
const code=ts.transpileModule(readFileSync(resolve("../coop_backend/supabase/edge-functions/list-admin-accounts/index.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const identity=(id,role)=>({id,email:id+"@example.invalid",created_at:"2026-01-01",app_metadata:{role,account_status:"active"},user_metadata:{full_name:id}});
let handler,actorRole="super_admin",profiles=[];
const users=[identity("committee-crecom","crecom_member"),identity("committee-bod","bod_member"),identity("member","member"),identity("admin","admin")];
const client={auth:{getUser:async()=>({data:{user:identity("actor",actorRole)},error:null}),admin:{listUsers:async()=>({data:{users},error:null})}},from:()=>{
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{status:"active"},error:null}),order:()=>query,range:async()=>({data:profiles,error:null})};return query;
}};
new Function("require","exports","Deno",code)(name=>name.includes("supabase-js")?{createClient:()=>client}:{serve:value=>{handler=value;}},{},{env:{get:()=>"synthetic"}});
const request=()=>new Request("https://synthetic.example.invalid/list-admin-accounts",{method:"POST",headers:{authorization:"Bearer synthetic"}});
test("All Accounts omits auth-only committee identities and retains member/admin accounts",async()=>{
 profiles=[];const response=await handler(request());assert.equal(response.status,200);const body=await response.json();
 assert.deepEqual(body.accounts.map(row=>row.authUserId).sort(),["admin","member"]);
});
test("a conflicting linked borrower/committee profile remains visible as an integrity issue",async()=>{
 profiles=[{id:"profile-conflict",user_id:"committee-crecom",member_id:"TEST-1",first_name:"Synthetic",last_name:"Conflict",role:"Member",status:"active",created_at:"2026-01-01",membership_type:"regular"}];
 const body=await (await handler(request())).json();const conflict=body.accounts.find(row=>row.authUserId==="committee-crecom");
 assert.ok(conflict);assert.ok(conflict.integrityIssue);assert.equal(body.accounts.some(row=>row.authUserId==="committee-bod"),false);
});
test("committee identities cannot call the administrator account listing",async()=>{
 actorRole="crecom_member";assert.equal((await handler(request())).status,403);
});
