"use client";
import {useState} from "react";
import {FormDialog} from "@/components/ui/FormDialog";
import {Button} from "@/components/ui/Button";
import {Textarea} from "@/components/ui/Fields";
import {validateCommitteeCredentials,type CommitteeAccount} from "@/lib/committee";
import CommitteeAccountConfirmation from "./CommitteeAccountConfirmation";
import CommitteePasswordField from "./CommitteePasswordField";
import {CommitteeField} from "./CommitteeFields";

export default function CommitteeCredentialDialog({account,operation,onClose,onSaved}:{account:CommitteeAccount;operation:"reset"|"delete";onClose:()=>void;onSaved:(message:string)=>void}){
 const [temporary,setTemporary]=useState(""),[confirm,setConfirm]=useState(""),[reason,setReason]=useState(""),[review,setReview]=useState(false),[error,setError]=useState(""),[attempted,setAttempted]=useState(false),[requestId]=useState(()=>crypto.randomUUID());
 const reset=operation==="reset",title=reset?"Reset Password":"Delete Account";
 if(review)return <CommitteeAccountConfirmation title={title} account={account} operation={operation} payload={{reason:reason.trim()}} requestId={requestId} credentials={reset?{password:temporary,confirm}:undefined} onBack={()=>setReview(false)} onClose={onClose} onSaved={onSaved} onAttempt={()=>setAttempted(true)}/>;
 return <FormDialog title={title} subtitle={account.name+" · "+account.email} onClose={onClose} dirty={!!temporary||!!confirm||!!reason} tone={reset?"primary":"destructive"} className="max-w-xl" footer={<><Button data-dialog-close>Cancel</Button><Button type="submit" form="committee-credential-form" variant={reset?"primary":"destructive"}>Continue to Verify</Button></>}>
  <form id="committee-credential-form" className="space-y-4 text-support" onSubmit={event=>{event.preventDefault();setError("");try{if(reset)validateCommitteeCredentials({password:temporary,confirm});if(!reason.trim()||reason.trim().length>2000)throw new Error("Enter a reason of up to 2000 characters.");setReview(true);}catch(error){setError(error instanceof Error?error.message:"Check the account action details.");}}}>
   <p>{reset?"Set a new temporary password for this reviewer. Share it privately; they must choose their own password on the next sign-in.":"Delete this reviewer’s sign-in account. Recorded committee decisions and assignment history will be retained."}</p>
   {account.assignedCount>0&&<p className="rounded-lg bg-status-warning-surface p-3 text-status-warning">{account.assignedCount} open review{account.assignedCount===1?"":"s"}. {reset?"Review access pauses until password setup is completed.":"Assign a replacement reviewer to finish these applications."}</p>}
   {reset&&<><CommitteeField label="Temporary Password" id="committee-reset-temporary"><CommitteePasswordField id="committee-reset-temporary" label="Temporary Password" autoComplete="new-password" maxLength={128} value={temporary} onChange={event=>setTemporary(event.target.value)} disabled={attempted}/></CommitteeField><CommitteeField label="Confirm Temporary Password" id="committee-reset-confirm"><CommitteePasswordField id="committee-reset-confirm" label="Confirm Temporary Password" autoComplete="new-password" maxLength={128} value={confirm} onChange={event=>setConfirm(event.target.value)} disabled={attempted}/></CommitteeField><p className="text-caption text-portal-secondary">Use 8–128 characters with uppercase, lowercase, a number and a symbol.</p></>}
   <CommitteeField label="Reason" id="committee-credential-reason"><Textarea id="committee-credential-reason" value={reason} onChange={event=>setReason(event.target.value)} rows={3} maxLength={2000} disabled={attempted}/></CommitteeField>
   {error&&<p role="alert" className="text-status-danger">{error}</p>}
  </form>
 </FormDialog>;
}
