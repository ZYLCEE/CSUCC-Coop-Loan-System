"use client";

import { actionButtonStyles } from "@/components/shared/actionButtonStyles";
import { DetailDialog } from "@/components/ui/DetailDialog";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { useEffect, useState } from "react";
import { ExternalLink, Files } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

interface DocumentRow {
  id: string;
  kind: string;
  original_name: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
}
interface DocumentLink extends DocumentRow { url: string; version: number; reviewStatus: string }
const labels: Record<string, string> = {
  payslip: "Pay Slip", validId: "Valid Identification", collateral: "Collateral Document", supporting: "Other Supporting Documents",
};

async function fetchDocuments(applicationId: string): Promise<DocumentLink[]> {
  const client = getSupabaseClient();
  const { data, error } = await client.from("loan_documents")
    .select("id,kind,original_name,storage_path,content_type,size_bytes,loan_applications!inner(application_id)")
    .eq("loan_applications.application_id", applicationId)
    .order("created_at", { ascending: true }).returns<DocumentRow[]>();
  if (error) throw error;
  return Promise.all(data.map(async (document) => {
    const latest = await client.from("loan_document_versions").select("id,version,storage_path,original_name,content_type,size_bytes")
      .eq("document_id",document.id).order("version",{ascending:false}).limit(1).maybeSingle();
    if(latest.error)throw latest.error;
    const versionId=latest.data?.id ?? null;
    let reviewQuery=client.from("loan_document_reviews").select("status").eq("document_id",document.id);
    reviewQuery=versionId ? reviewQuery.eq("version_id",versionId) : reviewQuery.is("version_id",null);
    const review=await reviewQuery.order("created_at",{ascending:false}).order("id",{ascending:false}).limit(1).maybeSingle();
    if(review.error)throw review.error;
    const file={...document,...latest.data,id:document.id};
    const { data: link, error: linkError } = await client.storage.from("loan-documents").createSignedUrl(file.storage_path, 300);
    if (linkError) throw linkError;
    return { ...file, url: link.signedUrl,version:latest.data?.version ?? 1,reviewStatus:review.data?.status ?? "to_review" };
  }));
}

export default function LoanDocumentsModal({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const [documents, setDocuments] = useState<DocumentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchDocuments(applicationId).then((data) => {
      if (active) setDocuments(data);
    }).catch(() => {
      if (active) setError("Unable to load the application documents. Please retry.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [applicationId, attempt]);
  return (
    <DetailDialog icon={Files} title="Application Documents" titleId="loan-documents-title" subtitle={applicationId} closeLabel="Close documents"
      className="max-w-xl" overlayClassName="z-[130]" onClose={onClose} dismissOnBackdrop
      footer={<><button type="button" data-dialog-close className={actionButtonStyles()}>Close</button><button type="button" className={actionButtonStyles()} disabled={loading} onClick={() => { setLoading(true); setError(""); setAttempt((value) => value + 1); }}>Refresh documents</button></>}>
        {loading ? <LoadingState label="Loading documents…" /> : error ? <p role="alert" className="text-body text-status-danger">{error}</p> : documents.length === 0 ? <EmptyState icon={Files} title="No documents attached" description="This application has no stored attachments." /> : (
          <ul className="space-y-3">{documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-portal-control border border-portal-border p-3">
              <div className="min-w-0 flex-1"><p className="text-body font-semibold">{labels[document.kind] ?? document.kind}</p><p className="text-support text-portal-muted [overflow-wrap:anywhere]">{document.original_name}</p><p className="text-caption text-portal-secondary">{(document.size_bytes / 1024).toFixed(1)} KB · Version {document.version} · {document.reviewStatus==="verified" ? "Verified" : document.reviewStatus==="needs_replacement" ? "Needs replacement" : "To review"}</p></div>
              <a href={document.url} target="_blank" rel="noopener noreferrer" className={actionButtonStyles()}>Open <ExternalLink className="size-icon-compact" aria-hidden="true" /></a>
            </li>
          ))}</ul>
        )}
        {documents.length > 0 && !loading && !error && <p className="mt-4 text-caption text-portal-secondary">Document links expire after 5 minutes.</p>}

    </DetailDialog>
  );
}
