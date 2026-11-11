import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as privilegesModule from '../../../../lib/adminPrivileges.ts';

function loadModel(path,imports={}) {
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>imports[name],exports);return exports;
}
const activeModel=loadModel('../../../../lib/activeLoans.ts',{'./membership':loadModel('../../../../lib/membership.ts'),'./loanTypeLabel':loadModel('../../../../lib/loanTypeLabel.ts')});
const activeData=loadModel('../../../../lib/activeLoansData.ts',{'./activeLoans':activeModel});
const code = ts.transpileModule(readFileSync(new URL('./route.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(role='super_admin',pages=[[]],privileges=[]) {
  const calls=[];
  const client={auth:{getUser:async()=>({data:{user:role?{id:'caller',app_metadata:{role,account_status:'active',admin_privileges:privileges}}:null},error:null})},from(table){const filters=[];return{select(){return this;},order(){return this;},in(key,values){filters.push(row=>values.includes(row[key]));return this;},eq(key,value){filters.push(row=>row[key]===value);return this;},async range(start,end){calls.push({table,start,end});const rows=table==='loan_payments'?[]:pages.shift()??[];return{data:rows.filter(row=>filters.every(filter=>filter(row))),error:null};}};},storage:{getBucket:async()=>({data:{name:'coop-admin-resources'},error:null}),from(bucket){return{upload:async(path,blob,options)=>{calls.push({bucket,path,options,content:await blob.text()});return{error:null};},download:async()=>({data:new Blob(['{}']),error:null}),remove:async(paths)=>{calls.push({bucket,paths});return{error:null};}};}}};
  const exports={};
  new Function('require','exports','process',code)(name => name === "@/lib/portalActivityServer" ? {portalActivityHeaders:()=>({}),portalSessionId:()=>null} : name ==='@/lib/adminPrivileges'?privilegesModule:name==='@/lib/activeLoansData'?activeData:{createClient:()=>client},exports,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-key'}});
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
test('pagination reads beyond a service page and active list includes released, overdue and completed loans',async()=>{
  const fixture={amount:1000,monthly_payment:100,tenure_months:12,member_name:'Synthetic Borrower',loan_type:'Regular'};
  const page=Array.from({length:500},(_,id)=>({...fixture,id:String(id),application_id:'APP-'+id,status:'released'}));
  const f=setup('super_admin',[page,[{...fixture,id:'501',application_id:'APP-501',status:'completed'},{...fixture,id:'502',application_id:'APP-502',status:'overdue'},{...fixture,id:'503',status:'approved'},{...fixture,id:'504',status:'pending'},{...fixture,id:'505',status:'under review'},{...fixture,id:'506',status:'rejected'}]]);
  const response=await f.GET(f.request('active'));const rows=await response.json();assert.equal(response.status,200);assert.equal(rows.length,502);assert.deepEqual(f.calls.filter(call=>call.table==='loan_applications').map(call=>call.start),[0,500]);assert.ok(rows.some(row=>row.status==='Fully Paid'));assert.ok(rows.every(row=>['Released','Overdue','Fully Paid'].includes(row.status)));
});
test('an approved loan enters Active Loans only after being marked as released',async()=>{
  const loan={id:'1',application_id:'APP-001',amount:1000,monthly_payment:100,tenure_months:12,member_name:'Synthetic Borrower',loan_type:'Regular',status:'approved'};
  for(const role of ['super_admin','admin']) {
    const before=setup(role,[[{...loan}]]);
    assert.deepEqual(await (await before.GET(before.request('active'))).json(),[]);
    const after=setup(role,[[{...loan,status:'released'}]]);
    const response=await after.GET(after.request('active'));assert.equal(response.status,200);const rows=await response.json();assert.equal(rows.length,1);assert.equal(rows[0].id,loan.id);assert.equal(rows[0].status,'Released');
  }
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

test('document privileges grant only the assigned operation and revocation denies it again', async () => {
  const f = setup('admin', [[]], ['documents.delete']);
  assert.equal((await f.DELETE(f.request('documents', 'DELETE', { id: 'documents/file.pdf' }))).status, 200);
  assert.equal((await f.POST(f.request('documents', 'POST', {}))).status, 403);
  assert.equal((await f.POST(f.request('general', 'POST', {}))).status, 403);
  const revoked = setup('admin', [[]], []);
  assert.equal((await revoked.DELETE(revoked.request('documents', 'DELETE', { id: 'documents/file.pdf' }))).status, 403);
});

test('general settings can be saved by an individually authorized admin', async () => {
  const f = setup('admin', [[]], ['settings.manage']);
  const settings = { cooperativeName: 'Test cooperative', maxUploadSize: 5, allowedFileTypes: 'PDF, PNG' };
  assert.equal((await f.POST(f.request('general', 'POST', settings))).status, 200);
  assert.equal(f.calls[0].path, 'configuration/general.json');
  assert.equal((await f.DELETE(f.request('documents', 'DELETE', { id: 'documents/file.pdf' }))).status, 403);
});

function documentStorage(f, { missingBucket = false, brokenPath = '' } = {}) {
  f.client.storage.getBucket = async () => ({ data: missingBucket ? null : { name: 'coop-admin-resources' }, error: missingBucket ? { message: 'Bucket not found' } : null });
  f.client.storage.from = bucket => ({
    list: async (_prefix, options) => {
      f.calls.push({ bucket, offset: options.offset });
      return { data: options.offset ? [] : [{ id: 'upload', name: 'policy.pdf', metadata: { size: 2048 }, created_at: '2026-10-29' }], error: null };
    },
    createSignedUrl: async (path, expiry) => {
      f.calls.push({ bucket, path, expiry });
      return path === brokenPath ? { data: null, error: { message: 'Object not found' } } : { data: { signedUrl: `https://storage.test/${bucket}/${path}` }, error: null };
    },
  });
}
const attachment = (id, path = 'member/file.pdf') => ({ id, original_name: 'ID.pdf', kind: 'validId', storage_path: path, size_bytes: 1024, created_at: '2026-10-28', loan_applications: { application_id: 'APP-001' } });

test('documents combine existing loan attachments and cooperative uploads using the correct private buckets', async () => {
  const f = setup('admin', [[attachment('one')], []]); documentStorage(f);
  const response = await f.GET(f.request('documents'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const rows = await response.json(); assert.equal(rows.length, 2);
  const loan = rows.find(row => row.source === 'loan');
  assert.equal(loan.applicationId, 'APP-001'); assert.equal(loan.name, 'ID.pdf'); assert.equal(loan.id, 'loan:one');
  assert.equal(loan.url, 'https://storage.test/loan-documents/member/file.pdf');
  assert.ok(f.calls.some(call => call.bucket === 'coop-admin-resources' && call.path === 'documents/policy.pdf'));
  assert.ok(f.calls.filter(call => call.expiry).every(call => call.expiry === 300));
});

test('loan documents remain visible without a cooperative uploads bucket and beyond the first query page', async () => {
  const f = setup('super_admin', [Array.from({ length: 100 }, (_, id) => attachment(String(id))), [attachment('last')], []]);
  documentStorage(f, { missingBucket: true });
  const rows = await (await f.GET(f.request('documents'))).json();
  assert.equal(rows.length, 101);
  assert.deepEqual(f.calls.filter(call => call.table).map(call => call.start), [0, 100, 200]);
});

test('a missing stored file does not hide other document records', async () => {
  const f = setup('admin', [[attachment('missing', 'missing.pdf'), attachment('good')], []]);
  documentStorage(f, { brokenPath: 'missing.pdf' });
  const response = await f.GET(f.request('documents')); assert.equal(response.status, 200);
  const rows = await response.json(); assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.id === 'loan:missing').url, null);
  assert.ok(rows.find(row => row.id === 'loan:missing').linkError);
  assert.ok(rows.find(row => row.id === 'loan:good').url);
});

test('loan attachment IDs cannot be deleted through the cooperative document endpoint', async () => {
  const f = setup();
  assert.equal((await f.DELETE(f.request('documents', 'DELETE', { id: 'loan:one' }))).status, 400);
  assert.equal(f.calls.length, 0);
});
