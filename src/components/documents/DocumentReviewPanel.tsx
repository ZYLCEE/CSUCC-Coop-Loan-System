"use client";

import PasswordInput from "@/components/ui/PasswordInput";
import {ConfirmActionDialog} from "@/components/ui/ConfirmActionDialog";
import {ActionResultDialog} from "@/components/ui/ActionResultDialog";
import { useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, FileCheck2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Fields";
import { documentApplicationSummary, documentKindLabels, latestFileReview, latestFileVersion, type DocumentApplication, type FileReviewStatus } from "@/lib/documentWorkspace";
import { documentsRequest } from "@/lib/documentWorkspaceRequest";
import { getLoanTypeLabel } from "@/lib/loanTypeLabel";
import DocumentStatusBadge from "./DocumentStatusBadge";
import DocumentFilePreview from "./DocumentFilePreview";
import { documentDate, documentSize } from "./documentPresentation";

export default function DocumentReviewPanel({application,canReview,onBack,onUpdated}:{application:DocumentApplication;canReview:boolean;onBack:()=>void;onUpdated:()=>Promise<void>}) {
  const [selectedId,setSelectedId]=useState(application.documents[0]?.id ?? "");
  const [versionNumber,setVersionNumber]=useState<number|null>(null);
  const [replacing,setReplacing]=useState(false);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const pending=useRef(false);
  const [confirm,setConfirm]=useState<"verified"|"needs_replacement"|null>(null),[password,setPassword]=useState(""),[success,setSuccess]=useState("");
  const document=application.documents.find(item=>item.id===selectedId) ?? application.documents[0];
  const latest=document ? latestFileVersion(document) : null;
  const version=document?.versions.find(item=>item.version===versionNumber) ?? latest;
  const review=document && version ? latestFileReview(document,version.id) : null;
  const summary=documentApplicationSummary(application);
  const kinds=Array.from(new Set([...(application.requiredKinds ?? []),...application.documents.map(item=>item.kind)]));
  const current=!!latest && version?.version===latest.version;
  const canReplace=["pending","under review"].includes(application.loanStatus);
  const save=async(status:Exclude<FileReviewStatus,"to_review">)=>{
    if(pending.current || !document || !version || !current || !canReview || !password)return;
    if(status==="needs_replacement" && !reason.trim()){setError("Enter a replacement reason for the member.");return;}
    pending.current=true;setBusy(true);setError("");setNotice("");
    try {
      await documentsRequest("",{method:"POST",body:JSON.stringify({operation:"review",documentId:document.id,versionId:version.id,expectedReviewId:review?.id ?? null,status,reason,password})});
      await onUpdated();setConfirm(null);setPassword("");setSuccess(status==="verified"?"Document verified.":"Document replacement request recorded.");setReplacing(false);setReason("");setNotice(status==="verified" ? "Document verified. The decision and reviewer were recorded." : "Replacement requested. The reason and reviewer were recorded.");
    } catch(error){setError(error instanceof Error ? error.message : "The review could not be saved.");}
    finally{pending.current=false;setBusy(false);}
  };
  return <div className="space-y-4 p-4 sm:p-6">
    {confirm&&<ConfirmActionDialog title={confirm==="verified"?"Verify Document":"Request Replacement"} question={confirm==="verified"?"Confirm that this document meets the requirements.":`Request a replacement? Reason: ${reason.trim()}`} confirmLabel={confirm==="verified"?"Confirm Verification":"Confirm Replacement"} disabled={!password} busy={busy} error={error} onClose={()=>{setConfirm(null);setPassword("");}} onConfirm={()=>save(confirm)}><label className="block space-y-2">Your account password<PasswordInput label="Your account password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label></ConfirmActionDialog>}
    {success&&<ActionResultDialog success message={success} onClose={()=>setSuccess("")}/>}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><Button variant="ghost" size="compact" disabled={busy} onClick={onBack} className="mb-2 -ml-2"><ArrowLeft className="h-4 w-4" />Back to member documents</Button>
        <h2 className="text-section-title">{application.memberName}</h2>
        <p className="mt-1 text-support text-portal-secondary">{application.memberNumber} · {getLoanTypeLabel(application.loanType)} · {application.applicationId}</p>
      </div>
      <div><DocumentStatusBadge status={summary.status} /><p className="mt-2 text-caption text-portal-secondary">{application.documents.length} uploaded · {application.requiredKinds?.length ?? "Unknown"} required · {summary.verified} verified</p></div>
    </div>
    {error && <p role="alert" className="text-support text-status-danger">{error} <Button size="compact" disabled={busy} onClick={()=>void onUpdated()}><RefreshCw className="h-4 w-4" />Refresh documents</Button></p>}
    {notice && <p role="status" className="text-support text-status-success">{notice}</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.6fr)]">
      <div className="space-y-2" aria-label="Application document checklist">
        <h3 className="mb-3 text-label font-semibold">Document checklist</h3>
        {application.requiredKinds===null && <p className="text-support text-status-warning">Requirements could not be loaded. Refresh the current loan policy before confirming completeness.</p>}
        {kinds.map(kind=>{
          const item=application.documents.find(entry=>entry.kind===kind), active=item?.id===document?.id;
          return <button key={kind} type="button" disabled={!item || busy} aria-pressed={active}
            onClick={()=>{if(item){setSelectedId(item.id);setVersionNumber(null);setReplacing(false);setReason("");setError("");setNotice("");}}}
            className={"w-full rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-65 " + (active ? "border-coop-dashboard-green bg-surface-muted" : "border-portal-border bg-surface-card")}>
            <span className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-body font-semibold">{documentKindLabels[kind]}</span><DocumentStatusBadge status={item ? latestFileReview(item)?.status ?? "to_review" : "missing"} /></span>
            <span className="block break-all text-caption text-portal-secondary">{item ? latestFileVersion(item).name : "This required file has not been uploaded."}</span>
            {application.requiredKinds && !application.requiredKinds.includes(kind) && <span className="mt-1 block text-caption text-portal-secondary">Optional supporting document</span>}
          </button>;
        })}
        {!kinds.length && <p className="text-support text-portal-secondary">No document files are available for this application.</p>}
      </div>
      <div className="min-w-0 space-y-4">
        {document && version ? <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-label font-semibold"><FileCheck2 className="h-4 w-4" aria-hidden="true" />{documentKindLabels[document.kind]}</h3>
            <div className="flex flex-wrap items-center gap-2"><DocumentStatusBadge status={review?.status ?? "to_review"} />
              {document.versions.length>1 && <Select aria-label="File version" size="compact" value={version.version} disabled={busy} onChange={event=>{setVersionNumber(Number(event.target.value));setReplacing(false);setReason("");setError("");}}>
                {[...document.versions].sort((a,b)=>b.version-a.version).map(item=><option key={item.version} value={item.version}>Version {item.version}{item.version===latest?.version ? " (latest)" : ""}</option>)}
              </Select>}
            </div>
          </div>
          <DocumentFilePreview key={document.id+":"+version.version} kind="member" id={document.id} versionId={version.id} />
          <dl className="grid gap-x-5 gap-y-3 text-support sm:grid-cols-2">
            <div><dt className="text-caption text-portal-secondary">Document owner</dt><dd className="mt-1">{application.memberName}</dd></div>
            <div><dt className="text-caption text-portal-secondary">Uploaded by</dt><dd className="mt-1">{version.uploadedBy}</dd></div>
            <div><dt className="text-caption text-portal-secondary">Uploaded</dt><dd className="mt-1">{documentDate(version.uploadedAt,true)}</dd></div>
            <div><dt className="text-caption text-portal-secondary">File / version</dt><dd className="mt-1">{documentSize(version.size)} · Version {version.version}</dd></div>
          </dl>
          {review?.reason && <p className="text-support"><span className="font-semibold">Replacement reason: </span>{review.reason}</p>}
          {!current && <p className="text-support text-status-warning">You are viewing an earlier version. Review decisions can be made on the latest version.</p>}
          {canReview ? <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || !current || review?.status==="verified"} onClick={()=>{setConfirm("verified");setPassword("");}}><CheckCircle2 className="h-4 w-4" />Verify Document</Button>
            <Button disabled={busy || !current || !canReplace} onClick={()=>{setReplacing(true);setError("");setNotice("");}}>Request Replacement</Button>
            <Button variant="ghost" disabled={busy} onClick={onBack}>Done</Button>
          </div> : <p className="text-support text-portal-secondary">Document review permission is required to save verification decisions.</p>}
          {canReview && !canReplace && <p className="text-caption text-portal-secondary">Replacement requests are available while the loan application is Pending or Under Review.</p>}
          {replacing && <div className="space-y-3 rounded-xl border border-portal-border p-3">
            <label htmlFor="document-replacement-reason" className="block text-label">Reason shown to the member <span className="text-status-danger">*</span></label>
            <Textarea id="document-replacement-reason" rows={3} maxLength={2000} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain what is missing, unreadable or incorrect." />
            <Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={()=>{setConfirm("needs_replacement");setPassword("");}}>Continue</Button>
          </div>}
          <section className="border-t border-portal-border pt-4" aria-label="File and review history">
            <h3 className="text-label font-semibold">File and review history</h3>
            <ul className="mt-3 space-y-2 text-caption text-portal-secondary">
              {[...document.versions.map(item=>({id:"upload-"+item.version,time:item.uploadedAt,label:"Version "+item.version+" uploaded by "+item.uploadedBy,reason:null as string|null})),
                ...document.reviews.map(item=>({id:item.id,time:item.createdAt,label:(item.status==="verified" ? "Verified" : "Replacement requested")+" by "+item.reviewer,reason:item.reason}))]
                .sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)).map(event=><li key={event.id}><span className="font-medium">{event.label}</span> · {documentDate(event.time,true)}{event.reason && <p className="mt-1 whitespace-pre-wrap text-portal-primary">{event.reason}</p>}</li>)}
            </ul>
          </section>
        </> : <div className="rounded-xl border border-portal-border p-8 text-center text-support text-portal-secondary">The member has not uploaded any files for this application.</div>}
      </div>
    </div>
  </div>;
}
