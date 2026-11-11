"use client";
import PasswordInput from "@/components/ui/PasswordInput";
import {useRef,useState} from "react";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import {reviewRequest} from "@/lib/committeeReviewRequest";
import {emptyExecutionRules,validateExecutionRules,type PolicyExecutionRules} from "@/lib/committeeReview";
import type {WorkflowPolicy} from "@/lib/applicationWorkflow";
import {CommitteeField} from "@/components/committee/CommitteeFields";
import {Button} from "@/components/ui/Button";
import {Input} from "@/components/ui/Fields";
import {ActionDialog} from "@/components/ui/ActionDialog";
export default function WorkflowPolicyActivation({policy,dirty,onActivated}:{policy:WorkflowPolicy;dirty:boolean;onActivated:()=>Promise<void>}){
 const {role}=useAdminAuth(),[rules,setRules]=useState<PolicyExecutionRules>({...emptyExecutionRules,crecomApprovals:3,bodReviewers:1,bodApprovals:1,bodAuthority:"recommendation",signatoryLayout:"manual_form_v1",finalMode:"authorized_admin",allowOverride:false,ruleReference:policy.authorizationReference});
 const [confirm,setConfirm]=useState(false),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[attested,setAttested]=useState(false);
 const request=useRef(crypto.randomUUID()),submitted=useRef<string|null>(null),pending=useRef(false);
 if(role!=="super_admin"||policy.status!=="draft")return null;
 const update=<K extends keyof PolicyExecutionRules>(key:K,value:PolicyExecutionRules[K])=>setRules(current=>({...current,[key]:value}));
 const blockers=[
  ...(policy.config.reviewerCount!==3?["The saved draft must require 3 CRECOM reviewers."]:[]),
  ...(policy.config.crecomAuthority==="pending"||!policy.config.quorumRule.trim()||!policy.config.finalAuthority.trim()?["Complete the committee and final-authority descriptions in the saved draft."]:[]),
  ...(policy.config.bodMode!=="required"?["Set BOD review to Required for every loan and save a new draft."]:[]),
  ...(!policy.authorizationReference.trim()||!policy.config.requirementsReference.trim()?["Record the policy authorization and requirements references."]:[]),
  ...([policy.config.borrowerConsentRequired,policy.config.coMakerConsentRequired].some(item=>item===null)||policy.config.witnessCount===null||!policy.config.allowedConsentMethods.length?["Complete consent, witness and evidence-method requirements."]:[]),
 ];
 const begin=()=>{setError("");try{validateExecutionRules(rules);if(blockers.length)throw new Error(blockers[0]);if(!attested)throw new Error("Confirm that the rules match the cooperative's authorized process.");setConfirm(true);}catch(error){setError(error instanceof Error?error.message:"Complete the activation details.");}};
 const activate=async()=>{
  if(pending.current)return;
  if(!password){setError("Enter your Super Admin password.");return;}
  const key=JSON.stringify({policyId:policy.id,rules});
  if(submitted.current&&submitted.current!==key)request.current=crypto.randomUUID();
  submitted.current=key;pending.current=true;setBusy(true);setError("");
  try{
   await reviewRequest("",{method:"POST",body:JSON.stringify({operation:"activate_policy",policyId:policy.id,rules,requestId:request.current,password})});
   await onActivated();setConfirm(false);
  }catch(error){setError(error instanceof Error?error.message:"Policy activation failed.");}
  finally{pending.current=false;setBusy(false);setPassword("");}
 };
 return <section className="space-y-4 rounded-lg border border-portal-border p-4" aria-label="Activate saved workflow policy">
  <div><h3 className="text-support font-semibold">Activate the saved policy</h3><p className="mt-1 text-caption text-portal-secondary">Every loan needs two CRECOM members, one CRECOM chairperson and one BOD chairperson. All four must approve before an authorized Admin or Super Admin records final approval.</p></div>
  <div className="grid gap-3 md:grid-cols-2">
   <CommitteeField label="CRECOM approval requirement"><Input readOnly disabled value="2 members + 1 chairperson · all 3 approve" className="cursor-not-allowed" /></CommitteeField>
   <CommitteeField label="Final authority"><Input readOnly disabled value="Authorized Admin / Super Admin" className="cursor-not-allowed" /></CommitteeField>
   <CommitteeField label="BOD approval requirement"><Input readOnly disabled value="1 chairperson · required for every loan" className="cursor-not-allowed" /></CommitteeField>
   <CommitteeField label="BOD authority"><Input readOnly disabled value="Confirmation before staff final decision" className="cursor-not-allowed" /></CommitteeField>
   <CommitteeField label="Voting-rules authorization reference"><Input maxLength={500} value={rules.ruleReference} onChange={event=>update("ruleReference",event.target.value)} /></CommitteeField>
  </div>
  <label className="flex gap-2 text-support"><input type="checkbox" checked={rules.allResponses} onChange={event=>update("allResponses",event.target.checked)} />All assigned reviewers must respond before a panel outcome is recorded. All required panels must complete before the final decision.</label>
  <label className="flex gap-2 text-support"><input type="checkbox" checked={attested} onChange={event=>setAttested(event.target.checked)} />I checked this saved configuration against the cooperative&apos;s authorized process and references.</label>
  {blockers.length>0&&<ul className="list-disc space-y-1 pl-5 text-caption text-portal-secondary">{blockers.map(item=><li key={item}>{item}</li>)}</ul>}
  {dirty&&<p className="text-caption text-portal-secondary">Save the current draft changes before activating a version.</p>}
  {error&&<p role="alert" className="text-support text-status-danger">{error}</p>}
  <Button disabled={dirty||busy||blockers.length>0||!attested} onClick={begin}>Review policy activation</Button>
  {confirm&&<ActionDialog title="Activate approved workflow policy" subtitle={"Version "+policy.version+" · "+policy.name} onClose={()=>{if(!busy){setConfirm(false);setPassword("");}}} busy={busy}
   footer={<><Button disabled={busy} onClick={()=>{setConfirm(false);setPassword("");}}>Cancel</Button><Button variant="primary" loading={busy} onClick={()=>void activate()}>Activate this policy</Button></>}>
   <div className="space-y-4 text-support"><p>This activates the saved version for new verification work. Two CRECOM members and one CRECOM chairperson must approve, followed by the BOD chairperson. An authorized Admin or Super Admin records the final decision. A required rejection blocks final approval.</p>
    <p>Authorization: {rules.ruleReference}</p><p>BOD: One chairperson confirmation required for every loan.</p>
    <CommitteeField label="Your Super Admin password"><PasswordInput label="Your Super Admin password"  autoComplete="current-password" value={password} disabled={busy} onChange={event=>setPassword(event.target.value)} /></CommitteeField>
    {error&&<p role="alert" className="text-status-danger">{error}</p>}
   </div>
  </ActionDialog>}
 </section>;
}
