"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/Feedback";
import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { documentsRequest } from "@/lib/documentWorkspaceRequest";

type FileLink = {url:string;contentType:string;name:string;expiresAt:string};
export default function DocumentFilePreview({kind,id,versionId = null}:{kind:"member"|"shared"|"legacy";id:string;versionId?:string|null}) {
  const [link,setLink] = useState<FileLink|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  const [expired,setExpired] = useState(false);
  const [imageFailed,setImageFailed] = useState(false);
  useEffect(() => {
    let active=true;
    const query=new URLSearchParams({operation:"file",kind,id});
    if(versionId)query.set("versionId",versionId);
    void documentsRequest<FileLink>(query.toString()).then(result=>{if(active){setLink(result);setError("");}})
      .catch(error=>{if(active)setError(error instanceof Error ? error.message : "The file preview is unavailable.");})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[kind,id,versionId,attempt]);
  useEffect(()=>{
    if(!link)return;
    const timeout=setTimeout(()=>setExpired(true),Math.max(0,Date.parse(link.expiresAt)-Date.now()));
    return()=>clearTimeout(timeout);
  },[link]);
  const refresh=()=>{setLoading(true);setError("");setExpired(false);setImageFailed(false);setAttempt(value=>value+1);};
  if(loading)return <div className="rounded-xl border border-portal-border"><LoadingState label="Loading document preview…" /></div>;
  if(error || expired)return <div className="rounded-xl border border-portal-border bg-surface-muted p-6 text-center">
    <p role={error ? "alert" : "status"} className="mb-3 text-support text-portal-secondary">{expired ? "This document link expired. Refresh it to continue reviewing." : error}</p>
    <Button onClick={refresh}><RefreshCw className="h-4 w-4" />Refresh file</Button>
  </div>;
  if(!link)return null;
  const image=["image/jpeg","image/png","image/webp"].includes(link.contentType);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 break-all text-support font-medium">{link.name}</span>
      <div className="flex flex-wrap gap-2">
        <Button size="compact" onClick={refresh} aria-label="Refresh file link"><RefreshCw className="h-4 w-4" /></Button>
        <a href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={actionButtonStyles()}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" />Open original
        </a>
      </div>
    </div>
    {image && !imageFailed ? <div className="flex min-h-52 items-center justify-center rounded-xl border border-portal-border bg-surface-muted p-2">
      {/* Private, expiring URLs are displayed directly instead of being cached by an image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={link.url} alt={"Preview of " + link.name} className="max-h-[420px] max-w-full object-contain" referrerPolicy="no-referrer" onError={()=>setImageFailed(true)} />
    </div> : link.contentType === "application/pdf" ? <iframe src={link.url} title={"Preview of " + link.name} className="h-[360px] w-full rounded-xl border border-portal-border bg-surface-muted" referrerPolicy="no-referrer" />
      : <div className="rounded-xl border border-portal-border bg-surface-muted px-4 py-10 text-center text-support text-portal-secondary">
        <FileText className="mx-auto mb-3 h-7 w-7" aria-hidden="true" />
        {imageFailed ? "The image preview could not be loaded." : "This file format opens in its original viewer."} Use Open original to view or download it.
      </div>}
  </div>;
}
