"use client";

import {useEffect,useRef,useState} from "react";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import {Button} from "@/components/ui/Button";
import {Input,Select,Textarea} from "@/components/ui/Fields";
import {LoadingState} from "@/components/ui/Feedback";
import {ConfirmActionDialog} from "@/components/ui/ConfirmActionDialog";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import {emptyWorkflowPolicy,validateWorkflowPolicy,type WorkflowPolicy,type WorkflowPolicyConfig,type WorkflowPolicyList} from "@/lib/applicationWorkflow";
import {documentDate} from "@/components/documents/documentPresentation";
import WorkflowPolicyActivation from "./WorkflowPolicyActivation";

export default function ApprovalWorkflowPolicy(){
  const {can}=useAdminAuth();
  const [data,setData]=useState<WorkflowPolicyList|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [name,setName]=useState(""),[config,setConfig]=useState<WorkflowPolicyConfig>(emptyWorkflowPolicy),[authorizationReference,setReference]=useState("");
  const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[viewed,setViewed]=useState<string|null>(null);
  const pending=useRef(false),request=useRef<{key:string;id:string}|null>(null);
  useEffect(()=>{
    let active=true;
    void workflowRequest<WorkflowPolicyList>("operation=policies").then(result=>{
      if(active){setData(result);const latest=result.policies[0];if(latest){setName(latest.name);setConfig(latest.config);setReference(latest.authorizationReference);}}
    }).catch(error=>{if(active)setError(error instanceof Error?error.message:"Workflow policies could not be loaded.");}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const latest=data?.policies[0],selected=data?.policies.find(item=>item.id===viewed);
  const editable=!!data?.canManage && can("workflow.policy.manage") && !viewed;
  const dirty=JSON.stringify({name,config,authorizationReference})!==JSON.stringify({name:latest?.name??"",config:latest?.config??emptyWorkflowPolicy,authorizationReference:latest?.authorizationReference??""});
  useEffect(()=>{
    if(!dirty)return;
    const prevent=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener("beforeunload",prevent);
    return()=>window.removeEventListener("beforeunload",prevent);
  },[dirty]);
  const update=<K extends keyof WorkflowPolicyConfig>(key:K,value:WorkflowPolicyConfig[K])=>setConfig(current=>({...current,[key]:value}));
  const save=async()=>{
    if(pending.current || !data)return;
    let payload;
    try{payload=validateWorkflowPolicy({name,config,authorizationReference});}catch(error){setError(error instanceof Error?error.message:"Complete the policy draft.");return;}
    const body={operation:"policy_draft",expectedLatestId:latest?.id??null,payload},key=JSON.stringify(body);
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
    pending.current=true;setBusy(true);setError("");setNotice("");
    try{
      await workflowRequest("",{method:"POST",body:JSON.stringify({...body,requestId:request.current.id})});
      const result=await workflowRequest<WorkflowPolicyList>("operation=policies");setData(result);setName(result.policies[0].name);setConfig(result.policies[0].config);setReference(result.policies[0].authorizationReference);
      setConfirm(false);setNotice("A new policy draft version was saved. Existing application policies were not changed.");
    }catch(error){setError(error instanceof Error?error.message:"The policy draft could not be saved.");}
    finally{pending.current=false;setBusy(false);}
  };
  if(loading)return <LoadingState label="Loading approval workflow policies…" />;
  if(!data)return <div role="alert" className="ui-card ui-card-padding text-support text-status-danger">{error} Reload Settings to retry.</div>;
  const displayed=selected?.config??config;
  const shownName=selected?.name??name;
  const describe=(policy:WorkflowPolicy)=>"v"+policy.version+" · "+policy.name+" · "+(policy.status==="draft"?"Draft":policy.status==="approved"?"Approved":"Retired");
  return <section className="ui-card ui-card-padding space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-card-title">Approval workflow policy</h2><p className="mt-1 text-support text-portal-secondary">Prepare versioned rules for verification, three CRECOM confirmations, BOD chairperson confirmation for every loan and authorized staff final authority.</p></div>
      <Select aria-label="Policy version" value={viewed??""} onChange={event=>setViewed(event.target.value)}>
        <option value="">Current draft editor</option>{data.policies.map(policy=><option key={policy.id} value={policy.id}>{describe(policy)}</option>)}
      </Select>
    </div>
    <p role="status" className="rounded-lg border border-portal-border bg-surface-muted p-3 text-support">{latest?.status==="approved"?"The saved policy is activated. Changes must be saved and authorized as a new version.":"Drafts do not activate committee decisions or final approval. Complete the requirements and project references before activation."}</p>
    {error && <p role="alert" className="text-support text-status-danger">{error}</p>}
    {notice && <p role="status" className="text-support text-status-success">{notice}</p>}
    {selected && <p className="text-caption text-portal-secondary">{describe(selected)} · {selected.createdBy} · {documentDate(selected.createdAt,true)} · Read-only version</p>}
    {editable&&<Button disabled={busy} onClick={()=>setConfig(current=>({...current,reviewerCount:3,crecomAuthority:"recommendation",quorumRule:"Two CRECOM members and one CRECOM chairperson must all respond and approve.",bodMode:"required",bodCriteria:"One BOD chairperson confirmation is required for every loan after CRECOM review.",finalAuthority:"An authorized Admin or Super Admin records the final decision after all four required confirmations. A required rejection blocks final approval."}))}>Apply confirmed committee roles to draft</Button>}
    <fieldset disabled={!editable || busy} className="space-y-5 disabled:opacity-80">
      <label className="block space-y-1.5 text-label">Policy draft name<Input className="block w-full max-w-xl" value={shownName} maxLength={160} onChange={event=>setName(event.target.value)} placeholder="e.g. CSUCC application review policy" /></label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-label">CRECOM reviewers per application<Input className="w-full" type="number" min={1} max={100} step={1} value={displayed.reviewerCount??""} placeholder="Pending CSUCC decision" onChange={event=>update("reviewerCount",event.target.value===""?null:Number(event.target.value))} /></label>
        <label className="space-y-1.5 text-label">CRECOM authority<Select aria-label="CRECOM authority" className="w-full" value={displayed.crecomAuthority} onChange={event=>update("crecomAuthority",event.target.value as WorkflowPolicyConfig["crecomAuthority"])}><option value="pending">Pending CSUCC decision</option><option value="recommendation">Recommendation</option><option value="binding_decision">Binding decision</option></Select></label>
        <label className="space-y-1.5 text-label">Quorum, outcome and disagreement rule<Textarea className="w-full" rows={3} maxLength={2000} value={displayed.quorumRule} onChange={event=>update("quorumRule",event.target.value)} placeholder="Record the proposed rule, including ties, negative votes, deferrals and recusals." /></label>
        <label className="space-y-1.5 text-label">Designated final authority<Textarea className="w-full" rows={3} maxLength={2000} value={displayed.finalAuthority} onChange={event=>update("finalAuthority",event.target.value)} placeholder="Who may record final approval or rejection under the approved policy?" /></label>
        <label className="space-y-1.5 text-label">BOD stage<Select aria-label="BOD stage" className="w-full" value={displayed.bodMode} onChange={event=>update("bodMode",event.target.value as WorkflowPolicyConfig["bodMode"])}><option value="pending">Pending CSUCC decision</option><option value="none" disabled>Not required (previous configuration)</option><option value="conditional" disabled>Conditional (previous configuration)</option><option value="required">Required</option></Select></label>
        <label className="space-y-1.5 text-label">BOD applicability and authority<Textarea className="w-full" rows={2} maxLength={2000} value={displayed.bodCriteria} onChange={event=>update("bodCriteria",event.target.value)} placeholder="BOD chairperson confirmation is required for every loan before An authorized Admin or Super Admin records the final decision." /></label>
        {(["borrowerConsentRequired","coMakerConsentRequired"] as const).map(key=><label key={key} className="space-y-1.5 text-label">{key==="borrowerConsentRequired"?"Borrower consent required":"One co-maker consent required"}<Select className="w-full" value={displayed[key]===null?"pending":displayed[key]?"yes":"no"} onChange={event=>update(key,event.target.value==="pending"?null:event.target.value==="yes")}><option value="pending">Pending CSUCC decision</option><option value="yes">Required</option><option value="no">Not required under policy</option></Select></label>)}
        <label className="space-y-1.5 text-label">Separate witness attestations<Input className="w-full" type="number" min={0} max={100} step={1} value={displayed.witnessCount??""} placeholder="Pending CSUCC decision" onChange={event=>update("witnessCount",event.target.value===""?null:Number(event.target.value))} /></label>
        <fieldset><legend className="mb-2 text-label">Proposed consent evidence methods</legend><div className="space-y-2">{(["otp","paper"] as const).map(method=><label key={method} className="flex items-center gap-2 text-support"><input type="checkbox" checked={displayed.allowedConsentMethods.includes(method)} onChange={event=>update("allowedConsentMethods",event.target.checked?[...config.allowedConsentMethods,method]:config.allowedConsentMethods.filter(value=>value!==method))} />{method==="otp"?"Authenticated OTP consent record":"Documented paper consent record"}</label>)}</div></fieldset>
        <label className="space-y-1.5 text-label md:col-span-2">Requirements and formalities reference<Textarea className="w-full" rows={2} maxLength={2000} value={displayed.requirementsReference} onChange={event=>update("requirementsReference",event.target.value)} placeholder="Required documents by product/amount, exact boundaries, witness and signing requirements." /></label>
        <label className="space-y-1.5 text-label md:col-span-2">Project workflow policy reference<Input className="w-full" maxLength={500} value={selected?.authorizationReference??authorizationReference} onChange={event=>setReference(event.target.value)} placeholder="docs/approval-workflow/PROJECT_WORKFLOW_POLICY.md" /></label>
      </div>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-portal-border pt-4"><p className="text-caption text-portal-secondary">{latest?"Latest saved version: "+latest.version:"No policy draft has been saved."} Saving creates a new draft version.</p>
      {editable && <Button variant="primary" disabled={busy || !dirty || !name.trim()} onClick={()=>{try{validateWorkflowPolicy({name,config,authorizationReference});setError("");setConfirm(true);}catch(error){setError(error instanceof Error?error.message:"Complete the policy draft.");}}}>Save policy draft</Button>}
    </div>
    {!data.canManage && <p className="text-caption text-portal-secondary">Policy draft permission is required to save changes. Viewing this page does not grant final loan approval authority.</p>}
    {(selected?.executionRules??(!viewed?latest?.executionRules:null))&&<section className="rounded-lg border border-portal-border p-3 text-support"><h3 className="font-semibold">Activated voting rules</h3><p className="mt-1">CRECOM: Two members and one chairperson, all 3 must approve. BOD: One chairperson, required for every loan. Final decision: Super Admin.</p>{displayed.bodMode!=="none"&&<p>BOD: {(selected?.executionRules??latest?.executionRules)?.bodApprovals} approvals from {(selected?.executionRules??latest?.executionRules)?.bodReviewers} reviewers.</p>}<p className="mt-1 text-caption text-portal-secondary">Reference: {(selected?.executionRules??latest?.executionRules)?.ruleReference}</p></section>}
    {!viewed&&latest&&<WorkflowPolicyActivation key={latest.id} policy={latest} dirty={dirty} onActivated={async()=>{const result=await workflowRequest<WorkflowPolicyList>("operation=policies");setData(result);setName(result.policies[0].name);setConfig(result.policies[0].config);setReference(result.policies[0].authorizationReference);setNotice("The saved policy was activated with its approved voting rules.");}} />}
    {confirm && <ConfirmActionDialog title="Save approval policy draft?" question="Create a new draft version for review? It will not activate loan approval rules or change existing application policies." confirmLabel="Save draft version" busy={busy} error={error}
      details={[{label:"Policy",value:name},{label:"Status",value:"Draft"}]} onClose={()=>{if(!pending.current)setConfirm(false);}} onConfirm={save} />}
  </section>;
}
