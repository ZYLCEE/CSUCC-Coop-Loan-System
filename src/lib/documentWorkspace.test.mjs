import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path,imports={}){const exports={};const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',code)(name=>{if(!(name in imports))throw new Error('Unexpected import '+name);return imports[name];},exports);return exports;}
const model=load('./documentWorkspace.ts',{'./membership':load('./membership.ts')});
const {documentApplicationSummary,filterDocumentApplications,validateReview,validateSharing,memberDocumentRequirements}=model;
const file={id:'file',kind:'validId',versions:[{id:null,version:1,uploadedAt:'2026-11-01',name:'id.pdf'}],reviews:[{id:'r1',versionId:null,status:'verified',createdAt:'2026-11-02'}]};
const app={id:'app',memberName:'Maria Cruz',memberNumber:'CSUCC-TEST-1',applicationId:'APP-1',loanType:'Business',membershipType:'regular',requiredKinds:['validId','payslip'],documents:[file]};
test('uploaded requirements and verification remain distinct, replacement review applies only to current version',()=>{
 assert.equal(documentApplicationSummary(app).status,'awaiting_files');
 const complete={...app,documents:[file,{...file,id:'file2',kind:'payslip',reviews:[]}]};
 assert.equal(documentApplicationSummary(complete).complete,true);assert.equal(documentApplicationSummary(complete).status,'to_review');
 const replaced={...file,versions:[...file.versions,{id:'v2',version:2,uploadedAt:'2026-11-03'}]};
 assert.equal(model.latestFileReview(replaced),null);
 assert.equal(documentApplicationSummary({...app,requiredKinds:['validId'],documents:[replaced]}).status,'to_review');
 assert.equal(model.latestFileReview(replaced,null).status,'verified');
});
test('search and filters operate on existing applications and unknown requirements are never complete',()=>{
 const filters={search:'Maria Cruz',review:'all',completeness:'missing',membership:'regular'};
 assert.deepEqual(filterDocumentApplications([app],filters),[app]);
 assert.equal(filterDocumentApplications([app],{...filters,membership:'associate'}).length,0);
 assert.equal(documentApplicationSummary({...app,requiredKinds:null}).complete,null);
 assert.deepEqual(memberDocumentRequirements(50001,50000),['validId','payslip','collateral']);assert.equal(memberDocumentRequirements(50000,null),null);
});
test('review requires an actionable replacement reason and sharing requires explicit valid recipients',()=>{
 assert.throws(()=>validateReview('needs_replacement','  '),/reason/);assert.equal(validateReview('verified','old reason').reason,null);
 const sharing={title:' Form ',category:'Forms',description:'',audience:'selected',recipientIds:[],publish:true};
 assert.throws(()=>validateSharing(sharing),/at least one/);assert.equal(validateSharing({...sharing,publish:false}).publish,false);
 assert.throws(()=>validateSharing({...sharing,recipientIds:['fake']}),/valid member/);
 assert.equal(validateSharing({...sharing,audience:'all',recipientIds:['20000000-0000-0000-0000-000000000001']}).recipientIds.length,0);
});
test('file validation rejects disguised content, empty files and configured size/type violations',()=>{
 const dataHelpers=load('./documentWorkspaceData.ts',{'./documentWorkspace':model});
 const {validateSharedFile}=load('./sharedDocumentUpload.ts',{'node:crypto':{},'./documentWorkspaceData':dataHelpers});
 const bytes=Buffer.from('%PDF-1.7\nSynthetic');
 assert.equal(validateSharedFile({name:'form.pdf',size:bytes.length},bytes).contentType,'application/pdf');
 assert.throws(()=>validateSharedFile({name:'photo.png',size:bytes.length},bytes),/content/);
 assert.throws(()=>validateSharedFile({name:'form.pdf',size:bytes.length},bytes,5),/limit/);
 assert.throws(()=>validateSharedFile({name:'form.pdf',size:bytes.length},bytes,100,['png']),/supported/);
 const jpeg=Buffer.from([255,216,255,224]);assert.equal(validateSharedFile({name:'photo.jpeg',size:4},jpeg,100,['jpg']).contentType,'image/jpeg');
});
