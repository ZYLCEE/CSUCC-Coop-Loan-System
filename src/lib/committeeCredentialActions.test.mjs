import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import ts from "typescript";
const load=(path,imports={})=>{const exports={};new Function("require","exports",ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(key=>{if(!(key in imports))throw Error(key);return imports[key];},exports);return exports;};
class CommitteeError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const account="10000000-0000-4000-8000-000000000001",requestId="10000000-0000-4000-8000-000000000002",userId="10000000-0000-4000-8000-000000000003";
const model=load("./committee.ts",{"./auth/roles":{}});
process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-test-key";
function fixture(options={}){
 const calls=[],user={id:userId,app_metadata:{role:options.wrongRole?"super_admin":"bod_member",keep:"preserved",...(options.receipt?{committee_credential_action_id:requestId}:{})}};
 const service={auth:{admin:{getUserById:async id=>{calls.push({kind:"get",id});return {data:{user},error:options.lookupFailure?{}:null};},updateUserById:async(id,attributes)=>{calls.push({kind:"update",id,attributes});return {error:options.providerFailure?{}:null};},deleteUser:async(id,soft)=>{calls.push({kind:"delete",id,soft});return {error:options.providerFailure?{}:null};}}}};
 const server={CommitteeError,validCommitteeUuid:value=>typeof value==="string"&&/^[0-9a-f-]{36}$/.test(value),committeeServiceClient:()=>service,checkCommitteeError:error=>{if(error)throw new CommitteeError("Backend refused the action",error.code==="42501"?403:503);}};
 const {changeCommitteeCredentials:change}=load("./committeeCredentialActions.ts",{"node:crypto":{createHmac},"./committee":model,"./committeeServer":server});
 const session={rpc:async(name,args)=>{calls.push({kind:"rpc",name,args});if(name==="committee_begin_credential_action")return {data:{complete:!!options.complete,result:{success:true},userId,role:"bod_member",authDeleted:!!options.deleted},error:options.beginFailure?{code:options.beginFailure}:null};if(name==="committee_finish_credential_action")return {data:{success:true},error:options.finishFailure?{}:null};return {data:{success:true},error:null};}};
 const body={operation:"reset",id:account,revision:2,requestId,payload:{reason:"Forgot temporary password"},credentials:{password:"Synthetic-Temporary1!",confirm:"Synthetic-Temporary1!"}};
 return {calls,body,run:body=>change(session,new Request("https://synthetic.invalid/api/admin/committee-accounts"),body)};
}
test("password reset reserves exact inputs before Auth; SQL receives no password or confirmation",async()=>{
 const f=fixture();assert.equal((await f.run(f.body)).success,true);
 assert.equal(f.calls[0].name,"committee_begin_credential_action");
 const auth=f.calls.find(call=>call.kind==="update");assert.equal(auth.attributes.password,f.body.credentials.password);assert.equal(auth.attributes.app_metadata.keep,"preserved");assert.equal(auth.attributes.app_metadata.committee_credential_action_id,requestId);
 const sql=JSON.stringify(f.calls.filter(call=>call.kind==="rpc"));assert.equal(sql.includes(f.body.credentials.password),false);assert.equal(sql.includes('"confirm"'),false);
 assert.match(f.calls[0].args.p_fingerprint,/^[0-9a-f]{64}$/);
});
test("validation, database denial and missing migration stop before provider access",async()=>{
 const weak=fixture();await assert.rejects(weak.run({...weak.body,credentials:{password:"weak",confirm:"weak"}}));assert.equal(weak.calls.length,0);
 for(const code of ["42501","PGRST202"]){const f=fixture({beginFailure:code});await assert.rejects(f.run(f.body),error=>error.status===(code==="42501"?403:503));assert.equal(f.calls.some(call=>call.kind!=="rpc"),false);}
});
test("completed retries and Auth receipts never reset an already-updated password again",async()=>{
 const completed=fixture({complete:true});assert.equal((await completed.run(completed.body)).success,true);assert.equal(completed.calls.length,1);
 const receipt=fixture({receipt:true});await receipt.run(receipt.body);assert.equal(receipt.calls.some(call=>call.kind==="update"),false);assert.equal(receipt.calls.at(-1).name,"committee_finish_credential_action");
});
test("provider errors, identity mismatch and incomplete finish never report success; failed requests can recover",async()=>{
 for(const options of [{providerFailure:true},{wrongRole:true},{finishFailure:true},{lookupFailure:true}]){
  const f=fixture(options);await assert.rejects(f.run(f.body));assert.equal(f.calls.at(-1).name,"committee_fail_credential_action");
  if(options.wrongRole||options.lookupFailure)assert.equal(f.calls.some(call=>call.kind==="update"),false);
 }
});
test("Delete uses soft Auth deletion, confirms it in SQL, and can finish an already-deleted retry",async()=>{
 const f=fixture();await f.run({...f.body,operation:"delete",credentials:undefined});assert.deepEqual(f.calls.find(call=>call.kind==="delete"),{kind:"delete",id:userId,soft:true});assert.equal(f.calls.at(-1).name,"committee_finish_credential_action");
 const retry=fixture({deleted:true});await retry.run({...retry.body,operation:"delete"});assert.equal(retry.calls.some(call=>call.kind!=="rpc"),false);
});
