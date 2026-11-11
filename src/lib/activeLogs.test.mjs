import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,imports={},globals={}){const exports={};new Function('require','exports',...Object.keys(globals),ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name in imports?imports[name]:require(name),exports,...Object.values(globals));return exports;}
const presentation=load('./accountPresentation.ts'),model=load('./activeLogs.ts',{'./accountPresentation':presentation}),server=load('./portalActivityServer.ts'),privileges=load('./adminPrivileges.ts');
const sid='b1111111-1111-4111-8111-111111111111';
const token='header.'+Buffer.from(JSON.stringify({session_id:sid})).toString('base64url')+'.signature';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.example.invalid';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='synthetic-public';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
const request=(path,body,auth=token)=>new Request('http://127.0.0.1:3000'+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer '+auth}:{}),'Content-Type':'application/json','User-Agent':'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36'},...(body?{body:JSON.stringify(body)}:{})});
function setup({role='super_admin',active=true,allowed=true,authError=false,accessError=null,rpcError=null,expired=false,edgeStatus=200,edgeResult={success:true,result:{member_id:'SYNTHETIC-001'}},logThrow=false}={}){
 const calls=[],user={id:'a1111111-1111-4111-8111-111111111111',app_metadata:{role,account_status:active?'active':'blocked'}};
 const client={auth:{getUser:async()=>({data:{user:authError?null:user},error:authError?{}:null})},rpc:async(name,args)=>{
  calls.push({name,args});if(name==='portal_session_access')return {data:accessError?null:{allowed,setupRequired:false},error:accessError};
  if(logThrow&&name==='append_completed_portal_action')throw new Error('Temporary logging outage');
  return {data:name==='manage_portal_log_session'?expired?{expired:true}:{id:'tracked',expiresAt:'2026-11-11T12:00:00Z',serverTime:'2026-11-11T11:45:00Z'}:name==='append_completed_portal_action'?true:{rows:[],total:0,page:1,pageSize:10},error:rpcError};
 }};
 const sdk={createClient:()=>client},deps={'@supabase/supabase-js':sdk,'@/lib/activeLogs':model,'@/lib/accountPresentation':presentation,'@/lib/adminPrivileges':privileges,'@/lib/portalActivityServer':server};
 const fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body),authorization:init.headers.Authorization});return new Response(JSON.stringify(edgeResult),{status:edgeStatus});};
 return {calls,user,logs:load('../app/api/admin/active-logs/route.ts',deps),session:load('../app/api/portal-session/route.ts',deps),action:load('../app/api/admin/action/route.ts',deps,{fetch})};
}
test('filters reject malformed dates, prototype keys and pagination while preserving inclusive Philippine date ranges',async()=>{
 for(const query of ['role=constructor','role=__proto__','from=2026-02-30','from=2026-13-01','from=2026-11-12&to=2026-11-11','page=-1','pageSize=500'])assert.throws(()=>model.activeLogFilters(new URLSearchParams(query)));
 const f=setup();assert.equal((await f.logs.GET(request('/api/admin/active-logs?from=2026-11-11&to=2026-11-11'))).status,200);
 assert.equal(f.calls[0].args.p_from,'2026-11-11T00:00:00+08:00');assert.equal(f.calls[0].args.p_to,'2026-11-11T16:00:00.000Z');
 assert.equal(model.logDateTime('2026-11-11T16:30:00Z').date,'Nov 12, 2026');
});
test('Active Logs accepts five active account roles and delegates visibility to the JWT-scoped reader',async()=>{
 for(const role of Object.keys(presentation.accountRoles)){const f=setup({role});assert.equal((await f.logs.GET(request('/api/active-logs'))).status,200);assert.equal(f.calls[0].name,'read_portal_active_logs');}
 for(const options of [{role:'unknown'},{role:'constructor'},{active:false},{authError:true}]){const f=setup(options);assert.ok([401,403].includes((await f.logs.GET(request('/api/admin/active-logs'))).status));assert.equal(f.calls.length,0);}
 const f=setup();assert.equal((await f.logs.GET(request('/api/admin/active-logs',null,''))).status,401);
 const response=await f.logs.GET(request('/api/admin/active-logs?role=admin&search=Reviewed&pageSize=25'));assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(f.calls[0].name,'read_portal_active_logs');assert.equal(f.calls[0].args.p_role,'admin');assert.equal(f.calls[0].args.p_page_size,25);
});

test('COOP ID display keeps canonical IDs and never invents missing account numbers',()=>{
 assert.equal(presentation.formatAccountNumber('2026-0005'),'CSUCC-2026-0005');assert.equal(presentation.formatAccountNumber('CSUCC-2026-0005'),'CSUCC-2026-0005');assert.equal(presentation.formatAccountNumber(null),'—');assert.equal(presentation.formatAccountNumber('legacy-custom'),'legacy-custom');
 assert.equal(presentation.accountRoleTones.super_admin,'warning');assert.equal(presentation.accountRoleTones.admin,'info');assert.equal(presentation.accountRoleTones.member,'success');
});
test('session start requires actual portal admission and derives identity/device from verified request, not posted fields',async()=>{
 const denied=setup({allowed:false});assert.equal((await denied.session.POST(request('/api/portal-session',{operation:'start'}))).status,403);assert.ok(!denied.calls.some(call=>call.args?.p_operation==='start'));
 const f=setup();const response=await f.session.POST(request('/api/portal-session',{operation:'start',name:'Forged',role:'member',ip:'8.8.8.8'}));assert.equal(response.status,200);
 const args=f.calls.find(call=>call.name==='manage_portal_log_session').args;assert.equal(args.p_auth_session_id,sid);assert.equal(args.p_actor_id,f.user.id);assert.equal(args.p_browser,'Chrome');assert.equal(args.p_os,'Windows');assert.equal(args.p_ip,'127.0.0.1');assert.ok(!('role' in args));
 assert.equal((await setup().session.POST(request('/api/portal-session',{operation:'start'},'invalid'))).status,401);
 assert.equal((await setup({expired:true}).session.POST(request('/api/portal-session',{operation:'touch',idleSeconds:2}))).status,401);
});
test('background/malformed tokens cannot manufacture a session ID and untrusted forwarding headers are not IP evidence',()=>{
 assert.equal(server.portalSessionId('invalid'),null);assert.equal(server.portalSessionId(token),sid);
 const publicRequest=new Request('https://portal.example.invalid',{headers:{'x-forwarded-for':'8.8.8.8'}});const previous=process.env.COOP_TRUST_PROXY_HEADERS,vercel=process.env.VERCEL;delete process.env.COOP_TRUST_PROXY_HEADERS;delete process.env.VERCEL;
 try{assert.equal(server.portalDevice(publicRequest).ip,null);}finally{if(previous!==undefined)process.env.COOP_TRUST_PROXY_HEADERS=previous;if(vercel!==undefined)process.env.VERCEL=vercel;}
});

test('missing or denied logging never masquerades as an empty history or an admitted session',async()=>{
 for(const code of ['42501','42883','PGRST301']){
  const error={code,message:code==='42501'?'permission denied':'function not found'};
  const f=setup({rpcError:error}),history=await f.logs.GET(request('/api/admin/active-logs'));
  assert.equal(history.status,code==='42501'?403:503);assert.ok((await history.json()).error);
  const session=await f.session.POST(request('/api/portal-session',{operation:'start'}));
  assert.equal(session.status,code==='42501'?401:503);assert.ok((await session.json()).error);
  const access=setup({accessError:error});assert.equal((await access.session.POST(request('/api/portal-session',{operation:'start'}))).status,503);
  assert.equal(access.calls.length,1);
 }
});
test('protected-action proxy preserves existing verification and records only confirmed execute success',async()=>{
 for(const [body,options] of [[{mode:'verify',action:'block-account',password:'synthetic-only'},{}],[{mode:'execute',action:'block-account',grant:'synthetic-grant'},{edgeStatus:403,edgeResult:{success:false,error:'Denied'}}],[{mode:'execute',action:'block-account',grant:'synthetic-grant'},{edgeResult:{success:false}}]]){
  const f=setup(options);await f.action.POST(request('/api/admin/action',body));assert.ok(!f.calls.some(call=>call.name==='append_completed_portal_action'));assert.deepEqual(f.calls.find(call=>call.url)?.body,body);
 }
 const f=setup();const body={mode:'execute',action:'block-account',target:'SYNTHETIC-001',grant:'synthetic-grant',payload:{reason:'Synthetic reason'}};
 assert.equal((await f.action.POST(request('/api/admin/action',body))).status,200);const args=f.calls.find(call=>call.name==='append_completed_portal_action').args;
 assert.equal(args.p_action,'block-account');assert.equal(args.p_reason,'Synthetic reason');assert.match(args.p_source_key,/^protected:[0-9a-f]{64}$/);assert.ok(!JSON.stringify(args).includes('synthetic-grant'));
 const outage=setup({logThrow:true});const response=await outage.action.POST(request('/api/admin/action',body));assert.equal(response.status,200);assert.equal((await response.json()).success,true);
});
