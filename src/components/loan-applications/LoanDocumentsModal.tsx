"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

interface DocumentRow {
  id: string;
  kind: string;
  original_name: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
}
interface DocumentLink extends DocumentRow { url: string }
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
    const { data: link, error: linkError } = await client.storage.from("loan-documents").createSignedUrl(document.storage_path, 300);
    if (linkError) throw linkError;
    return { ...document, url: link.signedUrl };
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
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="loan-documents-title" onClick={(event) => event.stopPropagation()} className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <header className="mb-4 flex items-center justify-between gap-4">
          <div><h2 id="loan-documents-title" className="text-lg font-bold">Application Documents</h2><p className="text-sm text-slate-500">{applicationId}</p></div>
          <button type="button" aria-label="Close documents" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>
        {loading ? <p role="status">Loading documents...</p> : error ? <p role="alert" className="text-red-700">{error}</p> : documents.length === 0 ? <p className="text-slate-500">No documents are attached to this application.</p> : (
          <ul className="space-y-3">{documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3">
              <div className="min-w-0"><p className="font-semibold">{labels[document.kind] ?? document.kind}</p><p className="break-all text-sm text-slate-600">{document.original_name}</p><p className="text-xs text-slate-500">{(document.size_bytes / 1024).toFixed(1)} KB</p></div>
              <a href={document.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#155D3B]">Open <ExternalLink className="h-4 w-4" /></a>
            </li>
          ))}</ul>
        )}
        <p className="mt-4 text-xs text-slate-500">Document links expire after 5 minutes.</p>
        <button type="button" className="mt-3 text-sm font-semibold text-[#155D3B] underline" disabled={loading} onClick={() => { setLoading(true); setError(""); setAttempt((value) => value + 1); }}>Refresh documents</button>
      </section>
    </div>
  );
}
