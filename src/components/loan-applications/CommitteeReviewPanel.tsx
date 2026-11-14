"use client";
import {ActionResultDialog} from "@/components/ui/ActionResultDialog";
import {workflowRequest} from "@/lib/applicationWorkflowRequest";
import PasswordInput from "@/components/ui/PasswordInput";
import {useCallback,useEffect,useRef,useState} from "react";
import {reviewRequest} from "@/lib/committeeReviewRequest";
import type {AdminReviewState,ReviewAssignment} from "@/lib/committeeReview";
import {committeePositionLabel,signatoryPositionLabel} from "@/lib/committee";
import {displayVerificationBlocker,workflowStageLabels,type WorkflowStage} from "@/lib/applicationWorkflow";
import {CommitteeField} from "@/components/committee/CommitteeFields";
import {Button} from "@/components/ui/Button";
import {Input,Select,Textarea} from "@/components/ui/Fields";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {DataTable} from "@/components/ui/DataTable";
import {StatusBadge} from "@/components/ui/StatusBadge";
import {LoadingState} from "@/components/ui/Feedback";
import {committeeDate} from "@/lib/committeePresentation";
export type ReviewAction={operation:"forward"|"forward_bod"|"reply"|"reassign"|"reopen"|"finalize";assignment?:ReviewAssignment;stage?:"CRECOM"|"BOD"};
type Action=ReviewAction;
export default function CommitteeReviewPanel({applicationId,onUpdated}:{applicationId:string;onUpdated:()=>void}){
 const [data,setData]=useState<AdminReviewState|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [action,setAction]=useState<Action|null>(null);
 const [confirmation,setConfirmation]=useState<{assignment:ReviewAssignment;packetVersion:number;cycle:number}|null>(null);
 const query=new URLSearchParams({applicationId}).toString();
 const load=useCallback(async()=>{const result=await reviewRequest<AdminReviewState>(new URLSearchParams({applicationId}).toString());setData(result);return result;},[applicationId]);
 useEffect(()=>{let active=true;void reviewRequest<AdminReviewState>(query).then(result=>{if(active)setData(result);}).catch(error=>{if(active)setError(error instanceof Error?error.message:"Review state could not be loaded.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[query]);
 const refresh=async()=>{setLoading(true);setError("");try{await load();}catch(error){setError(error instanceof Error?error.message:"Review state could not be loaded.");}finally{setLoading(false);}};
 if(loading)return <LoadingState label="Loading committee review…" />;
 if(!data)return <div className="space-y-3"><p role="alert" className="text-support text-status-danger">{error}</p><Button onClick={()=>void refresh()}>Retry committee review</Button></div>;
 const current=data.cycles.filter(item=>item.status!=="superseded"),canManage=data.canManage&&!data.finalDecision;
 return <section className="space-y-4" aria-label="Committee review management">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-support font-semibold">{workflowStageLabels[data.verificationStage as WorkflowStage]??data.verificationStage}</h3><p className="mt-1 text-caption text-portal-secondary">{data.policyName??"Policy configuration pending"} · Revision {data.revision}</p></div><Button size="compact" onClick={()=>void refresh()}>Refresh review</Button></div>
  {error&&<p role="alert" className="text-support text-status-danger">{error}</p>}{notice&&<p role="status" className="text-support text-status-success">{notice}</p>}
  {!data.rules&&<p className="rounded-lg bg-surface-muted p-3 text-support text-portal-secondary">Activate the saved policy in Settings before forwarding. Every loan requires two CRECOM members, one CRECOM chairperson and one BOD chairperson before Super Admin&apos;s final decision.</p>}
  {canManage&&<div className="flex flex-wrap gap-2">
   {!current.length&&<Button variant="primary" disabled={!data.verified||!data.rules} onClick={()=>setAction({operation:"forward",stage:"CRECOM"})}>Forward to CRECOM</Button>}
   {data.verificationStage==="ready_for_bod"&&<Button variant="primary" onClick={()=>setAction({operation:"forward_bod",stage:"BOD"})}>Assign BOD reviewers</Button>}
   {current.length>0&&<Button onClick={()=>setAction({operation:"reopen"})}>Return to verification</Button>}
  </div>}
  {data.canFinalize&&<Button variant="primary" onClick={()=>setAction({operation:"finalize"})}>Record final decision</Button>}
  {data.finalDecision&&<div className="space-y-2 rounded-lg border border-portal-border p-3 text-support"><StatusBadge status={data.finalDecision.decision==="approve"?"approved":"rejected"} /><p>{data.finalDecision.actor} · {committeeDate(data.finalDecision.createdAt)}</p>{data.finalDecision.decision==="reject"&&<p className="whitespace-pre-wrap break-words text-portal-secondary">{data.finalDecision.reason}</p>}</div>}
  {!data.verified&&!current.length&&data.blockers.length>0&&<div><p className="text-support font-medium">Needed before forwarding</p><ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-portal-secondary">{data.blockers.map(item=><li key={item}>{displayVerificationBlocker(item)}</li>)}</ul></div>}
  {data.cycles.map(cycle=><section key={cycle.id} className="overflow-hidden rounded-lg border border-portal-border">
   <div className="flex flex-wrap justify-between gap-2 bg-surface-muted p-3 text-support"><h4 className="font-semibold">{cycle.stage} · Cycle {cycle.cycle} · Packet v{cycle.packetVersion}</h4><span className="capitalize">{cycle.status}{cycle.outcome?" · "+cycle.outcome:""}</span></div>
   <p className="px-3 py-2 text-caption text-portal-secondary">{cycle.requiredApprovals} approvals required from {cycle.reviewerTarget} reviewers. All assigned reviewers must respond.{cycle.bodRequired?" BOD review required.":""}{cycle.routingReason?" Routing: "+cycle.routingReason:""}</p>
   <DataTable density="compact" label={cycle.stage+" reviewer progress"} className="min-w-[620px]"><thead><tr><th className="text-left">Reviewer</th><th className="text-left">State</th><th className="text-left">Decision / recorded</th><th className="text-left">Reason</th><th className="text-center">Actions</th></tr></thead><tbody>{cycle.assignments.map(assignment=><tr key={assignment.id}>
    <td>{assignment.name}<p className="mt-0.5 text-caption text-portal-secondary">{assignment.signatoryRole?signatoryPositionLabel(assignment.signatoryRole,assignment.committeeMemberNumber):"Position not recorded"}</p></td><td className="capitalize">{assignment.state.replaceAll("_"," ")}</td><td>{assignment.decision??"Pending"}{assignment.decidedAt&&<p className="mt-0.5 text-caption text-portal-secondary">{committeeDate(assignment.decidedAt)}</p>}</td><td className="max-w-64 whitespace-pre-wrap break-words">{assignment.reason||"—"}</td><td className="text-center">
     {assignment.confirmationReference&&<Button size="compact" onClick={()=>setConfirmation({assignment,packetVersion:cycle.packetVersion,cycle:cycle.cycle})}>View confirmation</Button>}
     {canManage&&cycle.status==="open"&&!["decision_recorded","reassigned","cancelled"].includes(assignment.state)&&<div className="flex flex-wrap justify-center gap-1">
      {assignment.state==="awaiting_clarification"&&<Button size="compact" disabled={!data.verified} onClick={()=>setAction({operation:"reply",assignment,stage:cycle.stage})}>Answer</Button>}
      <Button size="compact" onClick={()=>setAction({operation:"reassign",assignment,stage:cycle.stage})}>Reassign</Button>
     </div>}
    </td>
   </tr>)}</tbody></DataTable>
  </section>)}
  {data.events.length>0&&<section><h4 className="mb-2 text-support font-semibold">Review activity</h4><ol className="space-y-2">{data.events.map(event=><li key={event.id} className="rounded-lg border border-portal-border p-3 text-caption"><p className="font-semibold capitalize">{event.action.replaceAll("_"," ")} · {event.actor} · {committeeDate(event.createdAt)}</p>{event.reason&&<p className="mt-1 whitespace-pre-wrap break-words text-portal-secondary">{event.reason}</p>}</li>)}</ol></section>}
  {action&&<ReviewActionDialog key={action.operation+":"+action.assignment?.id} data={data} action={action} onClose={()=>setAction(null)} onSaved={async()=>{setAction(null);setNotice("Review action recorded.");onUpdated();await refresh();}} />}
  {confirmation&&<ActionDialog title="Recorded committee confirmation" subtitle={data.applicationId+" · Cycle "+confirmation.cycle+" · Packet v"+confirmation.packetVersion} onClose={()=>setConfirmation(null)} className="max-w-xl" overlayClassName="z-[160]" footer={<Button onClick={()=>setConfirmation(null)}>Close</Button>}>
   <dl className="grid gap-3 text-support sm:grid-cols-2"><div><dt className="text-caption text-portal-secondary">Reviewer at confirmation</dt><dd className="font-semibold">{confirmation.assignment.name}</dd></div><div><dt className="text-caption text-portal-secondary">Approval position</dt><dd>{confirmation.assignment.signatoryRole?signatoryPositionLabel(confirmation.assignment.signatoryRole,confirmation.assignment.committeeMemberNumber):"Not recorded"}</dd></div><div><dt className="text-caption text-portal-secondary">Decision</dt><dd className="capitalize">{confirmation.assignment.decision}</dd></div><div><dt className="text-caption text-portal-secondary">Recorded · Philippine time</dt><dd>{committeeDate(confirmation.assignment.decidedAt)}</dd></div></dl>
   <p className="mt-4 text-support">{confirmation.assignment.confirmationText}</p>{confirmation.assignment.reason&&<p className="mt-2 whitespace-pre-wrap break-words text-support text-portal-secondary">{confirmation.assignment.reason}</p>}
   <p className="mt-3 text-caption text-portal-secondary">{confirmation.assignment.confirmationMethod==="account_password"?"Confirmed using the reviewer's personal account password.":"Confirmation method not recorded."} This recorded confirmation cannot be edited.</p><p className="mt-2 break-all text-caption text-portal-secondary">Reference: {confirmation.assignment.confirmationReference}</p>
  </ActionDialog>}
 </section>;
}
export function ReviewActionDialog({data,action,onClose,onSaved}:{data:AdminReviewState;action:Action;onClose:()=>void;onSaved:()=>Promise<void>}){
 const forwarding=action.operation==="forward"||action.operation==="forward_bod",targetRole=action.stage==="BOD"?"bod_member":"crecom_member";
 const [selected,setSelected]=useState<string[]>([]),[due,setDue]=useState(""),[reason,setReason]=useState(""),[replacement,setReplacement]=useState(""),[decision,setDecision]=useState(data.cycles.some(cycle=>cycle.status!=="superseded"&&cycle.outcome==="reject")?"reject":"approve");
 const [password,setPassword]=useState(""),[success,setSuccess]=useState(false);
 const [review,setReview]=useState(false),[submitted,setSubmitted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),pending=useRef(false),request=useRef(crypto.randomUUID());
 const required=action.stage==="BOD"?data.rules?.bodReviewers:data.policyConfig?.reviewerCount;
 const activeCycle=data.cycles.find(item=>item.status!=="superseded"&&item.stage===action.stage);
 const eligible=data.candidates.filter(item=>item.role===targetRole&&(targetRole!=="bod_member"||item.committeeSeat==="chairperson")&&(action.operation!=="reassign"||((item.committeeSeat==="chairperson")===action.assignment?.signatoryRole?.endsWith("chairperson")&&(!action.assignment?.committeeMemberNumber||item.committeeMemberNumber===action.assignment.committeeMemberNumber)&&!activeCycle?.assignments.some(assignment=>assignment.membershipId===item.id))));
 const labels={forward:"Send to CRECOM",forward_bod:"Send to BOD",reply:"Answer reviewer clarification",reassign:"Reassign reviewer",reopen:"Restart requirements check",finalize:"Record final decision"};
 const prepare=()=>{
  setError("");
  if(forwarding&&(selected.length!==required||!required)){setError("Choose exactly "+required+" eligible reviewers.");return;}
  if(action.operation==="forward"&&(eligible.filter(item=>selected.includes(item.id)&&item.committeeSeat==="member").length!==2||eligible.filter(item=>selected.includes(item.id)&&item.committeeSeat==="chairperson").length!==1)){setError("Choose exactly two CRECOM members and one CRECOM chairperson.");return;}
  if(action.operation==="forward"&&new Set(eligible.filter(item=>selected.includes(item.id)&&item.committeeSeat==="member").map(item=>item.committeeMemberNumber).filter(Boolean)).size!==2){setError("Choose CRECOM Member 1, CRECOM Member 2 and the CRECOM Chairperson. Set missing positions in Committee Accounts first.");return;}
  if(!forwarding&&(action.operation!=="finalize"||decision==="reject")&&!reason.trim()){setError("Enter a reason or clarification.");return;}
  if(action.operation==="reassign"&&!replacement){setError("Choose an eligible replacement reviewer.");return;}
  if(due&&Date.parse(due+"T23:59:59+08:00")<=Date.now()){setError("Choose a future deadline.");return;}
  setReview(true);
 };
 const save=async()=>{
  if(pending.current)return;
  if(action.operation==="finalize"&&decision==="reject"&&!reason.trim()){setError("Enter a rejection reason.");return;}
  if(!password){setError("Enter your account password.");return;}
  const payload=forwarding?{reviewers:selected,dueAt:due?due+"T23:59:59+08:00":null,...(action.operation==="forward"?{bodRequired:true,routingReason:"BOD chairperson confirmation required for every loan."}:{})}:
   {reason:action.operation==="finalize"&&decision==="approve"?(reason.trim()||"Approved"):reason.trim(),...(action.assignment?{assignmentId:action.assignment.id}:{}),...(action.operation==="reassign"?{membershipId:replacement}:{}),...(action.operation==="finalize"?{decision}:{})};
  pending.current=true;setSubmitted(true);setBusy(true);setError("");
  try{
   const reject=action.operation==="finalize"&&decision==="reject";
   await (reject?workflowRequest:reviewRequest)("",{method:"POST",body:JSON.stringify({operation:reject?"reject_application":action.operation,applicationId:data.applicationId,revision:data.revision,stateHash:data.stateHash,payload,requestId:request.current,password})});
   setSuccess(true);
  }catch(error){setError(error instanceof Error?error.message:"The review action failed. Refresh and retry.");}
  finally{pending.current=false;setBusy(false);setPassword("");}
 };
 if(success)return <ActionResultDialog success title={action.operation==="finalize"?"Final decision recorded":"Review action recorded"} message={`${labels[action.operation]} was recorded for ${data.applicationId}.`} overlayClassName="z-[160]" onClose={()=>{void onSaved();}}/>;
 const failedRequiredPanel=data.cycles.some(item=>item.status!=="superseded"&&item.outcome==="reject");
 return <ActionDialog title={labels[action.operation]} subtitle={data.applicationId} onClose={onClose} busy={busy} className="max-w-xl" overlayClassName="z-[160]" footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button>{action.operation==="finalize"?<Button variant="primary" disabled={busy||!password||(decision==="reject"&&!reason.trim())} loading={busy} onClick={()=>void save()}>Confirm Final Decision</Button>:review?<Button variant="primary" loading={busy} onClick={()=>void save()}>Confirm review action</Button>:<Button variant="primary" onClick={prepare}>Review action</Button>}</>}>
  <div className="space-y-4 text-support">
   {!review?<>
    {forwarding&&<><p>{action.stage==="CRECOM"?"Select two CRECOM members and one CRECOM chairperson.":"Select one BOD chairperson."} Their confirmations will refer to this verified packet.</p><div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-portal-border p-3">{eligible.length?eligible.map(item=><label key={item.id} className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(item.id)} disabled={selected.length===(required??0)&&!selected.includes(item.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))} /><span>{item.name}<span className="ml-1 text-caption text-portal-secondary">· {committeePositionLabel(item.role,item.committeeSeat,item.committeeMemberNumber)}</span></span></label>):<p className="text-portal-secondary">No eligible reviewers. Invite and complete their account setup in Committee Accounts first.</p>}</div>
     <CommitteeField label="Review deadline (optional)"><Input type="date" value={due} onChange={event=>setDue(event.target.value)} /></CommitteeField>
     {action.operation==="forward"&&<p className="text-caption text-portal-secondary">After all three CRECOM approvals, the active BOD chairperson receives the application automatically. If an appointment needs selection, staff can assign the chairperson. BOD confirmation is required for every loan.</p>}
    </>}
    {action.operation==="reassign"&&<CommitteeField label="Replacement reviewer"><Select value={replacement} onChange={event=>setReplacement(event.target.value)}><option value="">Choose the same approval position</option>{eligible.map(item=><option key={item.id} value={item.id}>{item.name} · {committeePositionLabel(item.role,item.committeeSeat,item.committeeMemberNumber)}</option>)}</Select></CommitteeField>}
    {action.operation==="finalize"&&<CommitteeField label="Final decision"><Select value={decision} onChange={event=>{setDecision(event.target.value);if(event.target.value==="approve")setReason("");}}><option value="reject">Reject application</option><option value="approve" disabled={failedRequiredPanel}>Approve application{failedRequiredPanel?" (required panel did not approve)":""}</option></Select></CommitteeField>}
    {!forwarding&&(action.operation!=="finalize"||decision==="reject")&&<CommitteeField label={action.operation==="reply"?"Clarification provided":"Reason"}><Textarea maxLength={2000} rows={3} value={reason} onChange={event=>setReason(event.target.value)} /></CommitteeField>}
    {action.operation==="finalize"&&<CommitteeField label="Your account password"><PasswordInput label="Your account password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></CommitteeField>}
    {action.operation==="reopen"&&<p className="text-caption text-portal-secondary">Existing decisions stay in history. Current assignments close. Verification will use the current approved policy, and a new verified packet and review cycle will be required.</p>}
   </>:<>
    <p className="font-semibold">{labels[action.operation]} · {data.applicationId}</p>
    {forwarding&&<><ul className="list-disc space-y-1 pl-5">{eligible.filter(item=>selected.includes(item.id)).map(item=><li key={item.id}>{item.name} · {committeePositionLabel(item.role,item.committeeSeat,item.committeeMemberNumber)}</li>)}</ul><p>Deadline: {due||"Not set"}{action.operation==="forward"?" · BOD chairperson: Required":""}</p></>}
    {action.assignment&&<p>Reviewer: {action.assignment.name}{replacement?" → "+eligible.find(item=>item.id===replacement)?.name:""}</p>}
    {action.operation==="finalize"&&<p className="font-semibold capitalize">Final decision: {decision}</p>}
    {reason&&<p className="whitespace-pre-wrap break-words">{reason}</p>}
    {<CommitteeField label="Your account password"><PasswordInput label="Your account password"  autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={busy} /></CommitteeField>}
    {!submitted&&!busy&&<Button size="compact" onClick={()=>setReview(false)}>Back to details</Button>}
   </>}
   {error&&<p role="alert" className="text-status-danger">{error}</p>}
  </div>
 </ActionDialog>;
}
