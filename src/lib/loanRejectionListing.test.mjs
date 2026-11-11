import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
test('existing application listing retains rejected records and filters in the established status contract',async()=>{
 const code=ts.transpileModule(readFileSync(new URL('./api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const calls=[];const exports={};const row={application_id:'APP-REJECTED',member_name:'Existing applicant',loan_type:'Emergency',amount:60000,status:'rejected',date_submitted:'2026-10-02',members:{member_id:'CSUCC-1',first_name:'Maria',last_name:'Cruz',membership_type:'regular'}};
 const query={select(columns){calls.push(['select',columns]);return this;},in(column,statuses){calls.push(['in',column,statuses]);return this;},order:async()=>({data:[row],error:null})};
 new Function('require','exports',code)(name=>name.endsWith('membership')?{normalizeMembershipType:value=>value}:{getSupabaseClient:()=>({from:table=>{calls.push(['from',table]);return query;}})},exports);
 const records=await exports.fetchLoanApplications();assert.equal(records.length,1);assert.equal(records[0].id,'APP-REJECTED');assert.equal(records[0].status,'Rejected');assert.equal(records[0].amount,'₱60,000.00');assert.ok(calls.find(call=>call[0]==='in')[2].includes('rejected'));
});
