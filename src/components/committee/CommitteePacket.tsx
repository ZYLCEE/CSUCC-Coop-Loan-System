"use client";
import {useRouter} from "next/navigation";
import {useCallback,useEffect,useId,useRef,useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {useCommitteeServices} from "./CommitteeServices";
import {getPortalPrefix,signatoryPositionLabel} from "@/lib/committee";
import type {ReviewerPacket as Packet} from "@/lib/committeeReview";
import {getLoanTypeLabel} from "@/lib/loanTypeLabel";
import {committeeMoney,committeeDate} from "@/lib/committeePresentation";
import {committeeDecisionLabel,committeeApprovalLabel,crecomConfirmationProgress} from "@/lib/committeeReviewPresentation";
import {watchAdminNotifications} from "@/lib/adminNotifications";
import {Button} from "@/components/ui/Button";
import {Card} from "@/components/ui/Card";
import {DataTable} from "@/components/ui/DataTable";
import {EmptyState,LoadingState} from "@/components/ui/Feedback";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {actionButtonStyles} from "@/components/shared/actionButtonStyles";
import ReviewerResponseDialog,{type ReviewerAction} from "./ReviewerResponseDialog";

const tabs=[{id:"details",label:"Loan Details"},{id:"requirements",label:"Requirements"},{id:"approvals",label:"Committee Approvals"},{id:"decision",label:"My Decision"}] as const;
export type ReviewTab=typeof tabs[number]["id"];
const documentLabels:Record<string,string>={validId:"Valid ID",valid_id:"Valid ID",payslip:"Pay Slip",paySlip:"Pay Slip",collateral:"Collateral Document",collateralDocument:"Collateral Document",employerCertification:"Employer Certification"};
export default function CommitteePacket({assignmentId,onClose,initialTab="details",onUpdated}:{assignmentId:string;onClose?:()=>void;initialTab?:ReviewTab;onUpdated?:()=>Promise<void>}){
 const {committeeRequest}=useCommitteeServices(),{role,portalPrefix,user,prototype}=useCommitteeAuth(),router=useRouter(),id=useId();
 const [packet,setPacket]=useState<Packet|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[file,setFile]=useState<Packet["documents"][number]|null>(null);
 const [action,setAction]=useState<ReviewerAction|null>(null),[notice,setNotice]=useState(""),[tab,setTab]=useState<ReviewTab>(initialTab),[more,setMore]=useState(false);
 const mounted=useRef(false),sequence=useRef(0);
 const load=useCallback(async()=>{const current=++sequence.current;try{const value=await committeeRequest<Packet>(new URLSearchParams({operation:"packet",assignmentId}).toString());if(mounted.current&&current===sequence.current){setPacket(value);setError("");}}catch(error){if(mounted.current&&current===sequence.current){setPacket(null);setError(error instanceof Error?error.message:"The assigned application could not be opened.");}}finally{if(mounted.current&&current===sequence.current)setLoading(false);}},[assignmentId,committeeRequest]);
 useEffect(()=>{mounted.current=true;const initial=window.setTimeout(()=>void load(),0);return()=>{mounted.current=false;window.clearTimeout(initial);};},[load]);
 useEffect(()=>{
  // Keep the review current without replacing the version being confirmed in a child dialog.
  if(file||action)return;
  const refresh=()=>{if(document.visibilityState!=="hidden")void load();};
  const unwatch=prototype?()=>{}:watchAdminNotifications(user.id,refresh),timer=window.setInterval(refresh,30000);
  window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
  return()=>{unwatch();window.clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh);};
 },[file,action,load,prototype,user.id]);
 const close=()=>onClose?onClose():router.replace((portalPrefix??getPortalPrefix(role))+"/assignments");
 const ownDecision=packet?.myDecision;
 const crecomConfirmations=packet?.assignment.crecomConfirmations??packet?.crecomConfirmations;
 const crecom=crecomConfirmationProgress(crecomConfirmations),prerequisitesReady=packet?.assignment.stage!=="BOD"||crecom.complete;
 const reviewOpen=packet?.cycleStatus==="open"&&["assigned","awaiting_clarification"].includes(packet.assignment.state)&&!ownDecision;
 return <>
 <ActionDialog title="Review Loan Application" subtitle={packet?packet.assignment.applicant+" · "+packet.assignment.applicationId:undefined} onClose={close} busy={!!file||!!action} className="max-w-6xl" overlayClassName="z-[120]" footer={<><Button disabled={!!file||!!action} onClick={close}>Close</Button><Button disabled={loading||!!file||!!action} onClick={()=>{setLoading(true);void load();}}>Refresh</Button>{packet&&tab!=="decision"&&<Button variant="primary" disabled={loading} onClick={()=>setTab("decision")}>{ownDecision?"View My Decision":"Make a Decision"}</Button>}</>}>
  {error?<div className="space-y-3"><p role="alert" className="text-support text-status-danger">{error}</p><Button onClick={()=>{setLoading(true);void load();}}>Retry</Button></div>:loading?<LoadingState label="Loading assigned application…"/>:packet&&<div className="space-y-4">
   <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted p-3 text-support"><span className="font-semibold">{packet.assignment.stage} Review · {committeeDecisionLabel({...packet.assignment,myDecision:ownDecision?.decision==="approve"||ownDecision?.decision==="reject"?ownDecision.decision:packet.assignment.myDecision})}</span><span>{committeeApprovalLabel(packet.assignment)}</span></div>
   {packet.stale&&<p role="alert" className="rounded-lg bg-status-warning-surface p-3 text-support text-status-warning">The application or requirements changed. Decisions are paused until staff verify the updated application and assign it for review.</p>}
   {notice&&<p role="status" className="text-support text-status-success">{notice}</p>}
   <div role="tablist" aria-label="Application review sections" className="flex gap-1 overflow-x-auto border-b border-portal-border" onKeyDown={event=>{const index=tabs.findIndex(item=>item.id===tab);let next=index;if(event.key==="ArrowRight")next=(index+1)%tabs.length;else if(event.key==="ArrowLeft")next=(index+tabs.length-1)%tabs.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=tabs.length-1;else return;event.preventDefault();setTab(tabs[next].id);document.getElementById(id+"-tab-"+tabs[next].id)?.focus();}}>{tabs.map(item=><button key={item.id} type="button" role="tab" id={id+"-tab-"+item.id} aria-selected={tab===item.id} aria-controls={id+"-panel-"+item.id} tabIndex={tab===item.id?0:-1} className={"shrink-0 border-b-2 px-4 py-3 text-support font-semibold "+(tab===item.id?"border-coop-dashboard-green text-coop-dashboard-green":"border-transparent text-portal-secondary")} onClick={()=>setTab(item.id)}>{item.label}</button>)}</div>
   <section role="tabpanel" id={id+"-panel-"+tab} aria-labelledby={id+"-tab-"+tab} tabIndex={0} className="min-h-52 space-y-4 outline-none">
    {tab==="details"&&<>
     {packet.assignment.stage==="BOD"&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted p-3 text-support"><span>{crecom.complete?"CRECOM approved: 3 of 3":"CRECOM approvals must be confirmed before a BOD decision."}</span><Button size="compact" onClick={()=>setTab("approvals")}>View CRECOM Approvals</Button></div>}
     <dl className="grid gap-x-6 gap-y-4 text-support sm:grid-cols-2 lg:grid-cols-3">{[
      ["Borrower",packet.assignment.applicant],["Member ID",packet.assignment.memberNumber],["Loan Type",getLoanTypeLabel(packet.assignment.loanType)],["Loan Amount",committeeMoney(packet.assignment.amount)],["Loan Term",packet.summary.tenureMonths?String(packet.summary.tenureMonths)+" months":"Not recorded"],["My Approval Position",signatoryPositionLabel(packet.assignment.signatoryRole,packet.assignment.committeeMemberNumber)],["Assigned On",committeeDate(packet.assignment.assignedAt)],...(packet.assignment.dueAt?[["Review Due",committeeDate(packet.assignment.dueAt)]]:[])
     ].map(([label,value])=><div key={label}><dt className="text-caption text-portal-secondary">{label}</dt><dd className="mt-1 break-words font-medium">{value||"Not recorded"}</dd></div>)}</dl>
     {typeof packet.summary.purpose==="string"&&<div className="border-t border-portal-border pt-3"><h3 className="text-support font-semibold">Loan Purpose</h3><p className="mt-1 whitespace-pre-wrap break-words text-support">{packet.summary.purpose}</p></div>}
    </>}
    {tab==="requirements"&&<>
     <Card padded={false}><h3 className="border-b border-portal-border px-4 py-3 text-support font-semibold">Required Documents</h3>{packet.documents.length?<ul className="divide-y divide-portal-border">{packet.documents.map(document=><li key={document.documentId+":"+document.versionId} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="break-words text-support font-medium">{documentLabels[document.kind]??document.kind.replaceAll("_"," ")}</p><p className="mt-1 break-all text-caption text-portal-secondary">{document.name}</p></div><Button size="compact" onClick={()=>setFile(document)}>View document</Button></li>)}</ul>:<EmptyState title="No assigned documents." description="Only documents assigned to your review can be opened."/>}</Card>
     <Card><h3 className="mb-2 text-support font-semibold">Consent & Witness Evidence</h3><p className="whitespace-pre-wrap break-words text-support text-portal-secondary">{packet.consentSummary||"No evidence summary recorded."}</p></Card>
     {packet.findings&&<Card><h3 className="mb-2 text-support font-semibold">Staff Verification</h3><p className="whitespace-pre-wrap break-words text-support text-portal-secondary">{packet.findings}</p></Card>}
    </>}
    {tab==="approvals"&&<>
     {role==="bod_member"&&crecomConfirmations?.length?<Card padded={false}><h3 className="border-b border-portal-border px-4 py-3 text-support font-semibold">CRECOM Approvals - {crecom.approved} of 3 approved</h3><DataTable density="compact" label="CRECOM approvals" className="min-w-[620px]"><thead><tr><th className="text-left">Reviewer / Position</th><th className="text-left">Decision</th><th className="text-left">Decision Date · Philippine Time</th></tr></thead><tbody>{crecomConfirmations.map((item,index)=><tr key={index}><td>{item.reviewer}<p className="mt-1 text-caption text-portal-secondary">{signatoryPositionLabel(item.signatoryRole,item.committeeMemberNumber)}</p></td><td>{item.decision==="approve"?"Approved":"Rejected"}</td><td>{committeeDate(item.createdAt)}</td></tr>)}</tbody></DataTable></Card>:null}
     <Card padded={false}><h3 className="border-b border-portal-border px-4 py-3 text-support font-semibold">{packet.assignment.stage} Approval Progress</h3>{packet.assignment.approvalProgress?<DataTable density="compact" label="Committee approval progress" className="min-w-[620px]"><thead><tr><th className="text-left">Reviewer / Position</th><th className="text-left">Decision</th><th className="text-left">Decision Date · Philippine Time</th></tr></thead><tbody>{packet.assignment.approvalProgress.reviewers.map(item=><tr key={item.id}><td>{item.reviewer||"Awaiting reviewer decision"}<p className="mt-1 text-caption text-portal-secondary">{signatoryPositionLabel(item.position,item.memberNumber)}</p></td><td>{committeeDecisionLabel({state:item.state,myDecision:item.decision})}</td><td>{item.decidedAt?committeeDate(item.decidedAt):"—"}</td></tr>)}</tbody></DataTable>:<p className="p-4 text-support text-portal-secondary">Approval progress is unavailable. Refresh to retry.</p>}</Card>
     <p className="text-caption text-portal-secondary">{packet.assignment.stage==="CRECOM"?"All three CRECOM reviewers must approve before BOD review.":"The BOD Chairperson must approve before the Super Admin makes the final decision."}</p>
    </>}
    {tab==="decision"&&<>
     {!prerequisitesReady&&!ownDecision&&<p role="alert" className="rounded-lg bg-status-warning-surface p-3 text-support text-status-warning">BOD approval is paused until all three CRECOM approvals for this application are available. Refresh the application or ask staff to check its BOD assignment.</p>}
     {ownDecision?<Card><h3 className="mb-2 text-support font-semibold">My Recorded Decision</h3><p className="text-support font-semibold">{ownDecision.decision==="approve"?"Approved":"Rejected"} · {ownDecision.reviewer}</p><p className="mt-1 text-support">{committeeDate(ownDecision.createdAt)}</p>{ownDecision.signatoryRole&&<p className="mt-1 text-caption text-portal-secondary">{signatoryPositionLabel(ownDecision.signatoryRole,ownDecision.committeeMemberNumber)}</p>}{ownDecision.reason&&<p className="mt-3 whitespace-pre-wrap break-words text-support">{ownDecision.reason}</p>}<p className="mt-3 break-all text-caption text-portal-secondary">Reference: {ownDecision.id}{ownDecision.method==="account_password"?" · Confirmed with account password":""}</p><p className="mt-2 text-caption text-portal-secondary">Your confirmed decision cannot be edited.</p></Card>:reviewOpen?<Card><h3 className="mb-2 text-support font-semibold">Submit My Decision</h3><p className="mb-4 text-support text-portal-secondary">Review the loan details and requirements before confirming your decision with your account password.</p><div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!packet.canRespond||!prerequisitesReady} onClick={()=>setAction("approve")}>Approve Application</Button><Button disabled={!packet.canRespond||!prerequisitesReady} onClick={()=>setAction("reject")}>Reject Application</Button><Button aria-expanded={more} onClick={()=>setMore(value=>!value)}>More options</Button></div>{more&&<div className="mt-3 flex flex-wrap gap-2 border-t border-portal-border pt-3"><Button disabled={!packet.canRespond||!prerequisitesReady} onClick={()=>setAction("clarify")}>Request Clarification</Button><Button onClick={()=>setAction("recuse")}>Unable to Review</Button></div>}</Card>:<p className="text-support text-portal-secondary">{committeeDecisionLabel(packet.assignment)}. No decision is available to submit.</p>}
     {packet.thread?.length>0&&<Card><h3 className="mb-3 text-support font-semibold">My Clarification History</h3><ol className="space-y-3">{packet.thread.map(item=><li key={item.id} className="text-support"><p className="font-medium">{item.action.replaceAll("_"," ")} · {item.actor} · {committeeDate(item.createdAt)}</p><p className="mt-1 whitespace-pre-wrap break-words text-portal-secondary">{item.reason}</p></li>)}</ol></Card>}
    </>}
   </section>
  </div>}
 </ActionDialog>
 {file&&<ActionDialog title="Assigned document" subtitle={file.name} onClose={()=>setFile(null)} overlayClassName="z-[160]" className="max-w-4xl" footer={<Button onClick={()=>setFile(null)}>Close document</Button>}><CommitteeFile assignmentId={assignmentId} document={file}/></ActionDialog>}
 {action&&packet&&<ReviewerResponseDialog key={action} packet={packet} operation={action} onClose={()=>setAction(null)} onSaved={async()=>{setAction(null);setMore(false);setNotice("Your response was recorded.");await load();await onUpdated?.();}}/>}
 </>;
}

type FileLink={url:string;name:string;contentType:string;expiresAt:string};
function CommitteeFile({assignmentId,document}:{assignmentId:string;document:Packet["documents"][number]}){
 const {committeeRequest}=useCommitteeServices();
 const [link,setLink]=useState<FileLink|null>(null),[error,setError]=useState(""),[expired,setExpired]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;
  const query=new URLSearchParams({operation:"file",assignmentId,documentId:document.documentId});if(document.versionId)query.set("versionId",document.versionId);
  void committeeRequest<FileLink>(query.toString()).then(value=>{if(active)setLink(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"The assigned file could not be opened.");});
  return()=>{active=false;};
 },[assignmentId,document.documentId,document.versionId,attempt,committeeRequest]);
 useEffect(()=>{if(!link)return;const timer=setTimeout(()=>setExpired(true),Math.max(0,Date.parse(link.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[link]);
 const refresh=()=>{setLink(null);setError("");setExpired(false);setAttempt(value=>value+1);};
 if(error||expired)return <div className="space-y-3 text-support"><p role="alert" className="text-status-danger">{error||"This file link expired. Refresh it to continue."}</p><Button onClick={refresh}>Refresh assigned file</Button></div>;
 if(!link)return <LoadingState label="Opening assigned file…" />;
 const image=["image/jpeg","image/png","image/webp"].includes(link.contentType);
 return <div className="space-y-3"><div className="flex flex-wrap justify-end gap-2"><Button size="compact" onClick={refresh}>Refresh link</Button><a className={actionButtonStyles()} href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open original</a></div>
  {/* Private, expiring URLs must not pass through the public image optimizer. */}
  {/* eslint-disable-next-line @next/next/no-img-element */}
  {image?<img src={link.url} alt={"Assigned document: "+link.name} referrerPolicy="no-referrer" className="mx-auto max-h-[55dvh] max-w-full object-contain" />:link.contentType==="application/pdf"?<iframe src={link.url} title={"Assigned document: "+link.name} referrerPolicy="no-referrer" className="h-[55dvh] w-full rounded-lg border border-portal-border" />:<p className="py-8 text-center text-support text-portal-secondary">Use Open original to view or download this file.</p>}
 </div>;
}
