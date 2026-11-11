import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function setup(reply={data:null,error:null},capability={data:null,error:null}){
 const code=ts.transpileModule(readFileSync(new URL('./loanRejection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('require','exports',code)(()=>({getSupabaseClient:()=>({rpc:async()=>reply,functions:{invoke:async()=>capability}})}),exports);return exports;
}
test('rejection input validation trims and rejects empty or oversized reasons',()=>{
 const f=setup();for(const text of['',' \n\t ','\u00a0'])assert.throws(()=>f.validateRejectionReason(text));assert.equal(f.validateRejectionReason('  Recorded decision  '),'Recorded decision');assert.throws(()=>f.validateRejectionReason('x'.repeat(2001)));
 for(const status of['Pending','Under Review'])assert.equal(f.rejectionEligible(status),true);for(const status of['Approved','Rejected','Released','Completed','Overdue'])assert.equal(f.rejectionEligible(status),false);
});
test('capability is unavailable with legacy, missing or inconsistent server contracts',async()=>{
 for(const data of[null,{}, {version:1,reason_max_length:100,statuses:['pending','under review']},{version:1,reason_max_length:2000,statuses:['approved']}])assert.equal(await setup(undefined,{data,error:null}).loanRejectionAvailable(),false);
 assert.equal(await setup(undefined,{data:{version:1,reason_max_length:2000,statuses:['pending','under review']},error:null}).loanRejectionAvailable(),true);
});
test('private details reads distinguish missing historical metadata from denied/failed reads',async()=>{
 assert.equal(await setup().loadLoanRejectionDetails('APP'),null);await assert.rejects(setup({data:null,error:{}}).loadLoanRejectionDetails('APP'));
 await assert.rejects(setup({data:{reason:'x',rejected_at:'bad'},error:null}).loadLoanRejectionDetails('APP'));
 const data={reason:'Established reason',rejected_at:'2026-11-10T00:00:00Z',rejected_by:'Administrator'};assert.deepEqual(await setup({data,error:null}).loadLoanRejectionDetails('APP'),data);
});
