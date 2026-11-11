import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(process.env.COOP_SECURE_ACTION_SOURCE ?? new URL('../../coop_backend/supabase/edge-functions/secure-admin-action/index.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const target='APP-TEST';
const payload={reason:'Actual synthetic decision reason',expected_status:'under review',request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
function setup(options={}) {
 let handler;const calls=[];const grants=new Map();
 const user={id:'11111111-1111-4111-8111-111111111111',email:'synthetic@example.invalid',app_metadata:{role:options.role??'super_admin',account_status:'active'},...options.user};
 const client={auth:{getUser:async()=>({data:{user:options.unauthenticated?null:user},error:null}),signInWithPassword:async()=>({error:options.badPassword?{}:null})},from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{status:options.blocked?'blocked':'active'},error:null}),insert:async data=>{calls.push({table,data});return {error:null};}}),rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='is_admin_security_rate_limited')return {data:false,error:null};
 if(name==='issue_admin_action_grant'){grants.set(args.p_grant_token_hash,{...args,used:false});return {data:'grant-id',error:null};}
 if(name==='consume_admin_action_grant'){const g=grants.get(args.p_grant_token_hash);const valid=g&&!g.used&&['p_user_id','p_action_name','p_target_id','p_request_fingerprint'].every(key=>g[key]===args[key]);if(valid)g.used=true;return {data:!!valid,error:null};}
 if(name==='loan_rejection_capability')return {data:options.missingSchema?null:{version:1,reason_max_length:2000,statuses:['pending','under review']},error:options.missingSchema?{}:null};
 if(name==='reject_loan_application')return {data:options.conflict?null:{application_id:target,status:'rejected'},error:options.conflict?{code:'40001',message:'private database error must never leak'}:null};
 return {data:null,error:null};}};
 new Function('require','exports','Deno',code)(name=>name.includes('/http/')?{serve:callback=>{handler=callback;}}:{createClient:()=>client},{},{env:{get:name=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-value',SUPABASE_ANON_KEY:'synthetic-public-value'})[name]}});
 const send=async body=>{const response=await handler(new Request('https://synthetic.invalid/functions/v1/secure-admin-action',{method:'POST',headers:{Authorization:'Bearer synthetic-session','Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};};
 return {send,calls};
}
const verify={mode:'verify',action:'reject-loan',target,payload,password:'synthetic-password'};
test('canonical backend capability and authenticated role checks fail closed',async()=>{
 for(const options of[{unauthenticated:true},{role:'admin'},{role:'member'},{blocked:true},{user:{app_metadata:{},user_metadata:{role:'super_admin'}}}]){const f=setup(options);const result=await f.send(verify);assert.ok([401,403].includes(result.status));assert.ok(!f.calls.some(c=>c.name==='issue_admin_action_grant'));}
 assert.equal((await setup({missingSchema:true}).send({mode:'loan-rejection-capability'})).status,503);
 assert.equal((await setup().send({mode:'loan-rejection-capability'})).body.version,1);
});
test('reason, request ID, eligible expected state and real password verification required',async()=>{
 for(const invalid of[{reason:''},{reason:' \n '},{reason:'x'.repeat(2001)},{request_id:'bad'},{expected_status:'approved'}])assert.equal((await setup().send({...verify,payload:{...payload,...invalid}})).status,400);
 const f=setup({badPassword:true});assert.equal((await f.send(verify)).status,401);assert.ok(!f.calls.some(c=>c.name==='issue_admin_action_grant'));
});
test('verified grant binds actor, action, application and reason; execute is single use',async()=>{
 for(const change of[{target:'OTHER'},{action:'approve-loan'},{payload:{...payload,reason:'Changed reason'}}]){const f=setup();const grant=(await f.send(verify)).body.grant;assert.equal((await f.send({...verify,mode:'execute',grant,...change})).status,403);assert.ok(!f.calls.some(c=>c.name==='reject_loan_application'));}
 const f=setup();const grant=(await f.send(verify)).body.grant;const result=await f.send({...verify,mode:'execute',grant});assert.equal(result.body.success,true);assert.equal(result.body.result.status,'rejected');assert.equal((await f.send({...verify,mode:'execute',grant})).status,403);assert.equal(f.calls.filter(c=>c.name==='reject_loan_application').length,1);assert.ok(!f.calls.some(c=>c.table==='admin_activity_logs'&&c.data.result==='success'),'transaction owns success audit');
});
test('conflict never succeeds or leaks internal errors; generic status action cannot bypass reason',async()=>{
 const f=setup({conflict:true});const grant=(await f.send(verify)).body.grant;const response=await f.send({...verify,mode:'execute',grant});assert.equal(response.status,400);assert.equal(response.body.success,undefined);assert.match(response.body.error,/already been updated/);assert.ok(!JSON.stringify(response.body).includes('private database'));
 assert.equal((await setup().send({...verify,action:'update-loan-status',payload:{status:'rejected'}})).status,400);
});
test('legacy release cannot call a missing RPC or redirect incomplete inputs into financial operations',async()=>{
 const f=setup();const response=await f.send({...verify,action:'release-loan',payload:{}});
 assert.equal(response.status,409);assert.match(response.body.error,/Mark as Released/);
 assert.ok(!f.calls.some(c=>['issue_admin_action_grant','release_loan','release_approved_loan'].includes(c.name)));
});
