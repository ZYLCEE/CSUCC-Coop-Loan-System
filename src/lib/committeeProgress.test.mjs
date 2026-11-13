import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
function load(path,imports={}){const exports={};new Function("require","exports",ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in imports))throw Error(name);return imports[name];},exports);return exports;}
class CommitteeError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const {withCommitteeApprovalProgress:enrich}=load("./committeeProgressServer.ts",{"./committeeServer":{CommitteeError,checkCommitteeError:error=>{if(error)throw new CommitteeError("Backend unavailable",503);}}});
const {committeeApprovalLabel,committeeDecisionLabel,crecomConfirmationProgress}=load("./committeeReviewPresentation.ts");
const assignment={id:"own",state:"assigned",assigned:3,responded:2};
function fixture({thirdDecision=null,missing=false,error=false}={}){
 const calls=[];
 const assignments=[{id:"own",review_cycle_id:"admitted",state:"assigned",signatory_role:"crecom_member",member_number:1},{id:"two",review_cycle_id:"admitted",state:"decision_recorded",signatory_role:"crecom_member",member_number:2},{id:"chair",review_cycle_id:"admitted",state:"decision_recorded",signatory_role:"crecom_chairperson",member_number:null},{id:"replaced",review_cycle_id:"admitted",state:"reassigned"},{id:"cancelled",review_cycle_id:"admitted",state:"cancelled"},{id:"unrelated",review_cycle_id:"another-application",state:"decision_recorded"}];
 if(thirdDecision)assignments[0].state="decision_recorded";
 const decisions=[{assignment_id:"two",decision:"approve",reviewer_name:"Member Two",created_at:"2026-11-12T00:00:00Z",reason:"Private"},{assignment_id:"chair",decision:"approve",reviewer_name:"Chairperson",created_at:"2026-11-12T00:01:00Z"},{assignment_id:"cancelled",decision:"approve"},{assignment_id:"unrelated",decision:"reject"},...(thirdDecision?[{assignment_id:"own",decision:thirdDecision,reviewer_name:"Member One",created_at:"2026-11-12T00:02:00Z"}]:[])];
 const service={from(table){let fields,filters=[];return {select(value){fields=value;return this;},in(column,values){filters.push([column,values]);return this;},then(resolve){calls.push({table,fields,filters});let rows=(table==="review_assignments"?assignments:decisions).filter(row=>filters.every(([key,values])=>values.includes(row[key])));if(missing&&fields==="id,review_cycle_id")rows=[];return Promise.resolve({error:error?{message:"failed"}:null,data:rows.map(row=>Object.fromEntries(fields.split(",").map(key=>[key,row[key]])))}).then(resolve);}};}};
 return {service,calls};
}
test("two approvals and one pending stay at 2 of 3; response totals are never used",async()=>{
 const f=fixture(),[row]=await enrich(f.service,[assignment]);
 assert.equal(row.approvalProgress.approved,2);assert.equal(row.approvalProgress.total,3);assert.equal(row.myDecision,null);
 assert.equal(committeeApprovalLabel(row),"2 of 3 approved");assert.equal(committeeDecisionLabel(row),"Pending Review");
 assert.deepEqual(row.approvalProgress.reviewers.map(item=>item.id),["own","two","chair"]);
 assert.equal(row.approvalProgress.reviewers[2].reviewer,"Chairperson");
 assert.equal(JSON.stringify(row).includes("Private"),false);
 assert.deepEqual(f.calls[0].filters,[["id",["own"]]]);assert.deepEqual(f.calls[1].filters[0],["review_cycle_id",["admitted"]]);
 assert.equal(f.calls.some(call=>call.fields.includes("reason")),false);
});
test("a rejection is visible and never counted as a third approval",async()=>{
 const f=fixture({thirdDecision:"reject"}),[row]=await enrich(f.service,[assignment]);
 assert.equal(row.approvalProgress.approved,2);assert.equal(row.approvalProgress.rejected,1);
 assert.match(committeeApprovalLabel(row),/Rejected/);assert.equal(committeeDecisionLabel(row),"Rejected");
});
test("all three actual decisions show 3 of 3 approved",async()=>{
 const f=fixture({thirdDecision:"approve"}),[row]=await enrich(f.service,[assignment]);
 assert.equal(committeeApprovalLabel(row),"3 of 3 approved");assert.equal(committeeDecisionLabel(row),"Approved");
});
test("missing admitted assignments and backend failures fail closed",async()=>{
 await assert.rejects(enrich(fixture({missing:true}).service,[assignment]),error=>error.status===409);
 await assert.rejects(enrich(fixture({error:true}).service,[assignment]),error=>error.status===503);
 const f=fixture();assert.deepEqual(await enrich(f.service,[]),[]);assert.equal(f.calls.length,0);
 assert.equal(committeeApprovalLabel(assignment),"Approval progress unavailable");
});
test("BOD requires three approved numbered CRECOM positions, including its chairperson",()=>{
 const rows=[{signatoryRole:"crecom_member",committeeMemberNumber:1,decision:"approve"},{signatoryRole:"crecom_member",committeeMemberNumber:2,decision:"approve"},{signatoryRole:"crecom_chairperson",decision:"approve"}];
 assert.equal(crecomConfirmationProgress(rows).complete,true);
 assert.equal(crecomConfirmationProgress(rows.slice(0,2)).complete,false);
 assert.equal(crecomConfirmationProgress([...rows.slice(0,2),{...rows[2],decision:"reject"}]).complete,false);
 assert.equal(crecomConfirmationProgress([rows[0],rows[0],rows[2]]).complete,false);
 assert.equal(crecomConfirmationProgress(undefined).complete,false);
});
