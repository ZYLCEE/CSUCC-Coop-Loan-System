"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import {CheckCircle2,ClipboardCheck,RefreshCw} from "lucide-react";
import {useAdminAuth} from "@/components/auth/AdminAuthProvider";
import {Button} from "@/components/ui/Button";
import {Badge} from "@/components/ui/StatusBadge";
import {FormDialog} from "@/components/ui/FormDialog";
import {ConfirmActionDialog} from "@/components/ui/ConfirmActionDialog";
import {LoadingState} from "@/components/ui/Feedback";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import {reviewRequest} from "@/lib/committeeReviewRequest";
import {watchAdminNotifications} from "@/lib/adminNotifications";
import {displayVerificationBlocker,type ApplicationVerification,type VerificationChecks} from "@/lib/applicationWorkflow";
import type {AdminReviewState} from "@/lib/committeeReview";
import type {ReleasedLoan} from "@/lib/loanRelease";
import {committeeProgress,currentProcessingStep,isLoanReleased,processingStepDescription,type ProcessingStep} from "@/lib/applicationProcessing";
import {getAdminPortalPrefix} from "@/lib/auth/roles";
import {documentDate} from "@/components/documents/documentPresentation";
import ProcessingReviewStep from "./ProcessingReviewStep";
import ProcessingStepper from "./ProcessingStepper";
import ProcessingRequirements,{requirementEvidence} from "./ProcessingRequirements";
import LoanReleaseDialog from "./LoanReleaseDialog";
import ReturnApplicationDialog from "./ReturnApplicationDialog";
import {ReviewActionDialog,type ReviewAction} from "./CommitteeReviewPanel";
import styles from "./processing.module.css";

export default function ProcessApplicationDialog({applicationId,onClose,onUpdated}:{applicationId:string;onClose:()=>void;onUpdated?:()=>void}) {
  const {can,user,role}=useAdminAuth();
  const [data,setData]=useState<ApplicationVerification|null>(null),[review,setReview]=useState<AdminReviewState|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[reviewError,setReviewError]=useState("");
  const [checks,setChecks]=useState<VerificationChecks>({identity:false,eligibility:false,terms:false}),[notes,setNotes]=useState("");
  const [selectedStep,setSelectedStep]=useState<ProcessingStep|null>(null);
  const [action,setAction]=useState<"start"|"mark_verified"|"return"|null>(null),[reviewAction,setReviewAction]=useState<ReviewAction|null>(null);
  const [busy,setBusy]=useState(false),[documentBusy,setDocumentBusy]=useState(false),[notice,setNotice]=useState(""),[reloadConfirm,setReloadConfirm]=useState(false);
  const [releaseOpen,setReleaseOpen]=useState(false),[released,setReleased]=useState<ReleasedLoan|null>(null);
  const pending=useRef(false),committed=useRef(false),request=useRef<{key:string;id:string}|null>(null);
  const mounted=useRef(false),edits=useRef(0),loadSequence=useRef(0);
  const load=useCallback(async()=>{
    const sequence=++loadSequence.current,editVersion=edits.current;
    const query=new URLSearchParams({applicationId}).toString();
    const [verificationResult,reviewResult]=await Promise.allSettled([workflowRequest<ApplicationVerification>(query),reviewRequest<AdminReviewState>(query)]);
    if(!mounted.current||sequence!==loadSequence.current||editVersion!==edits.current)return;
    if(verificationResult.status==="rejected")throw verificationResult.reason;
    const next=verificationResult.value;
    setData(next);setChecks(next.checks);setNotes(next.notes);setError("");
    setReview(reviewResult.status==="fulfilled"?reviewResult.value:null);
    setReviewError(reviewResult.status==="rejected"?"Committee progress could not be loaded. Refresh before sending or deciding this application.":"");
  },[applicationId]);
  useEffect(()=>{
    mounted.current=true;
    void load().catch(error=>{if(mounted.current)setError(error instanceof Error?error.message:"Application processing could not be loaded.");}).finally(()=>{if(mounted.current)setLoading(false);});
    return()=>{mounted.current=false;};
  },[load]);
  const dirty=!!data&&(notes!==data.notes||JSON.stringify(checks)!==JSON.stringify(data.checks));
  const interactionBusy=busy||documentBusy||!!reviewAction||releaseOpen;
  const currentStep=data?currentProcessingStep(data,review):1,step=selectedStep??currentStep;
  useEffect(()=>{
    if(!user?.id||dirty||interactionBusy||action||reloadConfirm)return;
    const update=()=>{if(document.visibilityState!=="hidden")void load().catch(()=>{});};
    const stop=watchAdminNotifications(user.id,update);
    const timer=currentStep<=3?window.setInterval(update,15000):undefined;
    window.addEventListener("focus",update);
    return()=>{stop();window.clearInterval(timer);window.removeEventListener("focus",update);};
  },[user?.id,dirty,interactionBusy,action,reloadConfirm,load,currentStep]);
  const canVerify=!!data?.permissions.verify&&can("applications.verify"),canReturn=!!data?.permissions.return&&can("applications.return");
  const currentCycles=review?.cycles.filter(cycle=>cycle.status!=="superseded")??[];
  const crecom=committeeProgress(review,"CRECOM"),bod=committeeProgress(review,"BOD");
  const needsRestart=!!data&&(data.stale||review?.verificationStage==="review_stale")&&currentCycles.length>0;
  const editable=canVerify&&!!data?.enrolled&&!!data.canEnroll&&currentStep===1&&!needsRestart;
  const close=()=>{onClose();if(committed.current)onUpdated?.();};
  const refresh=async()=>{
    setLoading(true);setNotice("");
    try{await load();}catch(error){setError(error instanceof Error?error.message:"Application processing could not be loaded.");}
    finally{if(mounted.current)setLoading(false);}
  };
  const save=async(operation:"start"|"save_draft"|"mark_verified")=>{
    if(!data||pending.current)return;
    const payload=operation==="save_draft"?{checks,notes}:{};
    const body={operation,applicationId,revision:data.revision,stateHash:data.stateHash,payload},key=JSON.stringify(body);
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
    pending.current=true;setBusy(true);setError("");setNotice("");
    try{
      await workflowRequest("",{method:"POST",body:JSON.stringify({...body,requestId:request.current.id})});
      committed.current=true;await load();setAction(null);setSelectedStep(null);
      setNotice(operation==="start"?"Requirements check started.":operation==="save_draft"?"Checks saved.":"Requirements verified. Ready to send to CRECOM.");
    }catch(error){setError(error instanceof Error?error.message:"The action could not be saved.");}
    finally{pending.current=false;setBusy(false);}
  };
  type NextAction="return"|"back"|"start"|"save_draft"|"mark_verified"|"reopen"|"refresh"|"forward"|"forward_bod"|"finalize"|"release"|"wait";
  let next:{label:string;disabled?:boolean;kind:NextAction}|null=null;
  if(data&&step!==currentStep)next={label:"Back to current step",kind:"back"};
  else if(data&&currentStep===5&&!isLoanReleased(data))next={label:"Record release",disabled:!can("loans.release")||data.loanStatus.toLowerCase()!=="approved",kind:"release"};
  else if(data&&(data.canEnroll||data.enrolled)&&!review?.finalDecision){
    if(currentCycles.some(cycle=>cycle.outcome==="reject"))next={label:"Return Application",disabled:!canReturn,kind:"return"};
    else if(currentStep===1){
      if(data.loanStatus.toLowerCase()==="returned")next={label:"Waiting for member resubmission",disabled:true,kind:"wait"};
      else if(needsRestart)next={label:"Restart requirements check",disabled:!review?.canManage,kind:"reopen"};
      else if(!data.enrolled)next={label:"Start checking",disabled:!canVerify,kind:"start"};
      else if(dirty)next={label:"Save checks",disabled:!editable,kind:"save_draft"};
      else next={label:"Mark as verified",disabled:!editable||data.blockers.length>0||!Object.values(checks).every(Boolean)||!requirementEvidence(data).every(row=>row.complete)||data.requiredKinds.some(kind=>!data.documents.some(document=>document.kind===kind&&document.reviewStatus==="verified")),kind:"mark_verified"};
    }else if(!review)next={label:"Refresh progress",kind:"refresh"};
    else if(currentStep===2&&!crecom.cycle)next={label:"Send to CRECOM",disabled:!review.verified||!review.rules||!review.canManage||!can("applications.forward"),kind:"forward"};
    else if(currentStep===3&&!bod.cycle)next={label:"Send to BOD",disabled:!crecom.approved||!review.rules||!review.canManage||!can("applications.forward")||review.verificationStage!=="ready_for_bod",kind:"forward_bod"};
    else if(currentStep===4)next={label:"Record final decision",disabled:!review.canFinalize||!can("applications.finalize")||!crecom.approved||!bod.approved||!review.verified,kind:"finalize"};
    else next={label:currentStep===2?"Waiting for CRECOM":"Waiting for BOD",disabled:true,kind:"wait"};
  }
  const runNext=(kind:NextAction)=>{
    if(kind==="return")setAction("return");
    else if(kind==="back")setSelectedStep(null);
    else if(kind==="refresh")void refresh();
    else if(kind==="save_draft")void save("save_draft");
    else if(kind==="start"||kind==="mark_verified"){setError("");setAction(kind);}
    else if(kind==="forward"||kind==="forward_bod")setReviewAction({operation:kind,stage:kind==="forward"?"CRECOM":"BOD"});
    else if(kind==="finalize"||kind==="reopen")setReviewAction({operation:kind});
    else if(kind==="release")setReleaseOpen(true);
  };
  const verification=data?.history.find(event=>event.action==="mark_verified");
  const activeLoansPath=getAdminPortalPrefix(role??"admin")+"/active-loans";
  return <>
    <FormDialog title="Process Application" icon={ClipboardCheck} subtitle={data?data.memberName+" · "+applicationId:applicationId}
      className="max-w-[1080px]" overlayClassName="z-[140]" dirty={dirty} busy={interactionBusy} onClose={close}
      footer={<>
        <Button data-dialog-close disabled={interactionBusy}>Close</Button>
        <Button size="compact" disabled={interactionBusy||loading} onClick={()=>{if(dirty)setReloadConfirm(true);else void refresh();}}><RefreshCw className="h-4 w-4" />Refresh</Button>
        {!loading&&step===1&&currentStep===1&&data?.loanStatus.toLowerCase()!=="returned"&&canReturn&&!review?.finalDecision&&next?.kind!=="return"&&<Button disabled={interactionBusy||dirty} onClick={()=>setAction("return")}>Return Application</Button>}
        {!loading&&next&&<Button variant="primary" disabled={interactionBusy||next.disabled} loading={busy} onClick={()=>{if(next)runNext(next.kind);}}>{next.label}</Button>}
        {!loading&&data&&step===5&&isLoanReleased(data)&&<Link href={activeLoansPath} onClick={close} className="ui-button ui-button--primary">View in Active Loans</Link>}
      </>}>
      {loading?<LoadingState label="Loading application progress…"/>:!data?<div className="space-y-3"><p role="alert" className="text-support text-status-danger">{error}</p><Button onClick={()=>void refresh()}>Retry</Button></div>:<div className="space-y-4">
        <ProcessingStepper application={data} review={review} currentStep={currentStep} selectedStep={step} disabled={interactionBusy||dirty} onSelect={number=>setSelectedStep(number===currentStep?null:number)}/>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3 text-support"><span className="font-semibold">{data.loanType}{data.loanSummary?" · ₱"+Number(data.loanSummary.amount).toLocaleString("en-PH",{minimumFractionDigits:2})+" · "+data.loanSummary.months+" months":""}</span><span className="text-caption text-portal-secondary">{data.memberNumber}</span></div>
        {data.lastReturned&&<p className="rounded-lg bg-status-warning-surface p-3 text-support text-status-warning">Returned: {data.lastReturned.reason}</p>}
        {error&&<p role="alert" className="text-support text-status-danger">{error}</p>}
        {reviewError&&<p role="alert" className="text-support text-status-danger">{reviewError}</p>}
        {notice&&<p role="status" className="text-support text-status-success">{notice}</p>}
        {step===1?<>
          <ProcessingRequirements data={data} checks={checks} editable={editable} canReview={can("documents.review")&&currentStep===1&&!needsRestart&&!review?.finalDecision} dirty={dirty} busy={busy||documentBusy}
            onCheck={(key,value)=>{edits.current++;setChecks(current=>({...current,[key]:value}));}} onBusy={setDocumentBusy}
            onUpdated={async()=>{committed.current=true;await load();setNotice("Document review saved.");}}/>
          {verification&&<p className={styles.summary+" text-support"}><CheckCircle2 className="mr-2 inline h-4 w-4 text-status-success"/>Verified by {verification.actor} · {documentDate(verification.createdAt,true)}</p>}
          {dirty&&<p role="status" className="text-caption text-portal-secondary">Save your checks before continuing.</p>}
          {currentStep===1&&data.blockers.length>0&&<details className="rounded-lg border border-portal-border p-3"><summary className="cursor-pointer text-support font-medium">What still needs attention ({data.blockers.length})</summary><ul className="mt-3 list-disc space-y-1 pl-5 text-caption text-portal-secondary">{data.blockers.map(item=><li key={item}>{displayVerificationBlocker(item)}</li>)}</ul></details>}
        </>:step===5?<section className="space-y-4" aria-label="Loan release">
          <div className={styles.summary}><Badge tone={currentStep===5?"success":"neutral"}>{currentStep<5?"Upcoming":isLoanReleased(data)?"Released":"Approved — awaiting release"}</Badge><h3 className="mt-3 text-section-title font-semibold">{currentStep<5?"Release pending":isLoanReleased(data)?"Loan released":"Record loan release"}</h3><p className="mt-2 text-support text-portal-secondary">{currentStep<5?"Complete the required approvals and final decision before recording a release.":processingStepDescription(5,data,review)}</p></div>
          {review?.finalDecision?.decision==="approve"&&<p className="text-support">Approved by {review.finalDecision.actor} · {documentDate(review.finalDecision.createdAt,true)}</p>}
          {released&&<dl className="grid gap-3 rounded-lg border border-portal-border p-4 text-support sm:grid-cols-2"><div><dt className="text-portal-secondary">Release date</dt><dd>{documentDate(released.date_released)}</dd></div><div><dt className="text-portal-secondary">Disbursement reference</dt><dd>{released.release_reference}</dd></div><div><dt className="text-portal-secondary">Net proceeds</dt><dd>₱{Number(released.net_proceeds).toLocaleString("en-PH",{minimumFractionDigits:2})}</dd></div></dl>}
          {!isLoanReleased(data)&&currentStep===5&&<p className="text-support text-portal-secondary">Confirm the release date, voucher number and actual net proceeds received by the member.</p>}
          {!can("loans.release")&&!isLoanReleased(data)&&<p className="text-caption text-portal-secondary">Release permission is required to record disbursement.</p>}
        </section>:<>
          {step===4&&<section aria-label="Verification summary" className={styles.summary}><h3 className="font-semibold">{review?.verified?"Requirements verified":"Requirements need verification"}</h3>{verification&&<p className="mt-1 text-caption text-portal-secondary">{verification.actor} · {documentDate(verification.createdAt,true)}</p>}<p className="mt-2 text-support">{data.requiredKinds.filter(kind=>data.documents.some(document=>document.kind===kind&&document.reviewStatus==="verified")).length} of {data.requiredKinds.length} required documents verified · {requirementEvidence(data).every(row=>row.complete)?"Consent & witness requirements complete":"Consent & witness requirements need attention"}</p></section>}
          <ProcessingReviewStep key={step} step={step} currentStep={currentStep} data={review} onAction={setReviewAction}/>
        </>}
        {(data.canEnroll||data.enrolled)&&!review?.finalDecision&&(!data.policy||!review?.rules)&&<p className="rounded-lg border border-portal-border p-3 text-caption text-portal-secondary">Approval setup is incomplete. Super Admin must configure the approval policy and reviewer accounts before this application can be sent.</p>}
        {currentStep===1&&!canVerify&&data.canEnroll&&<p className="text-caption text-portal-secondary">Verification permission is required to save checks.</p>}
        {currentStep===4&&!review?.finalDecision&&!review?.canFinalize&&<p className="text-caption text-portal-secondary">Final approval requires all four committee approvals and final-decision permission.</p>}
        <details className="border-t border-portal-border pt-3"><summary className="cursor-pointer text-support font-medium">Processing history & additional actions</summary><div className="mt-3 space-y-3">
          {review?.canManage&&currentCycles.length>0&&!review.finalDecision&&<Button size="compact" disabled={interactionBusy||dirty} onClick={()=>setReviewAction({operation:"reopen"})}>Return to requirements check</Button>}
          {review?.cycles.some(cycle=>cycle.status==="superseded")&&<details><summary className="cursor-pointer text-caption font-medium text-portal-secondary">Previous committee confirmations</summary><div className="mt-3"><ProcessingReviewStep step={4} currentStep={currentStep} data={review} onAction={setReviewAction} archived/></div></details>}
          {!data.history.length&&!review?.events.length&&<p className="text-caption text-portal-secondary">No processing actions have been recorded yet.</p>}
          {[...data.history.map(event=>({id:event.id,action:({start:"Requirements check started",save_draft:"Checks saved",return:"Returned for requirements",mark_verified:"Requirements verified"} as Record<string,string>)[event.action]??event.action,actor:event.actor,createdAt:event.createdAt,reason:typeof event.details.reason==="string"?event.details.reason:typeof event.details.notes==="string"&&event.details.notes?"Internal notes: "+event.details.notes:""})),...(review?.events??[])]
            .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).map(event=><article key={event.id} className="rounded-lg border border-portal-border p-3 text-caption"><p className="font-semibold capitalize">{event.action.replaceAll("_"," ")}</p><p className="mt-1 text-portal-secondary">{event.actor} · {documentDate(event.createdAt,true)}</p>{event.reason&&<p className="mt-2 whitespace-pre-wrap">{event.reason}</p>}</article>)}
        </div></details>
      </div>}
    </FormDialog>
    {reloadConfirm&&<ConfirmActionDialog overlayClassName="z-[150]" title="Reload requirements?" question="Discard your unsaved checklist changes and reload the current application?" confirmLabel="Discard and reload" busy={busy} onClose={()=>setReloadConfirm(false)} onConfirm={async()=>{setReloadConfirm(false);await refresh();}}/>}
    {action==="return"&&data&&<ReturnApplicationDialog applicationId={applicationId} application={data} onClose={()=>setAction(null)} onSaved={async()=>{committed.current=true;setAction(null);setSelectedStep(null);await load();setNotice("Application returned. Correction instructions were recorded for the member.");}}/>}
    {action&&action!=="return"&&data&&<ConfirmActionDialog overlayClassName="z-[150]" title={action==="start"?"Start checking requirements?":"Mark requirements verified?"} busy={busy} error={error} onClose={()=>{if(!pending.current){setAction(null);setError("");}}}
      confirmLabel={action==="start"?"Start checking":"Mark as verified"} question={action==="start"?"Start the requirements check for this application?":"Confirm that the documents, staff checks and required consent and witness evidence are complete. You can then send the verified application to CRECOM."}
      details={[{label:"Application",value:applicationId},{label:"Member",value:data.memberName}]} onConfirm={()=>save(action)}/>}
    {reviewAction&&review&&<ReviewActionDialog key={reviewAction.operation+":"+reviewAction.assignment?.id} data={review} action={reviewAction} onClose={()=>setReviewAction(null)} onSaved={async()=>{committed.current=true;setReviewAction(null);setSelectedStep(null);await load();setNotice("Review action recorded.");}}/>}
    {releaseOpen&&<LoanReleaseDialog applicationId={applicationId} processing processingState={data?{application:data,review}:undefined} onClose={()=>setReleaseOpen(false)} onReleased={()=>{committed.current=true;}} onRecorded={loan=>{setReleased(loan);committed.current=true;setData(current=>current?{...current,loanStatus:"released"}:current);setNotice("Release recorded. The loan is now in Active Loans.");}}/>}
  </>;
}
