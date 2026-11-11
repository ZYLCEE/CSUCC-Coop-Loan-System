"use client";

import { Files } from "lucide-react";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { Button } from "@/components/ui/Button";
import type { SharedDocument } from "@/lib/documentWorkspace";
import DocumentFilePreview from "./DocumentFilePreview";
import DocumentStatusBadge from "./DocumentStatusBadge";
import { documentDate, documentSize } from "./documentPresentation";

export default function SharedDocumentDetails({document,onClose,onPublish,onDelete}:{document:SharedDocument;onClose:()=>void;onPublish?:()=>void;onDelete?:()=>void}) {
  return <DetailDialog title="Shared document details" icon={Files} subtitle={document.title} className="max-w-3xl" onClose={onClose}
    footer={<><Button data-dialog-close>Close</Button>{onDelete && <Button variant="destructive" onClick={onDelete}>Delete document</Button>}{onPublish && <Button variant="primary" onClick={onPublish}>Publish document</Button>}</>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-support text-portal-secondary">{document.category}</span><DocumentStatusBadge status={document.status} /></div>
      {document.description && <p className="whitespace-pre-wrap text-body">{document.description}</p>}
      <DocumentFilePreview kind={document.source==="legacy" ? "legacy" : "shared"} id={document.id} />
      <dl className="grid gap-4 text-support sm:grid-cols-2">
        <div><dt className="text-caption text-portal-secondary">Uploaded by</dt><dd className="mt-1">{document.uploadedBy}</dd></div>
        <div><dt className="text-caption text-portal-secondary">Uploaded</dt><dd className="mt-1">{documentDate(document.createdAt,true)}</dd></div>
        <div><dt className="text-caption text-portal-secondary">File size</dt><dd className="mt-1">{documentSize(document.size)}</dd></div>
        <div><dt className="text-caption text-portal-secondary">Audience</dt><dd className="mt-1">{document.audience==="all" ? "All members" : document.audience==="staff" ? "Staff only" : "Selected members"}</dd></div>
      </dl>
      {document.status==="draft" && <p className="text-support text-portal-secondary">This draft is not visible in the member app.</p>}
      {document.audience==="selected" && <section><h3 className="mb-2 text-label font-semibold">Selected recipients ({document.recipients.length})</h3><ul className="space-y-2 text-support">
        {document.recipients.map(person=><li key={person.id}>{person.name}<span className="ml-2 text-caption text-portal-secondary">{person.memberNumber}{!person.active ? " · Inactive" : ""}</span></li>)}
        {!document.recipients.length && <li className="text-portal-secondary">Choose recipients before publishing this draft.</li>}
      </ul></section>}
    </div>
  </DetailDialog>;
}
