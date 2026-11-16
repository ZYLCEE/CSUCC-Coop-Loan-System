"use client";
import {useRef,useState} from "react";
import type {ApplicationVerification} from "@/lib/applicationWorkflow";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {ActionResultDialog} from "@/components/ui/ActionResultDialog";
import {Button} from "@/components/ui/Button";
import {Textarea} from "@/components/ui/Fields";
import PasswordInput from "@/components/ui/PasswordInput";
export default function RejectionResolutionDialog({data,recommendation,onClose,onSaved}:{data:ApplicationVerification;recommendation:boolean;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [reason,setReason]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState("");
 const pending=useRef(false),request=useRef<{key:string;id:string}|null>(null);
 const title=recommendation?"Recommend Rejection":"Reject Application";
 const submit=async()=>{if(pending.current||!password)return;const body={operation:recommendation?"recommend_rejection":"reject_application",applicationId:data.applicationId,revision:data.revision,stateHash:data.stateHash,payload:{reason:reason.trim()}};const key=JSON.stringify(body);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};pending.current=true;setBusy(true);setError("");try{await workflowRequest("",{method:"POST",body:JSON.stringify({...body,password,requestId:request.current.id})});setSaved(true);}catch(error){setError(error instanceof Error?error.message:"The decision could not be recorded.");}finally{pending.current=false;setBusy(false);setPassword("");}};
 if(saved)return <ActionResultDialog success title={recommendation?"Recommendation recorded":"Application rejected"} message={recommendation?"Super Admin has been notified to review your recommendation. This is not a final rejection.":`Application ${data.applicationId} was rejected. The recorded decision and member-facing reason are preserved.`} overlayClassName="z-[160]" onClose={()=>{void onSaved().finally(onClose);}}/>;
 return <ActionDialog title={title} subtitle={`${data.memberName} · ${data.applicationId}`} overlayClassName="z-[160]" onClose={onClose} busy={busy} footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant={recommendation?"primary":"destructive"} disabled={!reason.trim()||!password} loading={busy} onClick={()=>void submit()}>{recommendation?"Confirm Recommendation":"Confirm Rejection"}</Button></>}>
  <div className="space-y-4 text-support">
   <p>{recommendation?"Explain why this application should not proceed. Super Admin must review and record the final decision.":"Are you sure you want to reject this application? This records a final decision. It will not proceed to approval or release."}</p>
   <label className="grid gap-2">{recommendation?"Rejection recommendation":"Reason shown to the member"}<Textarea className="w-full resize-y" rows={4} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)} disabled={busy}/></label>
   <label className="grid gap-2">Confirm with your account password<PasswordInput label="Confirm with your account password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" disabled={busy}/></label>
   {error&&<p role="alert" className="text-status-danger">{error}</p>}
  </div>
 </ActionDialog>;
}
