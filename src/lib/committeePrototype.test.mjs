import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const load=(path,imports={})=>{const exports={};new Function("require","exports",ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(!(name in imports))throw new Error("Unexpected dependency "+name);return imports[name];},exports);return exports;};
const validation=load("./committeeReview.ts"),model=load("./committeePrototype.ts",{"./committeeReview":validation});
const accounts=model.prototypeAccounts,loan=model.prototypeCases[0];
const mutation=(store,account,decision="approve",patch={})=>{const workspace=model.prototypeWorkspace(store,account),assignment=workspace.assignments.find(row=>row.applicationId===loan.applicationId);return {operation:decision,applicationId:loan.applicationId,revision:store.revision,stateHash:String(store.revision).padStart(64,"0"),requestId:crypto.randomUUID(),password:account.password,payload:{assignmentId:assignment?.id,reason:"Sample review note",confirmed:true},...patch};};
test("four distinct public sample identities have the exact positions and no real account role",()=>{
 assert.equal(new Set(accounts.map(row=>row.email)).size,4);assert.equal(new Set(accounts.map(row=>row.password)).size,4);
 assert.deepEqual(accounts.map(row=>row.signatoryRole),["crecom_member","crecom_member","crecom_chairperson","bod_chairperson"]);
 for(const account of accounts){assert.equal(model.prototypeSignIn(account.email,account.password),account);assert.match(account.email,/\.invalid$/);}
 assert.throws(()=>model.prototypeSignIn("real@example.com",accounts[0].password));
});
test("BOD receives the shared sample case only after all three CRECOM confirmations",()=>{
 const store=model.createPrototypeStore();assert.equal(model.prototypeWorkspace(store,accounts[3]).assignments.some(row=>row.applicationId===loan.applicationId),false);
 for(const account of accounts.slice(0,3))model.recordPrototypeReview(store,account,mutation(store,account));
 const assignment=model.prototypeWorkspace(store,accounts[3]).assignments.find(row=>row.applicationId===loan.applicationId);
 assert.ok(assignment);const packet=model.prototypePacket(store,accounts[3],assignment.id);assert.equal(packet.crecomConfirmations.length,3);assert.equal(packet.crecomConfirmations.every(row=>row.decision==="approve"),true);
 model.recordPrototypeReview(store,accounts[3],mutation(store,accounts[3]));assert.equal(model.sampleFlow(store,loan.id),"Ready for staff final decision");
});
test("sample confirmation requires its own password, acknowledgment and unchanged revision; retries are idempotent",()=>{
 const store=model.createPrototypeStore(),account=accounts[0],body=mutation(store,account);
 assert.throws(()=>model.recordPrototypeReview(store,account,{...body,password:accounts[1].password}),/prototype password/);
 assert.throws(()=>model.recordPrototypeReview(store,account,{...body,payload:{...body.payload,confirmed:false}}),/Confirm your decision/);
 assert.throws(()=>model.recordPrototypeReview(store,account,{...body,revision:999}),/progress changed/);
 model.recordPrototypeReview(store,account,body);const revision=store.revision;
 assert.deepEqual(model.recordPrototypeReview(store,account,body),{success:true});assert.equal(store.revision,revision);
 assert.throws(()=>model.recordPrototypeReview(store,account,{...body,requestId:crypto.randomUUID(),revision,stateHash:String(revision).padStart(64,"0")}),/already recorded/);
});
test("one sample identity cannot confirm another person's assignment or perform final approval",()=>{
 const store=model.createPrototypeStore(),body=mutation(store,accounts[0]);
 assert.throws(()=>model.recordPrototypeReview(store,accounts[1],{...body,password:accounts[1].password}),/not assigned/);
 assert.throws(()=>model.recordPrototypeReview(store,accounts[0],{...body,operation:"finalize"}),/Only individual sample/);
});
test("one rejection stops further decisions and never routes the sample case to BOD",()=>{
 const store=model.createPrototypeStore();model.recordPrototypeReview(store,accounts[0],mutation(store,accounts[0],"reject"));
 assert.equal(model.prototypeWorkspace(store,accounts[3]).assignments.some(row=>row.applicationId===loan.applicationId),false);
 assert.throws(()=>model.recordPrototypeReview(store,accounts[1],mutation(store,accounts[1])),/rejection stopped/);
 assert.match(model.sampleFlow(store,loan.id),/rejection recorded/);
});

test("local prototype transport has no external service fallback and rejects management and unassigned files",async()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},active={id:accounts[0].id};
 const service=model.createPrototypeServices(accounts[0],storage,()=>active.id);
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw new Error("Unexpected network");};
 try{
  const work=await service.committeeRequest();assert.equal(work.assignments.length,3);
  await assert.rejects(service.committeeRequest("",{},true),/cannot manage real accounts/);
  await assert.rejects(service.committeeRequest("operation=file&assignmentId=unknown&documentId=unknown"),/not assigned/);
  const store=model.parsePrototypeStore(storage.getItem(model.prototypeStoreKey));
  await service.reviewRequest("",{method:"POST",body:JSON.stringify(mutation(store,accounts[0]))});
  assert.ok(values.has(model.prototypeStoreKey));assert.equal(network,0);
  active.id=accounts[1].id;await assert.rejects(service.committeeRequest(),/choose this sample account/);
 }finally{globalThis.fetch=originalFetch;}
});
test("invalid storage resets to fictional fixtures without loading another data source",()=>{
 for(const value of [null,"not json",'{"version":99}',JSON.stringify({version:1,revision:1,responses:{},profiles:{},requests:{},readNotifications:[]})])assert.deepEqual(model.parsePrototypeStore(value),model.createPrototypeStore());
});
test("sample review alerts have independent read state for each reviewer",async()=>{
 const store=model.createPrototypeStore(),body=mutation(store,accounts[0]);model.recordPrototypeReview(store,accounts[0],body);
 const values=new Map([[model.prototypeStoreKey,JSON.stringify(store)]]),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const first=model.createPrototypeServices(accounts[0],storage,()=>accounts[0].id),second=model.createPrototypeServices(accounts[1],storage,()=>accounts[1].id);
 await first.committeeRequest("",{method:"POST",body:JSON.stringify({operation:"read",id:body.requestId})});
 assert.equal((await first.committeeRequest("operation=inbox")).find(row=>row.id===body.requestId).read,true);
 assert.equal((await second.committeeRequest("operation=inbox")).find(row=>row.id===body.requestId).read,false);
});
