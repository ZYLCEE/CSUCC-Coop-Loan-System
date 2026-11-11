"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileUp, Search, X } from "lucide-react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Fields";
import { ActionSummary } from "@/components/ui/ConfirmActionDialog";
import { documentsRequest } from "@/lib/documentWorkspaceRequest";
import { validateSharing, type DocumentRecipient, type SharedDocument } from "@/lib/documentWorkspace";
import { documentSize } from "./documentPresentation";

export default function SharedDocumentUploadDialog({draft,onClose,onSaved}:{draft?:SharedDocument;onClose:()=>void;onSaved:(published:boolean)=>Promise<void>}) {
  const [title,setTitle]=useState(draft?.title ?? "");
  const [category,setCategory]=useState(draft?.category ?? "Forms");
  const [description,setDescription]=useState(draft?.description ?? "");
  const [audience,setAudience]=useState<"all"|"selected">(draft?.audience==="selected" ? "selected" : "all");
  const [recipients,setRecipients]=useState<DocumentRecipient[]>(draft?.recipients ?? []);
  const [search,setSearch]=useState("");
  const [results,setResults]=useState<DocumentRecipient[]>([]);
  const [searching,setSearching]=useState(false);
  const [searchError,setSearchError]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const pending=useRef(false);
  const request=useRef<{key:string;id:string}|null>(null);
  useEffect(()=>{
    if(search.trim().length<2)return;
    let active=true;
    const timeout=setTimeout(()=>{
      setSearching(true);
      void documentsRequest<DocumentRecipient[]>(new URLSearchParams({operation:"recipients",search:search.trim()}).toString())
        .then(people=>{if(active){setResults(people);setSearchError("");}})
        .catch(error=>{if(active){setResults([]);setSearchError(error instanceof Error ? error.message : "Member search is unavailable.");}})
        .finally(()=>{if(active)setSearching(false);});
    },250);
    return()=>{active=false;clearTimeout(timeout);};
  },[search]);
  const ready=!!title.trim() && !!(file || draft) && (audience==="all" || recipients.length>0);
  const originalRecipients=draft?.recipients.map(item=>item.id).sort().join(",") ?? "";
  const dirty=draft ? audience!==draft.audience || recipients.map(item=>item.id).sort().join(",")!==originalRecipients
    : !!title || !!description || !!file || recipients.length>0;
  const prepare=(event:FormEvent)=>{
    event.preventDefault();setError("");
    try {
      validateSharing({title,category,description,audience,recipientIds:recipients.map(item=>item.id),publish:true});
      if(!file && !draft)throw new Error("Choose a document file.");
      setConfirm(true);
    }catch(error){setError(error instanceof Error ? error.message : "Check the document details.");}
  };
  const submit=async(publish:boolean)=>{
    if(pending.current)return;
    setError("");
    try {
      const sharing=validateSharing({title,category,description,audience,recipientIds:recipients.map(item=>item.id),publish});
      if(!draft && !file)throw new Error("Choose a document file.");
      pending.current=true;setBusy(true);
      if(draft) {
        await documentsRequest("",{method:"POST",body:JSON.stringify({...sharing,operation:"publish",id:draft.id,updatedAt:draft.updatedAt})});
      }else if(file){
        const key=JSON.stringify({...sharing,name:file.name,size:file.size,lastModified:file.lastModified});
        if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
        const form=new FormData();form.set("file",file);form.set("metadata",JSON.stringify({...sharing,id:request.current.id}));
        await documentsRequest("",{method:"POST",body:form});
      }
      await onSaved(publish);onClose();
    }catch(error){setError(error instanceof Error ? error.message : "The document could not be saved. Retry.");}
    finally{pending.current=false;setBusy(false);}
  };
  return <FormDialog title={draft ? "Publish shared document" : "Upload shared document"} icon={FileUp} className="max-w-[760px]"
    dirty={dirty} busy={busy} onClose={onClose} footer={confirm ? <>
      <Button disabled={busy} onClick={()=>{setConfirm(false);setError("");}}>Back</Button>
      <Button variant="primary" loading={busy} onClick={()=>void submit(true)}>Publish document</Button>
    </> : <>
      <Button data-dialog-close disabled={busy}>Cancel</Button>
      {!draft && <Button disabled={busy || !title.trim() || !file} onClick={()=>void submit(false)}>Save draft</Button>}
      <Button variant="primary" type="submit" form="shared-document-form" disabled={!ready || busy}>Review sharing</Button>
    </>}>
    {confirm ? <div className="space-y-4">
      <p className="text-body">Review the document and its recipients before making it available in the member app.</p>
      <ActionSummary details={[
        {label:"Document",value:title.trim()},{label:"File",value:file?.name ?? draft?.filename ?? ""},
        {label:"Category",value:category},{label:"Audience",value:audience==="all" ? "All members" : "Selected members"},
      ]} />
      {audience==="selected" && <div><h3 className="mb-2 text-label font-semibold">Selected recipients ({recipients.length})</h3>
        <ul className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-portal-border p-3 text-support">
          {recipients.map(person=><li key={person.id}>{person.name}<span className="ml-2 text-caption text-portal-secondary">{person.memberNumber}</span></li>)}
        </ul><p className="mt-2 text-caption text-portal-secondary">Only selected recipients and authorized staff can access this document.</p>
      </div>}
    </div> : <form id="shared-document-form" onSubmit={prepare} className="space-y-4">
      {draft ? <ActionSummary details={[{label:"Document",value:draft.title},{label:"File",value:draft.filename},{label:"Category",value:draft.category}]} />
        : <>
          <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
            <label className="space-y-1.5 text-label">Document title <span className="text-status-danger">*</span>
              <Input className="w-full" required maxLength={160} disabled={busy} value={title} onChange={event=>setTitle(event.target.value)} placeholder="e.g. Membership application form" /></label>
            <label className="space-y-1.5 text-label">Category
              <Select className="w-full" disabled={busy} value={category} onChange={event=>setCategory(event.target.value)}>
                {["Forms","Guides","Checklists","Other"].map(value=><option key={value}>{value}</option>)}
              </Select></label>
          </div>
          <label className="block space-y-1.5 text-label">Description (optional)<Textarea className="w-full" rows={2} maxLength={2000} disabled={busy} value={description} onChange={event=>setDescription(event.target.value)} /></label>
        </>}
      <fieldset disabled={busy}>
        <legend className="mb-2 text-label">Who can see this document?</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-body">
          <label className="flex items-center gap-2"><input type="radio" name="shared-document-audience" value="all" checked={audience==="all"} onChange={()=>setAudience("all")} className="accent-coop-dashboard-green" />All members</label>
          <label className="flex items-center gap-2"><input type="radio" name="shared-document-audience" value="selected" checked={audience==="selected"} onChange={()=>setAudience("selected")} className="accent-coop-dashboard-green" />Selected members</label>
        </div>
      </fieldset>
      {audience==="selected" && <div className="space-y-3">
        <label className="block space-y-1.5 text-label">Find a member by name or ID
          <Input leadingIcon={<Search className="h-4 w-4" />} wrapperClassName="w-full" className="w-full" value={search} disabled={busy || recipients.length>=100}
            onChange={event=>{setSearch(event.target.value);setResults([]);setSearchError("");}} placeholder="Type at least 2 characters" autoComplete="off" /></label>
        {search.trim().length>=2 && <div className="max-h-44 overflow-y-auto rounded-xl border border-portal-border p-1">
          {searching ? <p role="status" className="p-2 text-support text-portal-secondary">Finding members…</p>
            : searchError ? <p role="alert" className="p-2 text-support text-status-danger">{searchError}</p>
              : results.filter(person=>!recipients.some(selected=>selected.id===person.id)).map(person=><button type="button" key={person.id} disabled={busy}
                onClick={()=>{setRecipients(items=>[...items,person]);setSearch("");setResults([]);}}
                className="ui-button ui-button--ghost w-full flex-wrap justify-between gap-x-3 text-left text-support">
                <span>{person.name}</span><span className="text-caption text-portal-secondary">{person.memberNumber}</span>
              </button>)}
          {!searching && !searchError && !results.length && <p className="p-2 text-support text-portal-secondary">No active members found.</p>}
        </div>}
        <div className="flex flex-wrap gap-2" aria-label="Selected document recipients">
          {recipients.map(person=><Button key={person.id} size="compact" disabled={busy} aria-label={"Remove "+person.name} onClick={()=>setRecipients(items=>items.filter(item=>item.id!==person.id))}>
            {person.name}<span className="text-caption text-portal-secondary">{person.memberNumber}</span><X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>)}
        </div>
      </div>}
      {!draft && <label className="block space-y-2 text-label">File <span className="text-status-danger">*</span>
        <Input type="file" className="w-full" accept=".pdf,.docx,.png,.jpg,.jpeg" disabled={busy} onChange={event=>{
          const next=event.target.files?.[0] ?? null;setError("");
          if(next && (!/\.(pdf|docx|png|jpe?g)$/i.test(next.name) || next.size>10485760 || !next.size)){setFile(null);setError("Choose a non-empty PDF, DOCX, PNG or JPG file of up to 10 MB.");event.target.value="";return;}
          setFile(next);
        }} />
        {file && <span className="block text-caption text-portal-secondary">{file.name} · {documentSize(file.size)}</span>}
      </label>}
    </form>}
    {error && <p role="alert" className="mt-4 text-support text-status-danger">{error}</p>}
  </FormDialog>;
}
