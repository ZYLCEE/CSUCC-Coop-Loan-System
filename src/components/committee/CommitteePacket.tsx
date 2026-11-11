"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import {useCommitteeServices} from "./CommitteeServices";
import {getPortalPrefix,signatoryPositionLabel} from "@/lib/committee";
import type {ReviewerPacket as Packet} from "@/lib/committeeReview";
import {getLoanTypeLabel} from "@/lib/loanTypeLabel";
import {committeeMoney,committeeDate} from "@/lib/committeePresentation";
import {Button} from "@/components/ui/Button";
import {Card} from "@/components/ui/Card";
import {DataTable} from "@/components/ui/DataTable";
import {EmptyState,LoadingState} from "@/components/ui/Feedback";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {actionButtonStyles} from "@/components/shared/actionButtonStyles";
import ReviewerResponseDialog,{type ReviewerAction} from "./ReviewerResponseDialog";

export default function CommitteePacket({assignmentId}:{assignmentId:string}){
 const {committeeRequest}=useCommitteeServices(),{role,portalPrefix}=useCommitteeAuth(),[packet,setPacket]=useState<Packet|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[file,setFile]=useState<Packet["documents"][number]|null>(null);
 const [action,setAction]=useState<ReviewerAction|null>(null),[notice,setNotice]=useState("");
 const load=useCallback(async()=>{setLoading(true);setError("");setPacket(null);setFile(null);try{setPacket(await committeeRequest<Packet>(new URLSearchParams({operation:"packet",assignmentId}).toString()));}catch(error){setError(error instanceof Error?error.message:"The assigned case could not be opened.");}finally{setLoading(false);}},[assignmentId,committeeRequest]);
 useEffect(()=>{let active=true;void committeeRequest<Packet>(new URLSearchParams({operation:"packet",assignmentId}).toString()).then(value=>{if(active)setPacket(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"The assigned case could not be opened.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[assignmentId,committeeRequest]);
 return <div className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><Link className={actionButtonStyles()} href={(portalPrefix??getPortalPrefix(role))+"/assignments"}>Back to assignments</Link><Button onClick={()=>void load()} disabled={loading}>Refresh assigned packet</Button></div>
  {error?<Card><h2 className="mb-2 text-card-title font-semibold">Assigned case unavailable</h2><p role="alert" className="text-support text-status-danger">{error}</p></Card>:loading?<Card><LoadingState label="Loading assigned packet…" /></Card>:packet&&<>
   <Card><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-card-title font-semibold">{packet.assignment.applicationId}</h2><p className="mt-1 text-support text-portal-secondary">{packet.assignment.stage} · Cycle {packet.assignment.cycle} · Packet v{packet.assignment.packetVersion}</p></div><span className="text-support capitalize text-portal-secondary">{packet.assignment.state.replaceAll("_"," ")}</span></div>
    <dl className="grid gap-x-6 gap-y-4 text-support sm:grid-cols-2 xl:grid-cols-4">{[
     ["My approval position",packet.assignment.signatoryRole?signatoryPositionLabel(packet.assignment.signatoryRole,packet.assignment.committeeMemberNumber):"Position not recorded"],["Applicant",packet.assignment.applicant],["Member ID",packet.assignment.memberNumber],["Loan type",getLoanTypeLabel(packet.assignment.loanType)],["Loan amount",committeeMoney(packet.assignment.amount)],
     ["Term",packet.summary.tenureMonths?String(packet.summary.tenureMonths)+" months":"Not recorded"],["Assigned",committeeDate(packet.assignment.assignedAt)],["Due",committeeDate(packet.assignment.dueAt)],["Group responses",packet.assignment.responded+" of "+packet.assignment.assigned+" responded"],
    ].map(([label,value])=><div key={label}><dt className="text-caption text-portal-secondary">{label}</dt><dd className="mt-0.5 break-words font-medium">{value||"Not recorded"}</dd></div>)}</dl>
    {typeof packet.summary.purpose==="string"&&<div className="mt-4 border-t border-portal-border pt-3"><h3 className="text-caption text-portal-secondary">Loan purpose</h3><p className="mt-1 whitespace-pre-wrap break-words text-support">{packet.summary.purpose}</p></div>}
    <p className="mt-4 text-caption text-portal-secondary">This packet preserves the application and file versions assigned for this review cycle.</p>
   </Card>
   <div className="grid gap-4 lg:grid-cols-2"><Card><h3 className="mb-2 text-support font-semibold">Staff verification findings</h3><p className="whitespace-pre-wrap break-words text-support text-portal-secondary">{packet.findings||"No findings included in this packet."}</p></Card><Card><h3 className="mb-2 text-support font-semibold">Consent and evidence summary</h3><p className="whitespace-pre-wrap break-words text-support text-portal-secondary">{packet.consentSummary||"No consent summary included in this packet."}</p></Card></div>
   {role==="bod_member"&&packet.crecomConfirmations?.length? <Card padded={false}><h3 className="border-b border-portal-border px-4 py-4 text-card-title font-semibold sm:px-6">CRECOM confirmations</h3><DataTable density="compact" label="CRECOM confirmations" className="min-w-[620px]"><thead><tr><th className="text-left">Reviewer / position</th><th className="text-left">Decision</th><th className="text-left">Recorded · Philippine time</th></tr></thead><tbody>{packet.crecomConfirmations.map((item,index)=><tr key={index}><td>{item.reviewer}<p className="mt-0.5 text-caption text-portal-secondary">{signatoryPositionLabel(item.signatoryRole,item.committeeMemberNumber)}</p></td><td className="capitalize">{item.decision}</td><td>{committeeDate(item.createdAt)}</td></tr>)}</tbody></DataTable></Card>:null}
   <Card padded={false}><h3 className="border-b border-portal-border px-4 py-4 text-card-title font-semibold sm:px-6">Assigned documents</h3>{packet.documents.length?<ul className="divide-y divide-portal-border">{packet.documents.map(document=><li key={document.documentId+":"+document.versionId} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="min-w-0"><p className="break-words text-support font-medium">{document.kind.replaceAll("_"," ")}</p><p className="mt-0.5 break-all text-caption text-portal-secondary">{document.name}</p></div><Button size="compact" onClick={()=>setFile(document)}>View document</Button></li>)}</ul>:<EmptyState title="No documents in this packet." description="Only files included in your assigned review packet can be opened." />}</Card>
   {notice&&<p role="status" className="text-support text-status-success">{notice}</p>}
   {packet.stale&&<p role="alert" className="rounded-lg bg-status-warning-surface p-3 text-support text-status-warning">The application, file reviews or consent evidence changed. New decisions are blocked until staff verify and assign a current packet.</p>}
   {packet.myDecision?<Card><h3 className="mb-2 text-support font-semibold">My recorded confirmation</h3><p className="text-support capitalize">{packet.myDecision.decision} · {packet.myDecision.reviewer} · {committeeDate(packet.myDecision.createdAt)}</p><p className="mt-2 text-support text-portal-secondary">{packet.myDecision.confirmation}</p>{packet.myDecision.signatoryRole&&<p className="mt-1 text-caption text-portal-secondary">{signatoryPositionLabel(packet.myDecision.signatoryRole,packet.myDecision.committeeMemberNumber)}</p>}<p className="mt-2 break-all text-caption text-portal-secondary">Reference: {packet.myDecision.id}{packet.myDecision.method==="account_password"?" · Confirmed with account password":""}</p></Card>:
    packet.cycleStatus==="open"&&["assigned","awaiting_clarification"].includes(packet.assignment.state)&&<Card><h3 className="mb-2 text-support font-semibold">My review confirmation</h3><p className="mb-3 text-support text-portal-secondary">{packet.requiredApprovals} approvals required from {packet.reviewerTarget} reviewers. Every assigned reviewer must respond before the panel outcome is recorded.</p><div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!packet.canRespond} onClick={()=>setAction("approve")}>Approve this packet</Button><Button disabled={!packet.canRespond} onClick={()=>setAction("reject")}>Reject this packet</Button><Button disabled={!packet.canRespond} onClick={()=>setAction("clarify")}>Request clarification</Button><Button onClick={()=>setAction("recuse")}>Recuse</Button></div></Card>}
   {packet.thread?.length>0&&<Card><h3 className="mb-3 text-support font-semibold">My clarification history</h3><ol className="space-y-3">{packet.thread.map(item=><li key={item.id} className="text-support"><p className="font-medium capitalize">{item.action} · {item.actor} · {committeeDate(item.createdAt)}</p><p className="mt-1 whitespace-pre-wrap break-words text-portal-secondary">{item.reason}</p></li>)}</ol></Card>}
  </>}
  {file&&<ActionDialog title="Assigned document" subtitle={file.name} onClose={()=>setFile(null)} className="max-w-4xl" footer={<Button onClick={()=>setFile(null)}>Close</Button>}><CommitteeFile assignmentId={assignmentId} document={file} /></ActionDialog>}
  {action&&packet&&<ReviewerResponseDialog key={action} packet={packet} operation={action} onClose={()=>setAction(null)} onSaved={async()=>{setAction(null);setNotice("Your review confirmation was recorded.");await load();}} />}
 </div>;
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
