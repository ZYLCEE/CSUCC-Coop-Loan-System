import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const load=(path,imports={})=>{const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in imports))throw new Error('Unexpected import '+name);return imports[name];},exports);return exports;};
const model=load('./applicationWorkflow.ts'),privileges=load('./adminPrivileges.ts');
const state={role:'super_admin',active:true,error:null,calls:[],application:null,evidenceFilters:[],evidenceError:null};
const client={auth:{getUser:async()=>({data:{user:{id:'10000000-0000-0000-0000-000000000001',app_metadata:{role:state.role,account_status:state.active?'active':'blocked'}}},error:null})},rpc:async(name,args)=>{state.calls.push({name,args});return name==='application_evidence_details'?{data:{records:[{subject_name:"Synthetic co-maker",status:"approved"}]},error:state.evidenceError}:{data:state.application??{revision:1},error:state.error};},from:table=>{
 state.evidenceFilters.push(['from',table]);const query={};
 for(const method of ['select','eq','is','in','lte','or','order'])query[method]=(...args)=>{state.evidenceFilters.push([method,...args]);return query;};
 query.limit=async count=>{state.evidenceFilters.push(['limit',count]);return {data:[{id:'synthetic-proof',kind:'borrower',subject_reference:'Synthetic borrower',method:'otp',occurred_at:'2026-11-11T00:00:00Z',evidence_reference:'Synthetic confirmation'}],error:state.evidenceError};};return query;
}};
const api=load('../app/api/admin/application-workflow/route.ts',{'@supabase/supabase-js':{createClient:()=>client},'@/lib/adminPrivileges':privileges,'@/lib/applicationWorkflow':model,'@/lib/committeeServer':{committeeServiceClient:()=>client,CommitteeError:class extends Error{},verifiedAdministratorAction:async()=>({user:{id:'10000000-0000-0000-0000-000000000001'}})}});
process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.example.invalid';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='synthetic-public-key';
const headers={authorization:'Bearer synthetic', 'content-type':'application/json'};
const request=body=>new Request('https://synthetic.example.invalid/api/admin/application-workflow',{method:'POST',headers,body:JSON.stringify(body)});
const valid={operation:'save_draft',applicationId:'APP-TEST',revision:1,stateHash:'a'.repeat(64),requestId:'60000000-0000-0000-0000-000000000001',payload:{checks:{identity:true,eligibility:false,terms:false},notes:'Internal only'}};
test('API requires a live authorized administrator session and never caches protected responses',async()=>{
 const response=await api.GET(new Request('https://synthetic.example.invalid/api/admin/application-workflow?operation=summary'));
 assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
 state.role='crecom_member';assert.equal((await api.POST(request(valid))).status,403);
 state.role='admin';state.active=false;assert.equal((await api.POST(request(valid))).status,403);
 state.role='super_admin';state.active=true;
});
test('API rejects fabricated checklist consent and unsupported approval actions before any write',async()=>{
 state.calls=[];
 assert.equal((await api.POST(request({...valid,payload:{...valid.payload,checks:{...valid.payload.checks,borrowerConsent:true}}}))).status,400);
 assert.equal((await api.POST(request({...valid,operation:'approve'}))).status,400);
 assert.equal(state.calls.length,0);
 assert.equal((await api.POST(request(valid))).status,200);
 assert.equal(state.calls[0].name,'application_workflow_action');
 assert.equal(state.calls[0].args.p_args.operation,'save_draft');
});
test('API maps stale state to conflict and saves policies only through the draft RPC',async()=>{
 state.error={code:'40001',message:'Application changed. Refresh.'};
 assert.equal((await api.POST(request(valid))).status,409);state.error=null;state.calls=[];
 const response=await api.POST(request({operation:'policy_draft',requestId:valid.requestId,expectedLatestId:null,payload:{name:'Draft',config:model.emptyWorkflowPolicy,authorizationReference:'',status:'approved'}}));
 assert.equal(response.status,200);assert.equal(state.calls[0].name,'save_approval_policy_draft');
 assert.equal('status' in state.calls[0].args.p_payload,false);
});

test('evidence viewing uses a packet-bound authorized RPC independently of policy methods',async()=>{
 const applicationUuid='30000000-0000-0000-0000-000000000001',packetHash='b'.repeat(64);
 state.application={applicationId:'APP-TEST',applicationUuid,packetHash,policy:null};state.calls=[];
 const get=hash=>new Request('https://synthetic.example.invalid/api/admin/application-workflow?operation=evidence&applicationId=APP-TEST&packetHash='+hash,{headers});
 try{
  const response=await api.GET(get(packetHash));assert.equal(response.status,200);assert.equal((await response.json()).records[0].subject_name,'Synthetic co-maker');
  assert.deepEqual(state.calls.at(-1),{name:'application_evidence_details',args:{p_application_id:'APP-TEST',p_packet_hash:packetHash}});
  state.calls=[];assert.equal((await api.GET(get('c'.repeat(64)))).status,409);assert.equal(state.calls.some(c=>c.name==='application_evidence_details'),false);
  state.role='crecom_member';state.calls=[];assert.equal((await api.GET(get(packetHash))).status,403);assert.equal(state.calls.length,0);
  state.role='super_admin';state.evidenceError={message:'Unavailable'};assert.equal((await api.GET(get(packetHash))).status,503);
 }finally{state.application=null;state.evidenceError=null;state.role='super_admin';}
});
