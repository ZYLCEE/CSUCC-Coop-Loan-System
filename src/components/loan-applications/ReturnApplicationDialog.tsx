"use client";
import {ActionResultDialog} from "@/components/ui/ActionResultDialog";
import PasswordInput from "@/components/ui/PasswordInput";
import {useEffect,useRef,useState} from "react";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import type {ApplicationVerification} from "@/lib/applicationWorkflow";
import {documentKindLabels,type DocumentKind} from "@/lib/documentWorkspace";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {Button} from "@/components/ui/Button";
import {Select,Textarea} from "@/components/ui/Fields";
import {LoadingState} from "@/components/ui/Feedback";

export default function ReturnApplicationDialog({applicationId,application,onClose,onSaved}:{applicationId:string;application?:ApplicationVerification;onClose:()=>void;onSaved:()=>void|Promise<void>}){
 const [data,setData]=useState(application??null),[error,setError]=useState(""),[reason,setReason]=useState(""),[category,setCategory]=useState("information"),[affected,setAffected]=useState<DocumentKind[]>([]);
 const [saved,setSaved]=useState(false);
 const [review,setReview]=useState(false),[password,setPassword]=useState(""),[busy,setBusy]=useState(false);
 const pending=useRef(false),request=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{if(application)return;let active=true;void workflowRequest<ApplicationVerification>(new URLSearchParams({applicationId}).toString()).then(value=>{if(active)setData(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"The application could not be loaded.");});return()=>{active=false;};},[application,applicationId]);
 const prepare=()=>{
  setError("");if(!reason.trim()){setError("Explain why the application is being returned and what the member must correct.");return;}
  if(category==="documents"&&!affected.length){setError("Select the uploaded documents that need replacement, or choose Application information for missing files.");return;}setReview(true);
 };
 const submit=async()=>{
  if(!data||pending.current)return;setError("");if(!password){setError("Enter your own account password to confirm.");return;}
  const body={operation:"return",applicationId,revision:data.revision,stateHash:data.stateHash,payload:{category,reason:reason.trim(),affectedKinds:affected}};
  const key=JSON.stringify(body);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
  pending.current=true;setBusy(true);
  try{await workflowRequest("",{method:"POST",body:JSON.stringify({...body,requestId:request.current.id,password})});setSaved(true);}
  catch(error){setError(error instanceof Error?error.message:"The application could not be returned. Refresh and retry.");}
  finally{pending.current=false;setBusy(false);setPassword("");}
 };
 if(saved)return <ActionResultDialog success title="Application returned" message={`Correction instructions for ${applicationId} were recorded. The member can update and resubmit this application.`} overlayClassName="z-[160]" onClose={()=>{void Promise.resolve(onSaved());}}/>;
 const eligible=data?.permissions.return&&["pending","under review"].includes(data.loanStatus.toLowerCase());
 return <ActionDialog title="Return Application" subtitle={applicationId+(data?" · "+data.memberName:"")} onClose={onClose} busy={busy} className="max-w-xl" overlayClassName="z-[160]"
  footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button>{review?<Button variant="primary" disabled={!eligible} loading={busy} onClick={()=>void submit()}>Confirm return</Button>:<Button variant="primary" disabled={!eligible} onClick={prepare}>Review return</Button>}</>}>
  {!data&&!error?<LoadingState label="Loading application…" />:data&&<div className="space-y-4 text-support">
   {!eligible?<p role="alert">This application cannot be returned by your account in its current state.</p>:!review?<>
    <label className="block space-y-1.5">Correction category<Select aria-label="Correction category" className="w-full" value={category} onChange={event=>setCategory(event.target.value)}><option value="information">Application information / missing requirements</option><option value="documents">Uploaded documents need replacement</option><option value="consent">Consent or witness evidence</option><option value="other">Other</option></Select></label>
    {category==="documents"&&<fieldset><legend className="mb-2 font-medium">Documents that need replacement</legend><div className="space-y-2">{data.documents.map(item=><label key={item.id} className="flex items-center gap-2"><input type="checkbox" checked={affected.includes(item.kind)} onChange={event=>setAffected(current=>event.target.checked?[...current,item.kind]:current.filter(kind=>kind!==item.kind))} />{documentKindLabels[item.kind]}</label>)}</div></fieldset>}
    <label className="block space-y-1.5">Reason and correction instructions<Textarea className="w-full" maxLength={2000} rows={4} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain what the member needs to correct before resubmitting." /></label>
    <p className="text-caption text-portal-secondary">The member will receive these instructions. Existing committee decisions stay in history; resubmission requires four fresh approvals.</p>
   </>:<>
    <p className="font-semibold">Instructions the member will receive</p><p className="whitespace-pre-wrap rounded-lg border border-portal-border p-3">{reason.trim()}</p>
    <p className="text-caption text-portal-secondary">The application will become Returned. An in-app update will be recorded and an email will be queued. Delivery status is tracked separately.</p>
    <label className="block space-y-1.5">Your account password<PasswordInput label="Your account password" className="w-full"  autoComplete="current-password" disabled={busy} value={password} onChange={event=>setPassword(event.target.value)} /></label>
    <Button size="compact" disabled={busy} onClick={()=>{setReview(false);setPassword("");}}>Back to instructions</Button>
   </>}
  </div>}
  {error&&<p role="alert" className="mt-3 text-support text-status-danger">{error}</p>}
 </ActionDialog>;
}
