import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync("node_modules/.cache/coop-loan-borrower-deploy/supabase/edge-functions/secure-admin-action/index.ts","utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
new Function("require","exports","Deno",code+"\nexports.executeLoanAction=executeLoanAction;")(name=>name.includes("/http/")?{serve:()=>{}}:{createClient:()=>{}},exports,{env:{get:()=>"synthetic"}});
function database(borrowerStatus="active",missingDocuments=false){
 const writes=[],queries=[];
 const client={from(table){
  const query={updated:null,select(columns){queries.push({table,columns});if(columns.includes("members"))assert.match(columns,/members:members!loan_applications_member_id_fkey!inner/);return this;},eq(){return this;},in(){return this;},neq(){return this;},
   update(value){this.updated=value;writes.push(value);return this;},insert:async()=>({error:null}),limit:async()=>({data:[],error:null}),
   single:async()=>({data:table==="loan_policy_settings"?{min_member_tenure_months:1,min_loan_amount:1,max_loan_amount:5000,collateral_required_above:10000}:query.updated?{application_id:"APP-TEST",...query.updated}:{id:"loan",member_id:"borrower",amount:1000,status:"pending",loan_type:"Business",co_maker_member_id:"inactive-comaker",members:{status:borrowerStatus,date_joined:"2020-01-01"}},error:null}),
   then(resolve){return Promise.resolve({data:missingDocuments?[]:[{kind:"payslip"},{kind:"validId"}],error:null}).then(resolve);},
  };return query;
 }};
 return {client,writes,queries};
}
test("approval checks the borrower when a distinct co-maker relationship exists",async()=>{
 const db=database();const result=await exports.executeLoanAction(db.client,"synthetic-actor","approve-loan","APP-TEST",{});
 assert.equal(result.status,"approved");assert.equal(db.writes.length,1);
});
test("the explicit relation preserves inactive-borrower and required-document protections",async()=>{
 const blocked=database("blocked");
 await assert.rejects(exports.executeLoanAction(blocked.client,"actor","approve-loan","APP-TEST",{}),/Only active members/);assert.equal(blocked.writes.length,0);
 const incomplete=database("active",true);
 await assert.rejects(exports.executeLoanAction(incomplete.client,"actor","approve-loan","APP-TEST",{}),/Payslip and valid identification/);assert.equal(incomplete.writes.length,0);
});
test("the staged function is exactly the verified hosted source plus one borrower qualifier",()=>{
 const base=readFileSync("docs/member-account-flow/deployed-source/supabase/edge-functions/secure-admin-action/index.ts.txt","utf8");
 assert.equal(source.replace("members:members!loan_applications_member_id_fkey!inner(status,date_joined)","members!inner(status,date_joined)"),base);
 assert.match(readFileSync("node_modules/.cache/coop-loan-borrower-deploy/supabase/config.toml","utf8"),/verify_jwt = true/);
});
