import {documentFixture} from './document-workspace';
import type {DocumentWorkspace} from '../../src/lib/documentWorkspace';
import type {ApplicationVerification} from '../../src/lib/applicationWorkflow';
type TestWindow=Window & {verificationData?:ApplicationVerification;documentFixture?:DocumentWorkspace;documentCalls?:unknown[];documentFailure?:boolean;paginationRecords?:{documents?:{id:string;name:string;createdAt:string;size:number}[]}};
export async function documentsRequest(query='',options?:RequestInit){
 const state=window as TestWindow;state.documentFixture??=structuredClone(documentFixture);
 const workspace=state.documentFixture;
 const params=new URLSearchParams(query);
 if(params.get('operation')==='file')return {url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l+cAAAAASUVORK5CYII=',contentType:'image/png',name:'Synthetic file',expiresAt:new Date(Date.now()+300000).toISOString()};
 if(params.get('operation')==='recipients')return [{id:'20000000-0000-0000-0000-000000000001',name:'Synthetic Maria Cruz',memberNumber:'CSUCC-TEST-1',membershipType:'regular',active:true}];
 if(!options){
   if(state.paginationRecords?.documents)workspace.shared=state.paginationRecords.documents.map(item=>({...documentFixture.shared[0],id:item.id,title:item.name,filename:item.name,createdAt:item.createdAt}));
   return structuredClone(workspace);
 }
 state.documentCalls??=[];state.documentCalls.push(options);await new Promise(resolve=>setTimeout(resolve,100));
 if(state.documentFailure)throw new Error('Backend rejected deletion');
 if(options.method==='DELETE'){const body=JSON.parse(String(options.body));workspace.shared=workspace.shared.filter(item=>item.id!==body.id);return {success:true};}
 if(options.body instanceof FormData){const body=JSON.parse(String(options.body.get('metadata')));const file=options.body.get('file') as File;workspace.shared.unshift({...documentFixture.shared[0],...body,filename:file.name,status:body.publish?'published':'draft',recipients:body.audience==='selected'?[{id:'20000000-0000-0000-0000-000000000001',name:'Synthetic Maria Cruz',memberNumber:'CSUCC-TEST-1',membershipType:'regular',active:true}]:[]});return {id:body.id};}
 const body=JSON.parse(String(options.body));
 if(body.operation==='review'&&state.verificationData){const file=state.verificationData.documents.find(item=>item.id===body.documentId)!;file.reviewStatus=body.status;file.reviewId=crypto.randomUUID();return {success:true};}
 if(body.operation==='review'){const file=workspace.applications.flatMap(item=>item.documents).find(item=>item.id===body.documentId)!;file.reviews.push({id:crypto.randomUUID(),versionId:body.versionId,status:body.status,reason:body.reason,reviewer:'Synthetic reviewer',createdAt:new Date().toISOString()});}
 if(body.operation==='publish'){const item=workspace.shared.find(item=>item.id===body.id)!;item.status='published';item.audience=body.audience;}
 return {success:true};
}
