// Read-only integration check against the deployed schema. No identities are printed.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {createClient} from "@supabase/supabase-js";
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const paths=[
 "src/lib/api.ts","src/lib/activeLoansData.ts","src/lib/documentWorkspaceData.ts",
 "src/lib/repaymentDetailsData.ts","src/components/dashboard/dashboard-data.ts",
 "src/components/loan-applications/LoanDetailsModal.tsx",
 "../coop_backend/supabase/edge-functions/secure-admin-action/index.ts",
];
for(const path of paths){
 const ast=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
 const columns=[];
 function visit(node){
  if(ts.isStringLiteral(node)&&node.text.includes("members:members!loan_applications_member_id_fkey"))columns.push(node.text);
  ts.forEachChild(node,visit);
 }
 visit(ast);
 assert.equal(columns.length,1,path+" must select one explicit borrower relationship");
 const result=await client.from("loan_applications").select(columns[0]).limit(1);
 assert.equal(result.error,null,path+": "+JSON.stringify(result.error));
 assert.ok(Array.isArray(result.data));
 const alias=result.data[0]?.members;
 assert.ok(alias===null||typeof alias==="object",path+" preserves the members response alias");
 console.log(path+": borrower relationship query passed");
}
// Verify the exact main-list query across the current pre-release portfolio.
const {data,error}=await client.from("loan_applications").select("member_id,members:members!loan_applications_member_id_fkey(id)").in("status",["pending","under review","approved","rejected"]);
assert.equal(error,null);
for(const row of data){const member=Array.isArray(row.members)?row.members[0]:row.members;assert.equal(member?.id,row.member_id);}
console.log("Loan Applications: "+data.length+" records loaded, each linked to its borrower.");
