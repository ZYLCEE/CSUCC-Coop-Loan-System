import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import ts from 'typescript';
function load(path,imports,globals={}){const exports={};new Function('require','exports',...Object.keys(globals),ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in imports))throw Error(name);return imports[name];},exports,...Object.values(globals));return exports;}
class CommitteeError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const actor='10000000-0000-4000-8000-000000000001';
const context={url:'https://synthetic.example.invalid',key:'synthetic-public',token:'synthetic-verified-bearer',user:{id:actor,email:'synthetic@example.invalid',app_metadata:{role:'crecom_member'}}};
function fixture({code=null,status=400,role='crecom_member',allowed=false,setupRequired=true,recent=false,wrongIdentity=false}={}){
 const calls=[],access={allowed,setupRequired,role,membershipId:'synthetic-membership',name:'Synthetic Reviewer',email:'synthetic@example.invalid'};
 const fetch=async(url,init)=>{calls.push({kind:'auth-http',url,init});return Response.json(code?{code}:{id:wrongIdentity?'another-account':actor},{status:code?status:200});};
 const updater=load('./committeeAuthUpdate.ts',{'./committeeServer':{CommitteeError}},{fetch});
 const server={CommitteeError,readCommitteeBody:request=>request.json(),committeeSession:async()=>({...context,user:{...context.user,app_metadata:{role}},session:{rpc:async name=>{calls.push({kind:'session-rpc',name});return {data:access,error:null};},auth:{getClaims:async token=>{calls.push({kind:'claims',token});return {data:{claims:{amr:recent?[{method:'recovery',timestamp:Date.now()/1000}]:[]}},error:null};}}}}),
 committeeServiceClient:()=>({rpc:async(name,args)=>{calls.push({kind:'service-rpc',name,args});access.allowed=true;access.setupRequired=false;return {data:{success:true},error:null};}}),
 checkCommitteeError:error=>{if(error)throw new CommitteeError('Backend failed',503);},committeeReply:data=>Response.json(data,{headers:{'Cache-Control':'no-store'}}),committeeFailure:error=>Response.json({error:error.message},{status:error.status??503})};
 const route=load('../app/api/committee/route.ts',{'@supabase/supabase-js':{createClient:()=>{throw Error('Unexpected password-verifier client');}},'@/lib/committeeServer':server,'@/lib/committee':{getCommitteeRole:user=>['crecom_member','bod_member'].includes(user.app_metadata.role)?user.app_metadata.role:null},'@/lib/profileModel':{},'@/lib/committeeAuthUpdate':updater});
 const request=body=>new Request('https://synthetic.example.invalid/api/committee',{method:'POST',body:JSON.stringify(body??{operation:'setup',password:'Synthetic-New1!',confirm:'Synthetic-New1!'})});
 return {calls,route,request,updater};
}
test('installed SDK rejects header-only updates, while verified bearer Auth updates need no server-stored session',async()=>{
 const client=createClient(context.url,context.key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+context.token}}});
 const missing=await client.auth.updateUser({password:'Synthetic-New1!'});assert.equal(missing.error?.name,'AuthSessionMissingError');
 const f=fixture();await f.updater.updateCommitteeAuthUser(context,{password:'Synthetic-New1!'});
 const call=f.calls[0];assert.equal(call.url,context.url+'/auth/v1/user');assert.equal(call.init.method,'PUT');assert.equal(call.init.headers.Authorization,'Bearer '+context.token);assert.equal(call.init.headers.apikey,context.key);assert.equal(call.init.cache,'no-store');
});
test('both reviewer roles complete only after their own Auth update, and then receive admitted portal access',async()=>{
 for(const role of ['crecom_member','bod_member']){
  const f=fixture({role}),response=await f.route.POST(f.request());assert.equal(response.status,200);
  assert.equal((await response.json()).allowed,true);assert.ok(f.calls.findIndex(call=>call.kind==='auth-http')<f.calls.findIndex(call=>call.name==='committee_complete_setup'));
  const write=f.calls.find(call=>call.kind==='service-rpc');assert.deepEqual(write.args,{p_user_id:actor});assert.ok(!JSON.stringify(write).includes('Synthetic-New1!'));
 }
});
test('same/weak passwords, expired sessions and provider outages never mark personal setup complete',async()=>{
 for(const [code,status,expected] of [['same_password',422,400],['weak_password',422,400],['session_not_found',401,401],['unexpected_failure',500,503],['over_request_rate_limit',429,429]]){
  const f=fixture({code,status}),response=await f.route.POST(f.request());assert.equal(response.status,expected);assert.equal(f.calls.some(call=>call.kind==='service-rpc'),false);
  const result=await response.json();if(code==='same_password')assert.match(result.error,/different from/);if(code==='weak_password')assert.match(result.error,/stronger password/);
 }
 const f=fixture({wrongIdentity:true});assert.equal((await f.route.POST(f.request())).status,503);assert.equal(f.calls.some(call=>call.kind==='service-rpc'),false);
});
test('inactive identities, another role and mismatched inputs cannot update Auth or complete setup',async()=>{
 for(const options of [{allowed:false,setupRequired:false},{role:'member'},{role:'admin'}]){const f=fixture(options);assert.equal((await f.route.POST(f.request())).status,403);assert.equal(f.calls.some(call=>call.kind==='auth-http'),false);}
 const f=fixture();assert.equal((await f.route.POST(f.request({operation:'setup',password:'Synthetic-New1!',confirm:'mismatch'}))).status,400);assert.equal(f.calls.some(call=>call.kind==='auth-http'),false);
});
test('already-configured accounts need recent recovery evidence checked against the explicit verified JWT',async()=>{
 const denied=fixture({allowed:true,setupRequired:false});assert.equal((await denied.route.POST(denied.request())).status,403);
 const f=fixture({allowed:true,setupRequired:false,recent:true});assert.equal((await f.route.POST(f.request())).status,200);assert.equal(f.calls.find(call=>call.kind==='claims').token,context.token);
});
