import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const exports={};
new Function('exports',ts.transpileModule(readFileSync(new URL('./applicationWorkflow.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);
const {emptyWorkflowPolicy,validateWorkflowPolicy,validateVerificationDraft}=exports;
test('policy starts with pending governance values and never guesses quorum or witness count',()=>{
 assert.equal(emptyWorkflowPolicy.reviewerCount,null);assert.equal(emptyWorkflowPolicy.witnessCount,null);
 assert.equal(emptyWorkflowPolicy.crecomAuthority,'pending');assert.equal(emptyWorkflowPolicy.bodMode,'pending');
 const draft=validateWorkflowPolicy({name:' CSUCC draft ',config:emptyWorkflowPolicy,authorizationReference:''});
 assert.equal(draft.name,'CSUCC draft');assert.deepEqual(draft.config.allowedConsentMethods,[]);
});
test('policy draft rejects invalid bounds, options and strings while allowing deliberately pending values',()=>{
 const draft={name:'CSUCC draft',config:emptyWorkflowPolicy,authorizationReference:''};
 for(const patch of[{reviewerCount:0},{reviewerCount:2.5},{witnessCount:-1},{allowedConsentMethods:['email']},{crecomAuthority:'majority'},{borrowerConsentRequired:'yes'},{quorumRule:'x'.repeat(2001)}]){
   assert.throws(()=>validateWorkflowPolicy({...draft,config:{...emptyWorkflowPolicy,...patch}}));
 }
 assert.throws(()=>validateWorkflowPolicy({...draft,name:' '}));
 assert.throws(()=>validateWorkflowPolicy({...draft,authorizationReference:'x'.repeat(501)}));
 assert.equal(validateWorkflowPolicy({...draft,config:{...emptyWorkflowPolicy,reviewerCount:3,witnessCount:1}}).config.reviewerCount,3);
});
test('staff checklist cannot smuggle consent or approval claims into draft checks',()=>{
 const draft={checks:{identity:true,eligibility:false,terms:true},notes:' Internal note '};
 assert.equal(validateVerificationDraft(draft).notes,'Internal note');
 assert.throws(()=>validateVerificationDraft({...draft,checks:{...draft.checks,borrowerConsent:true}}));
 assert.throws(()=>validateVerificationDraft({...draft,checks:{...draft.checks,identity:'true'}}));
 assert.throws(()=>validateVerificationDraft({...draft,notes:'x'.repeat(2001)}));
});
