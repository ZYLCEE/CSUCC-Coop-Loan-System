// Synthetic transport only. The browser harness blocks all network connections.
const state=window as unknown as Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const account={id:"membership-own",requestId:"saved-invite",userId:"reviewer-own",name:"Synthetic Maria Cruz",email:"maria@example.invalid",role:"crecom_member",committeeSeat:"member",committeeMemberNumber:1,title:"Credit committee",startsAt:"2026-01-01T00:00:00Z",endsAt:null,active:true,revision:2,setupCompletedAt:"2026-01-01",status:"active",lastSignInAt:null,assignedCount:1,lastInviteAt:null,error:null};
const assignment={id:"assignment-own",applicationId:"APP-OWN",applicant:"Synthetic Borrower",memberNumber:"TEST-3",loanType:"Business",amount:1000,stage:"CRECOM",cycle:1,packetVersion:2,assignedAt:"2026-11-10T00:00:00Z",dueAt:null,state:"assigned",responded:1,assigned:3};
const crecomConfirmations=[{reviewer:"Synthetic CRECOM Member One",signatoryRole:"crecom_member",committeeMemberNumber:1,decision:"approve",createdAt:"2026-11-10T01:00:00Z"},{reviewer:"Synthetic CRECOM Member Two",signatoryRole:"crecom_member",committeeMemberNumber:2,decision:"approve",createdAt:"2026-11-10T02:00:00Z"},{reviewer:"Synthetic CRECOM Chair",signatoryRole:"crecom_chairperson",committeeMemberNumber:null,decision:"approve",createdAt:"2026-11-10T03:00:00Z"}];
export function useCommitteeAuth(){
 return {prototype:false,role:state.committeeRole??"crecom_member",user:{id:"reviewer-own",email:"maria@example.invalid",user_metadata:{full_name:"Synthetic Maria Cruz",phone:""}},access:{name:"Synthetic Maria Cruz",email:"maria@example.invalid",allowed:true,role:state.committeeRole??"crecom_member"},refresh:async()=>{},signOut:async()=>{}};
}
export async function committeeRequest(query="",init:RequestInit={},management=false){
 await new Promise(resolve=>setTimeout(resolve,40));
 state.committeeCalls??=[];state.committeeRows??=[account];state.committeeInbox??=[{id:"note-own",title:"Review assigned",message:"Your packet is ready.",read:false,createdAt:"2026-11-10T00:00:00Z",assignmentId:"assignment-own",accessAvailable:true},{id:"note-revoked",title:"Assignment changed",message:"This assignment was reassigned.",read:true,createdAt:"2026-11-09T00:00:00Z",assignmentId:"assignment-revoked",accessAvailable:false}];
 const body=init.body?JSON.parse(String(init.body)):null;
 state.committeeCalls.push({query,management,body});
 if(init.method==="POST"){
  if(body.operation==="read"){if(state.committeeReadFailure)throw new Error("Unable to mark notification as read. Retry.");for(const item of state.committeeInbox)if(body.all||body.id===item.id)item.read=true;return structuredClone(state.committeeInbox);}
  if(state.committeeFailure)throw new Error(typeof state.committeeFailure==="string"?state.committeeFailure:"Synthetic provider request failed. Retry this saved request.");
  if(body.operation==="verify")return {verified:true};
  if(body.operation==="reset"){const row=state.committeeRows.find((row:{id:string})=>row.id===body.id);row.setupCompletedAt=null;row.status="invited";row.revision++;}
  if(body.operation==="delete")state.committeeRows=state.committeeRows.filter((row:{id:string})=>row.id!==body.id);
  if(["invite","create"].includes(body.operation))state.committeeRows.push({...account,...body.payload,id:body.requestId,requestId:body.requestId,status:"invited",setupCompletedAt:null,revision:1});
  if(["edit","deactivate","reactivate"].includes(body.operation)){const row=state.committeeRows.find((row:{id:string})=>row.id===body.id);if(body.operation==="edit")Object.assign(row,body.payload);else{row.active=body.operation==="reactivate";row.status=row.active?"active":"blocked";}row.revision++;}
  return {success:true,message:"Synthetic action completed.",warning:null};
 }
 if(management){
  if(query.startsWith("id="))return [{...assignment,needsReassignment:!state.committeeRows[0].active}];
  return structuredClone({accounts:state.committeeRows,bodEnabled:!!state.bodEnabled,accountActionsVersion:state.committeeActionsUnavailable?undefined:1});
 }
 const operation=new URLSearchParams(query).get("operation");
 if(operation==="inbox"){if(state.committeeInboxFailure)throw new Error("Notifications unavailable. Retry.");return structuredClone(state.committeeInbox);}
 if(operation==="packet"){
  if(state.committeePacketDenied)throw new Error("Access is no longer available for this assigned case.");
  return {assignment:{...assignment,crecomConfirmations:state.committeeRole==="bod_member"?crecomConfirmations:undefined,stage:state.committeeRole==="bod_member"?"BOD":"CRECOM",approvalProgress:state.committeeRole==="bod_member"?{approved:0,rejected:0,total:1,reviewers:[{id:"bod",position:"bod_chairperson",memberNumber:null,reviewer:null,state:"assigned",decision:null,decidedAt:null}]}:{approved:2,rejected:0,total:3,reviewers:[{id:"one",position:"crecom_member",memberNumber:1,reviewer:"Synthetic Member One",state:"decision_recorded",decision:"approve",decidedAt:"2026-11-10T01:00:00Z"},{id:"two",position:"crecom_member",memberNumber:2,reviewer:"Synthetic Member Two",state:"decision_recorded",decision:"approve",decidedAt:"2026-11-10T02:00:00Z"},{id:"three",position:"crecom_chairperson",reviewer:null,state:"assigned",decision:null,decidedAt:null}]}},crecomConfirmations:state.committeeRole==="bod_member"&&!state.committeeLegacyRoot?crecomConfirmations:[],canRespond:true,cycleStatus:"open",requiredApprovals:3,reviewerTarget:3,myDecision:null,thread:[],summary:{purpose:"Synthetic frozen application purpose",tenureMonths:12},findings:"Identity and terms verified.",consentSummary:"Borrower and co-maker consent recorded.",documents:[{documentId:"document-own",versionId:"version-pinned",kind:"Valid identification",name:"Synthetic ID.pdf"}]};
 }
 if(operation==="file"){
  if(state.committeeFileDenied)throw new Error("This file version is not part of your assigned packet.");
  return {url:"#synthetic",contentType:"application/octet-stream",name:"Synthetic ID.pdf",expiresAt:new Date(Date.now()+300000).toISOString()};
 }
 const assignments=Array.from({length:12},(_,i)=>({...assignment,stage:state.committeeRole==="bod_member"?"BOD":"CRECOM",crecomConfirmations:state.committeeRole==="bod_member"?crecomConfirmations:undefined,myDecision:i===1?"approve":i===2?"reject":null,state:i===1||i===2?"decision_recorded":"assigned",approvalProgress:{approved:state.committeeRole==="bod_member"?(i===1?1:0):2,rejected:i===2?1:0,total:state.committeeRole==="bod_member"?1:3,reviewers:[]},id:"assignment-"+i,applicationId:"APP-OWN-"+(i+1),assignedAt:new Date(Date.parse(assignment.assignedAt)-i*86400000).toISOString()}));
 return {assignments,history:[{id:"decision-own",assignmentId:"assignment-own",applicationId:"APP-HISTORY",cycle:1,packetVersion:1,decision:"approve",reason:"Synthetic reason",createdAt:"2026-11-10T00:00:00Z"}],counts:{assigned:12,pending:12,waiting:0,clarification:0,completed:1}};
}
