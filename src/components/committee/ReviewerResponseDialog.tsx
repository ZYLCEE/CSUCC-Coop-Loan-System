"use client";
import PasswordInput from "@/components/ui/PasswordInput";
import {useRef,useState} from "react";
import {useCommitteeAuth} from "./CommitteeAuthProvider";
import type {ReviewerPacket} from "@/lib/committeeReview";
import {signatoryPositionLabel} from "@/lib/committee";
import {useCommitteeServices} from "./CommitteeServices";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {Textarea} from "@/components/ui/Fields";
import {Button} from "@/components/ui/Button";
import {CommitteeField} from "./CommitteeFields";
export type ReviewerAction="approve"|"reject"|"clarify"|"recuse";
export default function ReviewerResponseDialog({packet,operation,onClose,onSaved}:{packet:ReviewerPacket;operation:ReviewerAction;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {reviewRequest}=useCommitteeServices(),{access}=useCommitteeAuth(),[reason,setReason]=useState(""),[password,setPassword]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const pending=useRef(false),request=useRef<{key:string;id:string}|null>(null);
 const decision=operation==="approve"||operation==="reject";
 const title={approve:"Confirm my approval",reject:"Confirm my rejection",clarify:"Request clarification",recuse:"Unable to Review"}[operation];
 const submit=async()=>{
  if(pending.current)return;setError("");
  if(operation!=="approve"&&!reason.trim()){setError("Enter a specific reason or clarification.");return;}
  if(decision&&!confirmed){setError("Confirm your decision for this application.");return;}
  if(!password){setError("Enter your account password.");return;}
  const input={operation,applicationId:packet.assignment.applicationId,revision:packet.appRevision,stateHash:packet.stateHash,payload:{assignmentId:packet.assignment.id,reason:reason.trim(),...(decision?{confirmed:true}:{})}};
  const key=JSON.stringify(input);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
  pending.current=true;setBusy(true);
  try{await reviewRequest("",{method:"POST",body:JSON.stringify({...input,requestId:request.current.id,password})});await onSaved();}
  catch(error){setError(error instanceof Error?error.message:"Your review confirmation could not be recorded.");}
  finally{pending.current=false;setBusy(false);setPassword("");}
 };
 return <ActionDialog title={title} subtitle={packet.assignment.applicant+" \u00b7 "+packet.assignment.applicationId} onClose={onClose} busy={busy} className="max-w-xl" overlayClassName="z-[180]"
  footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant={operation==="reject"?"destructive":"primary"} loading={busy} onClick={()=>void submit()}>{decision?"Record my decision":"Confirm request"}</Button></>}>
  <div className="space-y-4 text-support">
   <p className="font-semibold">{packet.assignment.signatoryRole?signatoryPositionLabel(packet.assignment.signatoryRole,packet.assignment.committeeMemberNumber):"Position not recorded"}</p>
   <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-caption text-portal-secondary">Confirmed reviewer</dt><dd className="font-semibold">{access.name}</dd></div><div><dt className="text-caption text-portal-secondary">Application</dt><dd>{packet.assignment.applicationId}</dd></div><div><dt className="text-caption text-portal-secondary">Member</dt><dd>{packet.assignment.applicant}</dd></div><div><dt className="text-caption text-portal-secondary">Review stage</dt><dd>{packet.assignment.stage}</dd></div></dl>
   <CommitteeField label={operation==="approve"?"Review notes (optional)":operation==="clarify"?"Clarification needed":operation==="reject"?"Reason shown to the member":"Reason"}><Textarea value={reason} maxLength={2000} rows={3} disabled={busy} onChange={event=>setReason(event.target.value)} /></CommitteeField>
   {decision?<><p className="text-caption text-portal-secondary">Your decision will be recorded with your reviewer account, approval position, application version and timestamp. It cannot be edited after confirmation.</p><label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)} /><span>I reviewed this application and its requirements and confirm my {operation==="approve"?"approval":"rejection"} for this application.</span></label></>:<p className="text-caption text-portal-secondary">{operation==="clarify"?"Your review pauses until staff answer. Changes to documents or terms require staff to verify the application again.":"Your reason stays in history. Staff must assign an eligible replacement holding the same position before the panel can finish."}</p>}
   <CommitteeField label="Your account password"><PasswordInput label="Your account password"  autoComplete="current-password" value={password} disabled={busy} onChange={event=>setPassword(event.target.value)} /></CommitteeField>
   {error&&<p role="alert" className="text-status-danger">{error}</p>}
  </div>
 </ActionDialog>;
}
