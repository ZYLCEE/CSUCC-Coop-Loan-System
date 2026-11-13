import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const load=(path,imports={})=>{const exports={};new Function("require","exports",ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(key=>{if(!(key in imports))throw Error(key);return imports[key];},exports);return exports;};
class CommitteeError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const assignmentId="10000000-0000-4000-8000-000000000001";
const admitted={id:assignmentId,applicationId:"APP-TEST",stage:"BOD",state:"assigned",crecomConfirmations:[]};
function fixture(change=()=>{},options={}){
 const calls=[],cycle={application_id:"application-one",cycle_no:1,packet_version:3,policy_id:"policy-one",packet_snapshot:{stateHash:"a".repeat(64)}};
 const cycles=[{...cycle,id:"bod-cycle",stage:"BOD",status:"open",outcome:null,required_approvals:1,reviewer_target:1},{...cycle,id:"crecom-cycle",stage:"CRECOM",status:"completed",outcome:"approve",required_approvals:3,reviewer_target:3},
  {...cycle,id:"newer-cycle",cycle_no:2,packet_version:4,stage:"CRECOM",status:"completed",outcome:"approve",required_approvals:3,reviewer_target:3},{...cycle,id:"unrelated-cycle",application_id:"another-application",stage:"CRECOM",status:"completed",outcome:"approve",required_approvals:3,reviewer_target:3}];
 const assignments=[{id:assignmentId,review_cycle_id:"bod-cycle",reviewer_auth_id:"bod-user",signatory_role:"bod_chairperson",member_number:null,state:"assigned"},...[1,2,3].map(n=>({id:"reviewer-"+n,review_cycle_id:"crecom-cycle",reviewer_auth_id:"person-"+n,signatory_role:n===3?"crecom_chairperson":"crecom_member",member_number:n===3?null:n,state:"decision_recorded"})),{id:"cancelled",review_cycle_id:"crecom-cycle",state:"cancelled"},{id:"reassigned",review_cycle_id:"crecom-cycle",state:"reassigned"},{id:"other-person",review_cycle_id:"unrelated-cycle",state:"decision_recorded"}];
 const decisions=assignments.slice(1,4).map(row=>({id:"decision-"+row.id,assignment_id:row.id,reviewer_auth_id:row.reviewer_auth_id,signatory_role:row.signatory_role,member_number:row.member_number,packet_version:3,decision:"approve",reviewer_name:row.member_number===1?"Kenneth Baldomar":row.member_number===2?"Edrian Prones":"Maria Alma Abamonga",created_at:"2026-11-12T01:09:00Z",reason:"Private reviewer reason"}));
 change({cycles,assignments,decisions});
 const tables={application_review_cycles:cycles,review_assignments:assignments,individual_review_decisions:decisions};
 const service={from(table){let fields,filters=[];return {select(value){fields=value;return this;},in(key,values){filters.push([key,values]);return this;},then(resolve){calls.push({table,fields,filters});const data=tables[table].filter(row=>filters.every(([key,values])=>values.includes(row[key]))).map(row=>Object.fromEntries(fields.split(",").map(field=>field.includes(":")?[field.split(":")[0],row.packet_snapshot?.stateHash]:[field,row[field]])));return Promise.resolve({data,error:options.errorTable===table?{code:"XX000"}:null}).then(resolve);}};}};
 const server={CommitteeError,checkCommitteeError:error=>{if(error)throw new CommitteeError("Query failed",503);},committeeServiceClient:()=>service,validCommitteeUuid:value=>value===assignmentId,committeeReply:value=>Response.json(value,{headers:{"Cache-Control":"no-store"}}),committeeFailure:error=>Response.json({error:error.message},{status:error.status??503}),committeeSession:async()=>({user:{id:"bod-user",app_metadata:{role:"bod_member"}},session:{rpc:async()=>{if(options.denied)throw new CommitteeError("Assignment access revoked",403);return {data:options.workspace?{assignments:[admitted],history:[],counts:{}}:{assignment:admitted,summary:{},canRespond:options.canRespond!==false,...(options.rootEmpty?{crecomConfirmations:[]}: {})},error:null};}}})};
 const progress=load("./committeeProgressServer.ts",{"./committeeServer":server});
 const api=load("../app/api/committee/route.ts",{"@supabase/supabase-js":{},"@/lib/committeeServer":server,"@/lib/committee":{getCommitteeRole:user=>user.app_metadata.role},"@/lib/profileModel":{},"@/lib/committeeAuthUpdate":{},"@/lib/committeeProgressServer":progress});
 return {calls,run:()=>progress.withCommitteeApprovalProgress(service,[admitted]),api};
}
test("legacy BOD RPC gets all three recorded CRECOM confirmations for its exact snapshot",async()=>{
 const f=fixture(),[row]=await f.run();assert.equal(row.crecomConfirmations.length,3);
 assert.deepEqual(row.crecomConfirmations.map(item=>item.reviewer),["Kenneth Baldomar","Edrian Prones","Maria Alma Abamonga"]);
 assert.deepEqual(row.crecomConfirmations.map(item=>item.committeeMemberNumber),[1,2,null]);
 assert.ok(row.crecomConfirmations.every(item=>item.decision==="approve"&&item.createdAt&&item.reference));
 assert.equal(JSON.stringify(row).includes("Private reviewer reason"),false);
 assert.equal(f.calls.some(call=>call.fields.includes("reason")),false);
 const parentRequest=f.calls.find(call=>call.table==="application_review_cycles"&&call.filters.some(([key])=>key==="application_id"));assert.deepEqual(parentRequest.filters.find(([key])=>key==="application_id"),["application_id",["application-one"]]);
 const decisionReads=f.calls.filter(call=>call.table==="individual_review_decisions");assert.equal(JSON.stringify(decisionReads).includes("other-person"),false);assert.equal(JSON.stringify(decisionReads).includes("cancelled"),false);
});
test("another cycle, document snapshot, policy or application cannot supply the confirmations",async()=>{
 for(const change of [data=>data.cycles[1].cycle_no=9,data=>data.cycles[1].packet_version=2,data=>data.cycles[1].policy_id="different",data=>data.cycles[1].packet_snapshot={stateHash:"different"},data=>data.cycles[1].application_id="unrelated",data=>data.cycles[1].status="superseded"]){const [row]=await fixture(change).run();assert.deepEqual(row.crecomConfirmations,[]);}
});
test("two approvals, rejection, duplicate reviewers or positions, and invalid decision bindings stay blocked",async()=>{
 for(const change of [data=>data.decisions.pop(),data=>data.decisions[2].decision="reject",data=>data.assignments[2].state="awaiting_clarification",data=>data.assignments[2].reviewer_auth_id="person-1",data=>{data.assignments[2].member_number=1;data.decisions[1].member_number=1;},data=>data.decisions[0].reviewer_auth_id="someone-else",data=>data.decisions[0].packet_version=1,data=>data.decisions[0].signatory_role="bod_chairperson"]){const [row]=await fixture(change).run();assert.deepEqual(row.crecomConfirmations,[]);}
});
test("legacy nullable decision numbers use the recorded assignment numbers",async()=>{
 const [row]=await fixture(data=>{data.decisions[0].member_number=null;data.decisions[1].member_number=null;}).run();assert.deepEqual(row.crecomConfirmations.map(item=>item.committeeMemberNumber),[1,2,null]);
});
test("the actual GET packet API fills both response locations even when the legacy root is empty",async()=>{
 const f=fixture(()=>{},{rootEmpty:true}),response=await f.api.GET(new Request("https://synthetic.invalid/api/committee?operation=packet&assignmentId="+assignmentId));assert.equal(response.status,200);const data=await response.json();assert.equal(data.canRespond,true);assert.equal(data.crecomConfirmations.length,3);assert.deepEqual(data.crecomConfirmations,data.assignment.crecomConfirmations);
});
test("GET preserves the database's stale/closed guard and denies non-admitted assignments before enrichment",async()=>{
 const closed=fixture(()=>{},{canRespond:false}),response=await closed.api.GET(new Request("https://synthetic.invalid/api/committee?operation=packet&assignmentId="+assignmentId));assert.equal((await response.json()).canRespond,false);
 const denied=fixture(()=>{},{denied:true});assert.equal((await denied.api.GET(new Request("https://synthetic.invalid/api/committee?operation=packet&assignmentId="+assignmentId))).status,403);assert.equal(denied.calls.length,0);
 await assert.rejects(fixture(()=>{},{errorTable:"application_review_cycles"}).run(),error=>error.status===503);
});
test("the BOD workspace gets the same confirmations and an incomplete panel cannot enable packet decisions",async()=>{
 const complete=fixture(()=>{},{workspace:true}),response=await complete.api.GET(new Request("https://synthetic.invalid/api/committee?operation=workspace"));assert.equal((await response.json()).assignments[0].crecomConfirmations.length,3);
 const partial=fixture(data=>data.decisions.pop()),packet=await partial.api.GET(new Request("https://synthetic.invalid/api/committee?operation=packet&assignmentId="+assignmentId));const data=await packet.json();assert.equal(data.canRespond,false);assert.deepEqual(data.crecomConfirmations,[]);
});
