"use client";

import {useState} from "react";
import type {AdminReviewState,ReviewAssignment,ReviewCycle} from "@/lib/committeeReview";
import {signatoryPositionLabel} from "@/lib/committee";
import {committeeDate} from "@/lib/committeePresentation";
import {committeeProgress,type ProcessingStep} from "@/lib/applicationProcessing";
import {Button} from "@/components/ui/Button";
import {ActionDialog} from "@/components/ui/ActionDialog";
import {Badge,StatusBadge} from "@/components/ui/StatusBadge";
import type {ReviewAction} from "./CommitteeReviewPanel";
import styles from "./processing.module.css";

export default function ProcessingReviewStep({step,currentStep,data,onAction,archived=false}:{
  step:ProcessingStep;currentStep:ProcessingStep;data:AdminReviewState|null;onAction:(action:ReviewAction)=>void;archived?:boolean;
}) {
  const [confirmation,setConfirmation]=useState<{assignment:ReviewAssignment;packetVersion:number;cycle:number}|null>(null);
  if (!data) return <p className="text-support text-portal-secondary">Committee progress is unavailable. Refresh to try again.</p>;
  const cycles=data.cycles.filter(cycle=>(archived?cycle.status==="superseded":cycle.status!=="superseded") && (step===4 || cycle.stage===(step===2?"CRECOM":"BOD")))
    .sort((a,b)=>a.stage===b.stage?0:a.stage==="CRECOM"?-1:1);
  const canManage=!archived && data.canManage && !data.finalDecision && step===currentStep;
  const progress=step===2||step===3?committeeProgress(data,step===2?"CRECOM":"BOD"):null;
  const crecom=committeeProgress(data,"CRECOM");
  const approvalRows=cycles.flatMap(cycle=>cycle.assignments.filter(item=>!["cancelled","reassigned"].includes(item.state)).map(assignment=>({assignment,cycle})));
  const approvalTable=(rows:{assignment:ReviewAssignment;cycle:ReviewCycle}[])=><div className="overflow-x-auto"><table className={styles.table} aria-label="Committee reviewer decisions"><thead><tr><th>Reviewer</th><th>Position</th><th>Decision</th><th>Recorded · Philippine time</th><th><span className="sr-only">Confirmation</span></th></tr></thead><tbody>{rows.map(({assignment,cycle})=><tr key={assignment.id}>
    <td>{assignment.name}{assignment.reason&&<p className="mt-2 max-w-xs whitespace-pre-wrap text-caption font-normal text-portal-secondary">{assignment.reason}</p>}</td>
    <td>{assignment.signatoryRole?signatoryPositionLabel(assignment.signatoryRole,assignment.committeeMemberNumber):"Assigned reviewer"}</td>
    <td><Badge tone={assignment.decision==="approve"?"success":assignment.decision==="reject"?"danger":"warning"}>{assignment.decision==="approve"?"Approved":assignment.decision==="reject"?"Rejected":assignment.state==="assigned"?"Waiting":assignment.state.replaceAll("_"," ")}</Badge></td>
    <td className="text-caption text-portal-secondary">{assignment.decidedAt?committeeDate(assignment.decidedAt):"—"}</td>
    <td>{assignment.confirmationReference&&<Button size="compact" variant="ghost" onClick={()=>setConfirmation({assignment,packetVersion:cycle.packetVersion,cycle:cycle.cycle})}>View confirmation</Button>}</td>
  </tr>)}</tbody></table></div>;
  return <div className="space-y-4">
    {!archived&&step===3&&crecom.approved&&<details className={styles.summary}><summary className="cursor-pointer text-support font-semibold">CRECOM approved · 3 of 3</summary><ul className="mt-3 space-y-2 text-support">{crecom.assignments.map(item=><li key={item.id}>{item.name} · {item.signatoryRole?signatoryPositionLabel(item.signatoryRole,item.committeeMemberNumber):"Reviewer"} · {committeeDate(item.decidedAt)}</li>)}</ul></details>}
    {!archived&&progress&&step<=currentStep&&<div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-section-title font-semibold">{progress.rejected?"Committee approval blocked":progress.attention?"Reviewer attention needed":progress.approved?(step===2?"CRECOM approved":"BOD approved"):progress.cycle?(step===2?"Waiting for CRECOM approval":"Waiting for BOD approval"):step===2?"Ready to send to CRECOM":"Ready to send to BOD"}</h3><Badge tone={progress.rejected?"danger":progress.approved?"success":"warning"}>{progress.approvedCount} of {progress.required} approved</Badge></div>
      <div role="progressbar" aria-label={step===2?"CRECOM approvals":"BOD approvals"} aria-valuemin={0} aria-valuemax={progress.required} aria-valuenow={Math.min(progress.approvedCount,progress.required)} className={styles.progress}><span style={{width:Math.min(progress.approvedCount/progress.required,1)*100+"%"}} /></div>
      <p className="text-caption text-portal-secondary">{progress.rejected?"Read the rejection reason before returning or deciding this application.":progress.attention?"Resolve the clarification or reviewer replacement before continuing.":progress.approved?step===2?"All two members and the chairperson approved. Continue to BOD.":"The BOD chairperson approved. Continue to the final decision.":progress.cycle?step===2?"Both CRECOM members and the chairperson must approve before BOD review.":"The BOD chairperson's approval is required before the final decision.":step===2?"Assign two CRECOM members and one chairperson when sending the verified application.":"Assign the BOD chairperson when sending this application."}</p>
    </div>}
    {!archived&&step===4&&!data.finalDecision&&<div className="space-y-2"><h3 className="text-section-title font-semibold">{currentStep===4&&data.canFinalize?"Ready for final decision":"Final decision pending"}</h3><p className="text-support text-portal-secondary">Review the loan details and all four committee confirmations before recording the decision.</p></div>}
    {!archived && step===4 && data.finalDecision && <section className="rounded-xl border border-portal-border p-4 text-support" aria-label="Recorded final decision">
      <StatusBadge status={data.finalDecision.decision==="approve"?"approved":"rejected"} />
      <p className="mt-2 font-semibold">{data.finalDecision.actor} · {committeeDate(data.finalDecision.createdAt)}</p>
      <p className="mt-2 whitespace-pre-wrap text-portal-secondary">{data.finalDecision.reason}</p>
    </section>}
    {!cycles.length && <p className="rounded-xl border border-dashed border-portal-border p-5 text-support text-portal-secondary">{step>currentStep
      ? "Finish the current step first. No confirmations have been requested for this step."
      : step===2?"The three CRECOM reviewers will appear here after the application is sent for review."
      :step===3?"The BOD chairperson will appear here after the application is sent to BOD."
      :"No committee confirmations have been recorded for this application."}</p>}
    {step===4&&!archived&&approvalRows.length>0&&<section aria-label="Committee approvals" className="overflow-hidden rounded-xl border border-portal-border"><h3 className="bg-surface-muted px-4 py-3 text-label font-semibold">Committee approvals · {approvalRows.filter(row=>row.assignment.state==="decision_recorded"&&row.assignment.decision==="approve").length} of 4 approved</h3>{approvalTable(approvalRows)}</section>}
    {(step===4&&!archived?[]:cycles).map(cycle=><section key={cycle.id} aria-label={cycle.stage+" confirmations"} className="overflow-hidden rounded-xl border border-portal-border">
      <div className="flex items-center justify-between gap-3 bg-surface-muted px-4 py-3">
        <h3 className="text-label font-semibold">{cycle.stage} confirmations{archived?" · Previous cycle "+cycle.cycle:""}</h3>
        <span className="text-caption text-portal-secondary">{cycle.assignments.filter(item=>item.state==="decision_recorded"&&item.decision==="approve").length} of {cycle.reviewerTarget} approved</span>
      </div>
      <div className="overflow-x-auto"><table className={styles.table} aria-label={cycle.stage+" reviewer decisions"}><thead><tr><th>Reviewer</th><th>Position</th><th>Decision</th><th>Recorded · Philippine time</th><th><span className="sr-only">Confirmation</span></th></tr></thead><tbody>{cycle.assignments.filter(item=>!["cancelled","reassigned"].includes(item.state)).map(assignment=><tr key={assignment.id}>
        <td>{assignment.name}{assignment.reason&&<p className="mt-2 max-w-xs whitespace-pre-wrap text-caption font-normal text-portal-secondary">{assignment.reason}</p>}</td>
        <td>{assignment.signatoryRole?signatoryPositionLabel(assignment.signatoryRole,assignment.committeeMemberNumber):"Assigned reviewer"}</td>
        <td><Badge tone={assignment.decision==="approve"?"success":assignment.decision==="reject"?"danger":"warning"}>{assignment.decision==="approve"?"Approved":assignment.decision==="reject"?"Rejected":assignment.state==="assigned"?"Waiting":assignment.state.replaceAll("_"," ")}</Badge></td>
        <td className="text-caption text-portal-secondary">{assignment.decidedAt?committeeDate(assignment.decidedAt):"—"}</td>
        <td>{assignment.confirmationReference&&<Button size="compact" variant="ghost" onClick={()=>setConfirmation({assignment,packetVersion:cycle.packetVersion,cycle:cycle.cycle})}>View confirmation</Button>}</td>
      </tr>)}</tbody></table></div>
      {canManage && cycle.status==="open" && <details className="border-t border-portal-border px-4 py-3">
        <summary className="cursor-pointer text-caption font-medium text-portal-secondary">Reviewer actions</summary>
        <div className="mt-3 space-y-3">{cycle.assignments.filter(item=>!["decision_recorded","reassigned","cancelled"].includes(item.state)).map(assignment=><div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 text-support">
          <span>{assignment.name}</span><div className="flex gap-2">
            {assignment.state==="awaiting_clarification"&&<Button size="compact" disabled={!data.verified} onClick={()=>onAction({operation:"reply",assignment,stage:cycle.stage})}>Answer clarification</Button>}
            <Button size="compact" onClick={()=>onAction({operation:"reassign",assignment,stage:cycle.stage})}>Reassign reviewer</Button>
          </div>
        </div>)}</div>
      </details>}
    </section>)}
    {confirmation&&<ActionDialog title="Recorded committee confirmation" subtitle={data.applicationId+" · Cycle "+confirmation.cycle+" · Packet v"+confirmation.packetVersion} className="max-w-xl" overlayClassName="z-[160]" onClose={()=>setConfirmation(null)} footer={<Button onClick={()=>setConfirmation(null)}>Close</Button>}>
      <dl className="grid gap-3 text-support sm:grid-cols-2">
        <div><dt className="text-caption text-portal-secondary">Reviewer</dt><dd className="font-semibold">{confirmation.assignment.name}</dd></div>
        <div><dt className="text-caption text-portal-secondary">Position</dt><dd>{confirmation.assignment.signatoryRole?signatoryPositionLabel(confirmation.assignment.signatoryRole,confirmation.assignment.committeeMemberNumber):"Assigned reviewer"}</dd></div>
        <div><dt className="text-caption text-portal-secondary">Decision</dt><dd className="capitalize">{confirmation.assignment.decision}</dd></div>
        <div><dt className="text-caption text-portal-secondary">Recorded · Philippine time</dt><dd>{committeeDate(confirmation.assignment.decidedAt)}</dd></div>
      </dl>
      <p className="mt-4 text-support">{confirmation.assignment.confirmationText}</p>
      {confirmation.assignment.reason&&<p className="mt-2 whitespace-pre-wrap text-support text-portal-secondary">{confirmation.assignment.reason}</p>}
      <p className="mt-3 text-caption text-portal-secondary">{confirmation.assignment.confirmationMethod==="account_password"?"Confirmed using the reviewer's personal account password. ":""}This recorded confirmation cannot be edited.</p>
      <p className="mt-2 break-all text-caption text-portal-secondary">Reference: {confirmation.assignment.confirmationReference}</p>
    </ActionDialog>}
  </div>;
}
