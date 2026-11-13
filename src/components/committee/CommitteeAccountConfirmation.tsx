"use client";
import {useRef,useState} from "react";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {Button} from "@/components/ui/Button";
import CommitteePasswordField from "./CommitteePasswordField";
import {CommitteeField} from "./CommitteeFields";
import {committeeRequest} from "@/lib/committeeRequest";
import {signatoryPositionLabel,type CommitteeAccount} from "@/lib/committee";

export default function CommitteeAccountConfirmation({title,account,operation,payload,requestId,credentials,onBack,onClose,onSaved,onAttempt}:{title:string;account:CommitteeAccount;operation:string;payload:unknown;requestId:string;credentials?:{password:string;confirm:string};onBack:()=>void;onClose:()=>void;onSaved:(message:string)=>void;onAttempt?:()=>void}){
 const [password,setPassword]=useState(""),[verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[attempted,setAttempted]=useState(false),[error,setError]=useState(""),pending=useRef(false);
 const reason=(payload as {reason?:string})?.reason;
 const submit=async()=>{
  if(pending.current)return;
  if(!password){setError("Enter your account password.");return;}
  pending.current=true;setBusy(true);setError("");
  try{
   if(!verified){const result=await committeeRequest<{verified?:boolean}>("",{method:"POST",body:JSON.stringify({operation:"verify",password})},true);if(result.verified!==true)throw new Error("Your administrator password could not be verified.");setVerified(true);}
   else{setAttempted(true);onAttempt?.();const result=await committeeRequest<{success?:boolean;message?:string}>("",{method:"POST",body:JSON.stringify({operation,id:account.id,revision:account.revision,requestId,payload,password,...(credentials?{credentials}:{})})},true);if(result.success!==true)throw new Error("The account action could not be confirmed. Refresh and retry.");setPassword("");onSaved(result.message??"Committee account updated.");}
  }catch(error){setError(error instanceof Error?error.message:"The account action could not be completed. Retry this request.");setPassword("");setVerified(false);}
  finally{pending.current=false;setBusy(false);}
 };
 return <ActionDialog title={verified?title:"Verify "+title} subtitle={account.name+" · "+account.email} busy={busy} onClose={onClose} className="max-w-xl" tone={operation==="delete"||operation==="deactivate"?"destructive":"primary"} footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant={verified&&(operation==="delete"||operation==="deactivate")?"destructive":"primary"} loading={busy} onClick={()=>void submit()}>{verified?title:"Verify Password"}</Button></>}>
  <div className="space-y-4 text-support">
   <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-caption text-portal-secondary">Account</dt><dd className="font-semibold">{account.name}</dd></div><div><dt className="text-caption text-portal-secondary">Approval Position</dt><dd>{signatoryPositionLabel(account.role==="bod_member"?"bod_chairperson":account.committeeSeat==="chairperson"?"crecom_chairperson":"crecom_member",account.committeeMemberNumber)}</dd></div>{reason&&<div className="sm:col-span-2"><dt className="text-caption text-portal-secondary">Reason</dt><dd className="whitespace-pre-wrap break-words">{reason}</dd></div>}</dl>
   {verified?<>
    <p className="font-semibold">{operation==="reset"?"Reset this account to the new temporary password?":operation==="delete"?"Permanently remove this account’s sign-in access?":operation==="deactivate"?"Block this reviewer from accessing the committee portal?":operation==="reactivate"?"Unblock this reviewer using their current membership dates?":"Save the reviewed committee account changes?"}</p>
    <p className="text-portal-secondary">{operation==="reset"?"Share the temporary password privately. The reviewer must choose a different personal password on their next sign-in.":operation==="delete"?"This cannot be undone. Past decisions and assignment history remain recorded. Open reviews must be reassigned.":operation==="deactivate"?"Past decisions remain recorded. Open reviews may need reassignment.":"Existing committee approval and eligibility rules still apply."}</p>
    {operation==="edit"&&<dl className="grid gap-3 sm:grid-cols-2">{Object.entries(payload as Record<string,unknown>).filter(([key])=>["name","role","committeeSeat","committeeMemberNumber","startsAt","endsAt","title"].includes(key)).map(([key,value])=><div key={key}><dt className="text-caption text-portal-secondary">{({name:"Full Name",role:"Committee",committeeSeat:"Position",committeeMemberNumber:"Member Number",startsAt:"Start Date",endsAt:"End Date",title:"Title"} as Record<string,string>)[key]}</dt><dd className="break-words">{key==="role"?(value==="bod_member"?"BOD":"CRECOM"):key==="committeeSeat"?(value==="chairperson"?"Chairperson":"Member"):key==="startsAt"||key==="endsAt"?(value?String(value).slice(0,10):"No end date"):String(value??"Not applicable")}</dd></div>)}</dl>}
   </>:<><p>Enter your own administrator password to continue. Verification does not change the account.</p><CommitteeField label="Your account password" id="committee-action-password"><CommitteePasswordField id="committee-action-password" label="Your account password" autoComplete="current-password" maxLength={1024} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></CommitteeField>{!attempted&&<Button size="compact" disabled={busy} onClick={onBack}>Back to details</Button>}</>}
   {error&&<p role="alert" className="text-status-danger">{error}</p>}
  </div>
 </ActionDialog>;
}
