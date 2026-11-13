import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const exports={};
new Function('exports',ts.transpileModule(readFileSync(new URL('./applicationWorkflow.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);
const {displayVerificationBlocker,emptyWorkflowPolicy,validateWorkflowPolicy,validateVerificationDraft,workflowStageLabels,workflowStagePresentation,workflowStageLabel}=exports;
test('workflow stage labels distinguish verification, committee, final decision and rejection states',()=>{
 assert.equal(workflowStageLabels.not_started,'Verification not started');
 assert.equal(workflowStageLabels.crecom_review,'CRECOM review');
 assert.equal(workflowStageLabels.bod_review,'BOD review');
 assert.equal(workflowStageLabels.ready_for_final,'Awaiting final authority');
 assert.equal(workflowStageLabels.final_rejected,'Final rejection recorded');
});
test('stale workflow packets show re-verification rather than an unqualified stage',()=>{
 assert.deepEqual(workflowStagePresentation('ready_for_committee',true),{
 label:'Packet needs re-verification',
 staleNotice:'The recorded review packet is stale and requires re-verification.',
 });
 assert.deepEqual(workflowStagePresentation('ready_for_committee',false),{label:'Ready to forward',staleNotice:null});
});
test('unstarted returned applications receive an accurate table stage without inventing verification',()=>{
 assert.equal(workflowStageLabel(undefined,'Returned'),'Returned for requirements');
 assert.equal(workflowStageLabel(undefined,'Pending'),'Verification not started');
 assert.equal(workflowStageLabel(undefined,'Approved'),undefined);
 assert.equal(workflowStageLabel({applicationId:'APP-1',stage:'crecom_review',revision:1,stale:false,enrolled:true},'Pending'),'CRECOM review');
 assert.equal(workflowStageLabel({applicationId:'APP-2',stage:'ready_for_committee',revision:2,stale:true,enrolled:true},'Pending'),'Packet needs re-verification');
});
test('witness blockers describe the borrower-submitted names the policy counts',()=>{
 assert.equal(displayVerificationBlocker('Required witness attestations have not been recorded for this packet.'),'Required witness names have not been recorded for this packet.');
 assert.equal(displayVerificationBlocker('Current borrower consent evidence has not been recorded.'),'Current borrower consent evidence has not been recorded.');
});
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
