// Internal read-only diagnostic for the reported application. Production requests
// must still pass the JWT-scoped assignment RPC before using this enrichment.
import {createClient} from "@supabase/supabase-js";
import {readFileSync,writeFileSync} from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
class CommitteeError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const checkCommitteeError=error=>{if(error)throw new CommitteeError("Read-only query failed: "+(error.code??"unavailable"),503);};
const exports={};new Function("require","exports",ts.transpileModule(readFileSync('src/lib/committeeProgressServer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(name!=="./committeeServer")throw Error("Unexpected diagnostic import");return {CommitteeError,checkCommitteeError};},exports);
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const application=await service.from('loan_applications').select('id,application_id').eq('application_id','LA-2026-026346').single();checkCommitteeError(application.error);
const cycle=await service.from('application_review_cycles').select('id').eq('application_id',application.data.id).eq('stage','BOD').in('status',['open','completed']).order('cycle_no',{ascending:false}).limit(1).single();checkCommitteeError(cycle.error);
const assignments=await service.from('review_assignments').select('id').eq('review_cycle_id',cycle.data.id).eq('signatory_role','bod_chairperson').in('state',['assigned','decision_recorded','awaiting_clarification','recused']);checkCommitteeError(assignments.error);
assert.equal(assignments.data.length,1);
const [result]=await exports.withCommitteeApprovalProgress(service,[{id:assignments.data[0].id,stage:'BOD'}]);
assert.deepEqual(result.crecomConfirmations.map(row=>row.reviewer),['Kenneth Baldomar','Edrian Prones','Maria Alma Abamonga']);
assert.deepEqual(result.crecomConfirmations.map(row=>row.committeeMemberNumber),[1,2,null]);
assert.ok(result.crecomConfirmations.every(row=>row.decision==='approve'&&row.createdAt&&row.reference));
const summary={applicationId:application.data.application_id,assignmentId:result.id,approved:result.crecomConfirmations.length,confirmations:result.crecomConfirmations,readOnly:true};
writeFileSync('docs/bod-handoff/compatibility-readonly-result.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
