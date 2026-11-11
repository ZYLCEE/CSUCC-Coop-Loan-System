import type {CommitteeAssignment,CommitteeDecision,CommitteeNotification,CommitteeRole,CommitteeSeat,CommitteeWorkspace,SignatoryRole} from "./committee";
import type {ReviewerPacket} from "./committeeReview";
import {validateReviewMutation} from "./committeeReview";

// Public sample credentials for an isolated browser prototype. These are not Auth users.
export type PrototypeAccount={id:string;name:string;email:string;password:string;role:CommitteeRole;seat:CommitteeSeat;signatoryRole:SignatoryRole};
export const prototypeAccounts:readonly PrototypeAccount[]=[
 {id:"crecom-1",name:"Prototype CRECOM Member 1",email:"crecom1@prototype.example.invalid",password:"Crecom1!Demo2026",role:"crecom_member",seat:"member",signatoryRole:"crecom_member"},
 {id:"crecom-2",name:"Prototype CRECOM Member 2",email:"crecom2@prototype.example.invalid",password:"Crecom2!Demo2026",role:"crecom_member",seat:"member",signatoryRole:"crecom_member"},
 {id:"crecom-chair",name:"Prototype CRECOM Chairperson",email:"crecom.chair@prototype.example.invalid",password:"CrecomChair!Demo2026",role:"crecom_member",seat:"chairperson",signatoryRole:"crecom_chairperson"},
 {id:"bod-chair",name:"Prototype BOD Chairperson",email:"bod.chair@prototype.example.invalid",password:"BodChair!Demo2026",role:"bod_member",seat:"chairperson",signatoryRole:"bod_chairperson"},
];
export const prototypeBase="/prototype/committee";
export const prototypeStoreKey="csucc.committee-prototype.v1";
export const prototypeSessionKey="csucc.committee-prototype.session.v1";
export const prototypePrefix=(id:string)=>prototypeBase+"/"+id;
export const prototypeAccount=(id:string)=>prototypeAccounts.find(account=>account.id===id);
export const prototypeUserId=(account:PrototypeAccount)=>uuid(100+prototypeAccounts.indexOf(account));
export function prototypeSignIn(email:string,password:string){
 const account=prototypeAccounts.find(item=>item.email===email.trim().toLowerCase()&&item.password===password);
 if(!account)throw new Error("Use one of the displayed prototype email addresses and its sample password.");
 return account;
}
const uuid=(n:number)=>"e0000000-0000-4000-8000-"+String(n).padStart(12,"0");
const sampleDate="2026-11-11T01:00:00.000Z";
export const prototypeCases=[
 {id:uuid(1),applicationId:"PROTO-2026-0001",applicant:"Sample Member Alba",memberNumber:"SAMPLE-0001",loanType:"Regular",amount:25000,months:12,monthly:2583.33,purpose:"Fictional household expenses for portal demonstration."},
 {id:uuid(2),applicationId:"PROTO-2026-0002",applicant:"Sample Member Bruno",memberNumber:"SAMPLE-0002",loanType:"Emergency",amount:10000,months:6,monthly:1866.67,purpose:"Fictional emergency expenses. CRECOM responses are prefilled for the BOD preview."},
 {id:uuid(3),applicationId:"PROTO-2026-0003",applicant:"Sample Member Cora",memberNumber:"SAMPLE-0003",loanType:"Business",amount:40000,months:12,monthly:4133.33,purpose:"Fictional business expenses. Sample confirmation history is already available."},
] as const;
type SampleCase=typeof prototypeCases[number];
type ResponseAction="approve"|"reject"|"clarify"|"recuse";
type SampleResponse={id:string;action:ResponseAction;reason:string;createdAt:string;reviewer:string};
export type PrototypeStore={version:1;revision:number;responses:Record<string,Record<string,SampleResponse>>;profiles:Record<string,{name:string;phone:string}>;readNotifications:string[];requests:Record<string,{fingerprint:string;result:{success:true}} >};
export function createPrototypeStore():PrototypeStore{
 const responses:PrototypeStore["responses"]={};
 for(const [index,loan]of prototypeCases.entries()){
  responses[loan.id]={};
  for(const [personIndex,account]of prototypeAccounts.entries())if(index===2||index===1&&personIndex<3){
   responses[loan.id][account.id]={id:uuid(1000+index*10+personIndex),action:"approve",reason:"Sample review complete. Fictional confirmation only.",createdAt:sampleDate,reviewer:account.name};
  }
 }
 return {version:1,revision:1,responses,profiles:{},readNotifications:[],requests:{}};
}
export function parsePrototypeStore(value:string|null):PrototypeStore{
 try{
  const item=JSON.parse(value??"null") as PrototypeStore|null;
  if(!item||item.version!==1||!Number.isSafeInteger(item.revision)||item.revision<1||!item.responses||!item.profiles||!Array.isArray(item.readNotifications)||!item.requests)return createPrototypeStore();
  for(const loan of prototypeCases){
   if(!item.responses[loan.id])return createPrototypeStore();
   for(const response of Object.values(item.responses[loan.id]))if(!response||!["approve","reject","clarify","recuse"].includes(response.action)||typeof response.reason!=="string"||typeof response.reviewer!=="string"||!Number.isFinite(Date.parse(response.createdAt)))return createPrototypeStore();
  }
  return item;
 }catch{return createPrototypeStore();}
}
export function samplePanelComplete(store:PrototypeStore,loanId:string){return prototypeAccounts.slice(0,3).every(account=>["approve","reject"].includes(store.responses[loanId]?.[account.id]?.action));}
export function samplePanelApproved(store:PrototypeStore,loanId:string){return prototypeAccounts.slice(0,3).every(account=>store.responses[loanId]?.[account.id]?.action==="approve");}
export function sampleFlow(store:PrototypeStore,loanId:string){
 if(Object.values(store.responses[loanId]??{}).some(item=>item.action==="reject"))return "Committee rejection recorded — staff correction action needed";
 if(!samplePanelComplete(store,loanId))return "Awaiting CRECOM confirmations";
 const bod=store.responses[loanId]?.["bod-chair"];
 if(!bod||!["approve","reject"].includes(bod.action))return "Ready for BOD review";
 return prototypeAccounts.every(account=>store.responses[loanId]?.[account.id]?.action==="approve")?"Ready for staff final decision":"Required rejection recorded — final approval blocked";
}
function visible(store:PrototypeStore,account:PrototypeAccount,loan:SampleCase){return account.role==="crecom_member"||samplePanelApproved(store,loan.id);}
const state=(response?:SampleResponse)=>!response?"assigned":["approve","reject"].includes(response.action)?"decision_recorded":response.action==="clarify"?"awaiting_clarification":"recused";
const assignmentId=(loan:SampleCase,account:PrototypeAccount)=>uuid(2000+prototypeCases.indexOf(loan)*10+prototypeAccounts.indexOf(account));
const profileName=(store:PrototypeStore,account:PrototypeAccount)=>store.profiles[account.id]?.name??account.name;
function assignment(store:PrototypeStore,account:PrototypeAccount,loan:SampleCase):CommitteeAssignment{
 const group=account.role==="crecom_member"?prototypeAccounts.slice(0,3):[account];
 return {id:assignmentId(loan,account),applicationId:loan.applicationId,applicant:loan.applicant,memberNumber:loan.memberNumber,loanType:loan.loanType,amount:loan.amount,stage:account.role==="crecom_member"?"CRECOM":"BOD",signatoryRole:account.signatoryRole,cycle:1,packetVersion:1,assignedAt:sampleDate,dueAt:null,state:state(store.responses[loan.id]?.[account.id]),responded:group.filter(item=>["approve","reject"].includes(store.responses[loan.id]?.[item.id]?.action)).length,assigned:group.length};
}
export function prototypeWorkspace(store:PrototypeStore,account:PrototypeAccount):CommitteeWorkspace{
 const loans=prototypeCases.filter(loan=>visible(store,account,loan));
 const assignments=loans.map(loan=>assignment(store,account,loan));
 const history:CommitteeDecision[]=loans.flatMap(loan=>{
  const response=store.responses[loan.id]?.[account.id];
  return response&&["approve","reject"].includes(response.action)?[{id:response.id,assignmentId:assignmentId(loan,account),applicationId:loan.applicationId,cycle:1,packetVersion:1,decision:response.action,signatoryRole:account.signatoryRole,reason:response.reason,createdAt:response.createdAt,accessAvailable:true}]:[];
 });
 return {assignments,history,counts:{assigned:assignments.length,pending:assignments.filter(row=>row.state==="assigned").length,waiting:loans.filter(loan=>["approve","reject"].includes(store.responses[loan.id]?.[account.id]?.action)&&!samplePanelComplete(store,loan.id)).length,clarification:assignments.filter(row=>row.state==="awaiting_clarification").length,completed:history.length}};
}
function assignedLoan(store:PrototypeStore,account:PrototypeAccount,id:string){
 const loan=prototypeCases.find(item=>assignmentId(item,account)===id);
 if(!loan||!visible(store,account,loan))throw new Error("This sample packet is not assigned to the selected prototype account.");
 return loan;
}
const confirmation=(loan:SampleCase,account:PrototypeAccount,response:SampleResponse)=>"I record "+response.action+" as "+account.signatoryRole.replaceAll("_"," ")+" for "+loan.applicationId+", packet version 1. Prototype confirmation only.";
export function prototypePacket(store:PrototypeStore,account:PrototypeAccount,id:string):ReviewerPacket{
 const loan=assignedLoan(store,account,id),response=store.responses[loan.id]?.[account.id],decided=response&&["approve","reject"].includes(response.action);
 return {assignment:assignment(store,account,loan),summary:{purpose:loan.purpose,tenureMonths:loan.months,monthlyPayment:loan.monthly},findings:"SAMPLE ONLY: fictional identity, eligibility and loan terms checked for this prototype.",consentSummary:"SAMPLE ONLY: consent and witness evidence are simulated; no real person has provided consent.",documents:[{documentId:uuid(3000+prototypeCases.indexOf(loan)),versionId:uuid(4000+prototypeCases.indexOf(loan)),kind:"Sample supporting document",name:"Prototype supporting document.svg"}],appRevision:store.revision,stateHash:String(store.revision).padStart(64,"0"),stale:false,canRespond:!response&&!Object.values(store.responses[loan.id]??{}).some(item=>item.action==="reject"),requiredApprovals:account.role==="crecom_member"?3:1,reviewerTarget:account.role==="crecom_member"?3:1,
  myDecision:decided?{id:response.id,decision:response.action,reason:response.reason,createdAt:response.createdAt,reviewer:response.reviewer,confirmation:confirmation(loan,account,response),method:"account_password",signatoryRole:account.signatoryRole}:null,
  thread:response&&!decided?[{id:response.id,action:response.action,actor:response.reviewer,reason:response.reason,createdAt:response.createdAt,assignmentId:id}]:[],cycleStatus:"open",outcome:null,
  crecomConfirmations:account.role==="bod_member"?prototypeAccounts.slice(0,3).map(person=>{const decision=store.responses[loan.id][person.id];return {reviewer:decision.reviewer,signatoryRole:person.signatoryRole,decision:decision.action,createdAt:decision.createdAt};}):undefined};
}
export function prototypeInbox(store:PrototypeStore,account:PrototypeAccount):CommitteeNotification[]{
 return prototypeCases.filter(loan=>visible(store,account,loan)).flatMap(loan=>{
  const assignedId=uuid(5000+prototypeCases.indexOf(loan)*10+prototypeAccounts.indexOf(account));
  const assigned:CommitteeNotification={id:assignedId,title:"Sample application assigned",message:loan.applicationId+": "+sampleFlow(store,loan.id)+". Fictional demonstration only.",read:store.readNotifications.includes(account.id+":"+assignedId),createdAt:sampleDate,assignmentId:assignmentId(loan,account),accessAvailable:true};
  const updates=prototypeAccounts.flatMap(person=>{const response=store.responses[loan.id]?.[person.id];return response?[{id:response.id,title:"Sample committee action recorded",message:loan.applicationId+" · "+response.reviewer+" · "+response.action+". Demonstration only.",read:store.readNotifications.includes(account.id+":"+response.id),createdAt:response.createdAt,assignmentId:assignmentId(loan,account),accessAvailable:true}]:[];});
  return [assigned,...updates];
 });
}
export function recordPrototypeReview(store:PrototypeStore,account:PrototypeAccount,body:unknown){
 const raw=body as Record<string,unknown>;
 if(!raw||!["approve","reject","clarify","recuse"].includes(String(raw.operation)))throw new Error("Only individual sample review actions are available in this prototype.");
 if(raw.password!==account.password)throw new Error("Enter this account's displayed prototype password to confirm the sample decision.");
 const action=validateReviewMutation(raw),payload=action.payload;
 const loan=assignedLoan(store,account,String(payload.assignmentId));
 if(loan.applicationId!==action.applicationId)throw new Error("Choose the assigned sample application.");
 const fingerprint=JSON.stringify({account:account.id,...action}),prior=store.requests[action.requestId];
 if(prior){if(prior.fingerprint!==fingerprint)throw new Error("This sample request was already used.");return prior.result;}
 if(action.revision!==store.revision||action.stateHash!==String(store.revision).padStart(64,"0"))throw new Error("Sample progress changed. Refresh the packet before continuing.");
 if(Object.values(store.responses[loan.id]??{}).some(item=>item.action==="reject"))throw new Error("A committee rejection stopped this application. Staff must return it for correction.");
 if(store.responses[loan.id][account.id])throw new Error("This sample response is already recorded. Reset the prototype to start again.");
 store.responses[loan.id][account.id]={id:action.requestId,action:action.operation as ResponseAction,reason:String(payload.reason??""),reviewer:profileName(store,account),createdAt:new Date().toISOString()};
 store.revision++;const result={success:true} as const;store.requests[action.requestId]={fingerprint,result};return result;
}
export function createPrototypeServices(account:PrototypeAccount,storage:Pick<Storage,"getItem"|"setItem">,activeAccount:()=>string|null){
 const read=()=>{if(activeAccount()!==account.id)throw new Error("Open the prototype sign-in and choose this sample account first.");return parsePrototypeStore(storage.getItem(prototypeStoreKey));};
 const save=(store:PrototypeStore)=>storage.setItem(prototypeStoreKey,JSON.stringify(store));
 return {
  async committeeRequest<T>(query="",init:RequestInit={},management=false):Promise<T>{
   if(management)throw new Error("Prototype reviewers cannot manage real accounts.");
   const store=read(),params=new URLSearchParams(query);let result:unknown;
   if(init.method==="POST"){
    const body=JSON.parse(String(init.body)) as Record<string,unknown>;
    if(body.operation==="read"){
     const notes=prototypeInbox(store,account);
     for(const note of notes)if(body.all||note.id===body.id)store.readNotifications.push(account.id+":"+note.id);
     result=prototypeInbox(store,account);
    }else if(body.operation==="profile"){
     const name=String(body.name??"").trim(),phone=String(body.phone??"").trim();
     if(!name||name.length>160||phone.length>30)throw new Error("Enter valid sample profile details.");
     store.profiles[account.id]={name,phone};result={success:true,warning:null};
    }else throw new Error("This operation is unavailable for prototype accounts.");
    save(store);
   }else if(params.get("operation")==="packet")result=prototypePacket(store,account,params.get("assignmentId")??"");
   else if(params.get("operation")==="file"){
    const packet=prototypePacket(store,account,params.get("assignmentId")??"");
    if(!packet.documents.some(doc=>doc.documentId===params.get("documentId")&&doc.versionId===params.get("versionId")))throw new Error("This is not a document in the assigned sample packet.");
    result={url:"/prototype/sample-document.svg",name:"Prototype supporting document.svg",contentType:"application/octet-stream",expiresAt:new Date(Date.now()+300000).toISOString()};
   }else if(params.get("operation")==="inbox")result=prototypeInbox(store,account);
   else if(!params.get("operation"))result=prototypeWorkspace(store,account);
   else throw new Error("Unknown prototype request.");
   return result as T;
  },
  async reviewRequest<T>(_query="",init:RequestInit={}):Promise<T>{
   void _query;
   if(init.method!=="POST")throw new Error("Only sample committee confirmations are available here.");
   const store=read(),result=recordPrototypeReview(store,account,JSON.parse(String(init.body)));save(store);return result as T;
  },
 };
}
