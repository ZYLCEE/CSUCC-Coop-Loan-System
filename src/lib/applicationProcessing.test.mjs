import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const model={};
new Function('exports',ts.transpileModule(readFileSync(new URL('./applicationProcessing.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(model);
const {currentProcessingStep,processingStepDescription,committeeProgress,processingStepState}=model;
const app=(stage,patch={})=>({stage,enrolled:true,stale:false,canEnroll:true,...patch});
const review=(verificationStage,cycles=[],patch={})=>({verificationStage,cycles,finalDecision:null,...patch});

test('requirements cannot be skipped by navigation or a mismatched review response',()=>{
 for(const stage of ['not_started','needs_verification','returned_for_requirements'])assert.equal(currentProcessingStep(app(stage),review('ready_for_committee')),1);
 assert.equal(currentProcessingStep(app('not_started',{enrolled:false}),null),1);
 assert.equal(currentProcessingStep(app('ready_for_committee'),null),2);
});
test('approval opens the fifth release step and rejection stays at final decision',()=>{
 for(const [stage,step] of [['crecom_review',2],['ready_for_bod',3],['bod_review',3],['ready_for_final',4],['final_approved',5],['final_rejected',4]])assert.equal(currentProcessingStep(app(stage),review(stage)),step);
 assert.equal(currentProcessingStep(app('review_attention'),review('review_attention',[{stage:'BOD',status:'superseded'},{stage:'CRECOM',status:'open'}])),2);
 assert.equal(currentProcessingStep(app('review_attention'),review('review_attention',[{stage:'BOD',status:'open'}])),3);
});
test('stale packets return to requirements without hiding a recorded final decision',()=>{
 assert.equal(currentProcessingStep(app('bod_review',{stale:true}),review('bod_review')),1);
 assert.equal(currentProcessingStep(app('review_stale'),review('review_stale')),1);
 assert.equal(currentProcessingStep(app('final_approved',{stale:true}),review('final_approved',[],{finalDecision:{decision:'approve'}})),5);
});
test('progress excludes reassigned reviewers and explains clarification instead of claiming completion',()=>{
 const assignments=[{state:'reassigned',decision:'approve'},{state:'decision_recorded',decision:'approve'},{state:'assigned',decision:null},{state:'assigned',decision:null}];
 const state=review('crecom_review',[{stage:'CRECOM',status:'open',reviewerTarget:3,assignments}]);
 assert.match(processingStepDescription(2,app('crecom_review'),state),/^1 of 3 CRECOM confirmations approved/);
 assignments[2].state='awaiting_clarification';
 assert.match(processingStepDescription(2,app('review_attention'),state),/Reviewer actions/);
});
test('final approval explains release separately and missing review service never claims readiness',()=>{
 assert.match(processingStepDescription(5,app('final_approved'),review('final_approved',[],{finalDecision:{decision:'approve'}})),/awaiting release/);
 assert.equal(processingStepState(5,app('final_approved',{loanStatus:'approved'}),null),'pending');
 assert.equal(processingStepState(5,app('final_approved',{loanStatus:'released'}),null),'complete');
 assert.match(processingStepDescription(2,app('ready_for_committee'),null),/could not be loaded/);
});

test('a completed review is checked only when the two members and chairperson all approved',()=>{
 const assignments=['crecom_member','crecom_member','crecom_chairperson'].map((signatoryRole,index)=>({id:String(index),signatoryRole,state:'decision_recorded',decision:'approve'}));
 const cycle={stage:'CRECOM',status:'completed',outcome:'approve',assignments};
 const state=review('crecom_review',[cycle]);
 assignments[2].state='assigned';assignments[2].decision=null;
 assert.equal(committeeProgress(state,'CRECOM').approvedCount,2);
 assert.equal(processingStepState(2,app('crecom_review'),state),'pending');
 assignments[2].state='decision_recorded';assignments[2].decision='reject';cycle.outcome='reject';
 assert.equal(processingStepState(2,app('review_attention'),state),'rejected');
 assignments[2].decision='approve';cycle.outcome='approve';
 assert.equal(processingStepState(2,app('ready_for_bod'),state),'complete');
 assignments[2].signatoryRole='crecom_member';assert.equal(committeeProgress(state,'CRECOM').approved,false);
 assignments[2].signatoryRole='crecom_chairperson';
 assert.equal(processingStepState(2,app('review_stale',{stale:true}),state),'pending');
 cycle.status='superseded';assert.equal(committeeProgress(state,'CRECOM').approvedCount,0);
});
