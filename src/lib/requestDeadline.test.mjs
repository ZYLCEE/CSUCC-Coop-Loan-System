import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path,imports={},globals={}){
 const exports={};new Function('require','exports',...Object.keys(globals),ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in imports))throw Error(name);return imports[name];},exports,...Object.values(globals));return exports;
}
const deadlines=load('./requestDeadline.ts');
const fast={...deadlines,withRequestDeadline:(operation,_ms,message,parent)=>deadlines.withRequestDeadline(operation,15,message,parent)};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('a stalled session lookup exits and cannot start account creation when it later resolves',async()=>{
 let release,calls=0;
 const auth={getSession:()=>new Promise(resolve=>{release=resolve;})};
 const transport=load('./committeeRequest.ts',{'./supabase':{getSupabaseClient:()=>({auth})},'./requestDeadline':fast},{fetch:async()=>{calls++;return Response.json({success:true});}});
 await assert.rejects(transport.committeeRequest('',{method:'POST',body:'{}'},true),/took too long/);
 release({data:{session:{access_token:'synthetic-bearer'}}});await pause(1);assert.equal(calls,0);
});

test('stalled HTTP or JSON responses are bounded and abort the creation request',async()=>{
 for(const stage of ['http','json']){
  let signal;
  const transport=load('./committeeRequest.ts',{'./supabase':{getSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'synthetic-bearer'}}})}})},'./requestDeadline':fast},{fetch:async(_url,init)=>{signal=init.signal;return stage==='http'?new Promise(()=>{}):{ok:true,json:()=>new Promise(()=>{})};}});
  await assert.rejects(transport.committeeRequest('',{method:'POST',body:'{}'},true),/took too long/);assert.equal(signal.aborted,true);
 }
});

test('existing-account conflicts and incomplete HTTP responses leave actionable errors',async()=>{
 let result=Response.json({error:'This email already belongs to a CRECOM account. Choose another email.'},{status:409});
 const transport=load('./committeeRequest.ts',{'./supabase':{getSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'synthetic-bearer'}}})}})},'./requestDeadline':deadlines},{fetch:async()=>result});
 await assert.rejects(transport.committeeRequest('',{},true),/CRECOM account/);
 result=new Response('<html>Gateway timeout</html>',{status:504});await assert.rejects(transport.committeeRequest('',{},true),/incomplete response/);
});

test('the management route bounds a stalled verifier and cancels its downstream signal',async()=>{
 let signal,creations=0;
 const server={readCommitteeBody:r=>r.json(),verifiedCommitteeAdministrator:async request=>{signal=request.signal;return new Promise(()=>{});},createCommitteeAccount:async()=>{creations++;},committeeFailure:error=>Response.json({error:error.message},{status:error instanceof deadlines.RequestTimeoutError?504:500})};
 const route=load('../app/api/admin/committee-accounts/route.ts',{'@/lib/committeeServer':server,'@/lib/requestDeadline':fast});
 const response=await route.POST(new Request('https://synthetic.example.invalid/api/admin/committee-accounts',{method:'POST',body:JSON.stringify({operation:'create',password:'Synthetic-Actor1!'})}));
 assert.equal(response.status,504);assert.match((await response.json()).error,/check its status/);assert.equal(signal.aborted,true);assert.equal(creations,0);
});

test('per-provider HTTP deadlines cancel the actual fetch, and caller cancellation is preserved',async()=>{
 let signal;
 const sdk=load('./requestDeadline.ts',{}, {fetch:async(_url,init)=>{signal=init.signal;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}});
 const keepAlive=setTimeout(()=>{},100);
 try{await assert.rejects(sdk.fetchWithDeadline(undefined,10)('https://synthetic.example.invalid/auth/v1/admin/users'));assert.equal(signal.aborted,true);}finally{clearTimeout(keepAlive);}
 const parent=new AbortController();parent.abort(new Error('Synthetic cancellation'));
 let invoked=false;await assert.rejects(deadlines.withRequestDeadline(async()=>{invoked=true;},100,'Timeout',parent.signal),/Synthetic cancellation/);assert.equal(invoked,false);
});
