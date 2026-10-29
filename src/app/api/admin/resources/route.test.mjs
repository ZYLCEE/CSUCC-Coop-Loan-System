import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./route.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(role='super_admin',pages=[[]]) {
  const calls=[];
  const client={auth:{getUser:async()=>({data:{user:role?{id:'caller',app_metadata:{role,account_status:'active'}}:null},error:null})},from(table){return{select(){return this;},order(){return this;},async range(start,end){calls.push({table,start,end});return{data:pages.shift()??[],error:null};}};},storage:{getBucket:async()=>({data:{name:'coop-admin-resources'},error:null}),from(bucket){return{upload:async(path,blob,options)=>{calls.push({bucket,path,options,content:await blob.text()});return{error:null};},download:async()=>({data:new Blob(['{}']),error:null}),remove:async(paths)=>{calls.push({bucket,paths});return{error:null};}};}}};
  const exports={};
  new Function('require','exports','process',code)(()=>({createClient:()=>client}),exports,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key'}});
  const request=(resource,method='GET',body)=>new Request(`http://localhost/api/admin/resources?resource=${resource}`,{method,headers:{Authorization:'Bearer test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return{...exports,calls,request,client};
}
test('missing, expired and member credentials cannot read admin data',async()=>{
  const f=setup();assert.equal((await f.GET(new Request('http://localhost/api/admin/resources?resource=members'))).status,401);
  for(const role of [null,'member']){const f=setup(role);assert.ok([401,403].includes((await f.GET(f.request('members'))).status));assert.equal(f.calls.length,0);}
});
test('regular admins can read but cannot write configuration or delete documents',async()=>{
  const f=setup('admin',[[{id:'loan'}]]);assert.equal((await f.GET(f.request('loans'))).status,200);
  assert.equal((await f.POST(f.request('general','POST',{}))).status,403);
  assert.equal((await f.DELETE(f.request('documents','DELETE',{id:'documents/file.pdf'}))).status,403);
});
test('pagination reads beyond a service page and active list excludes completed loans',async()=>{
  const page=Array.from({length:500},(_,id)=>({id,status:'released'}));
  const f=setup('super_admin',[page,[{id:501,status:'completed'},{id:502,status:'overdue'}]]);
  const response=await f.GET(f.request('active'));const rows=await response.json();assert.equal(rows.length,501);assert.deepEqual(f.calls.map(call=>call.start),[0,500]);assert.ok(rows.every(row=>row.status!=='completed'));
});
test('arbitrary tables and write operations to financial tables are rejected',async()=>{
  const f=setup();assert.equal((await f.GET(f.request('admin_action_grants'))).status,400);assert.equal((await f.POST(f.request('loans','POST',{amount:1}))).status,400);assert.equal(f.calls.length,0);
});
test('portal settings are persisted only after validation and use private storage',async()=>{
  const f=setup();const settings={cooperativeName:'Demo cooperative',maxUploadSize:4,allowedFileTypes:'PDF, PNG'};
  assert.equal((await f.POST(f.request('general','POST',settings))).status,200);
  assert.equal(f.calls[0].bucket,'coop-admin-resources');assert.equal(f.calls[0].path,'configuration/general.json');assert.deepEqual(JSON.parse(f.calls[0].content),settings);
  const invalid=setup();assert.equal((await invalid.POST(invalid.request('general','POST',{...settings,allowedFileTypes:'HTML'}))).status,400);assert.equal(invalid.calls.length,0);
});
test('document path traversal is rejected before storage deletion',async()=>{
  const f=setup();assert.equal((await f.DELETE(f.request('documents','DELETE',{id:'configuration/../general.json'}))).status,400);assert.equal(f.calls.length,0);
});
