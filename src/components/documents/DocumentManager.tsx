"use client";

import { useEffect, useRef, useState } from 'react';
import { adminRequest } from '@/lib/adminRequest';
import { useAdminAuth } from '@/components/auth/AdminAuthProvider';

type DocumentRecord = {
  id: string; name: string; size: number | null; createdAt: string;
  url: string | null; linkError: string | null; source: 'loan' | 'cooperative';
  kind: string | null; applicationId: string | null;
};
const labels: Record<string, string> = {
  payslip: 'Pay Slip', validId: 'Valid Identification', collateral: 'Collateral Document', supporting: 'Supporting Document',
};
const pageSize = 20;

export default function DocumentManager() {
  const { role } = useAdminAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const input = useRef<HTMLInputElement>(null);

  const load = async () => {
    setError(''); setBusy(true);
    try { setDocuments(await adminRequest('documents')); }
    catch (error) { setError(error instanceof Error ? error.message : 'Loading failed.'); }
    finally { setBusy(false); setLoaded(true); }
  };
  useEffect(() => {
    let active = true;
    void adminRequest('documents').then(data => { if (active) setDocuments(data); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file);
      await adminRequest('documents', { method: 'POST', body: form }); await load();
    } catch (error) { setError(error instanceof Error ? error.message : 'Upload failed.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Permanently delete this cooperative document?')) return;
    setBusy(true); setError('');
    try { await adminRequest('documents', { method: 'DELETE', body: JSON.stringify({ id }) }); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Delete failed.'); }
    finally { setBusy(false); }
  };
  const filtered = documents.filter(document => (source === 'all' || document.source === source)
    && [document.name, document.applicationId, document.kind ? labels[document.kind] ?? document.kind : 'Cooperative document']
      .some(value => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">All documents</h2>
    <p className="mb-5 mt-1 text-sm text-slate-500">Loan application attachments and cooperative uploads in one place.</p>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <input aria-label="Search documents" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search filename, application or type" className="min-w-64 rounded-lg border border-slate-300 p-2 text-sm" />
      <select aria-label="Document source" value={source} onChange={event => { setSource(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 p-2 text-sm">
        <option value="all">All sources</option><option value="loan">Loan attachments</option><option value="cooperative">Cooperative uploads</option>
      </select>
      <button disabled={busy || !loaded} onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Refresh documents</button>
      {role === 'super_admin' && <><button disabled={busy || !loaded} onClick={() => input.current?.click()} className="rounded-lg bg-green-800 px-3 py-2 text-sm text-white disabled:opacity-50">Upload cooperative document</button>
        <input ref={input} aria-label="Upload cooperative document" type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" hidden disabled={busy} onChange={event => void upload(event.target.files?.[0])} /></>}
    </div>
    <p className="mb-4 text-xs text-slate-500">Download links expire after five minutes; refresh to renew. Cooperative uploads support PDF, DOCX, PNG and JPG up to the limit in portal settings (maximum 10 MB).</p>
    {error && <p role="alert" className="mb-4 text-red-700">{error}</p>}
    {(busy || !loaded) && <p role="status" className="mb-4 text-sm">{loaded ? 'Updating documents…' : 'Loading documents…'}</p>}
    {loaded && <>
      <p className="mb-3 text-sm text-slate-600">{filtered.length} document{filtered.length === 1 ? '' : 's'}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600"><tr>{['Document', 'Source / application', 'Size', 'Uploaded', 'Actions'].map(title => <th key={title} className="whitespace-nowrap p-3 font-medium">{title}</th>)}</tr></thead>
        <tbody>{visible.map(document => <tr key={document.id} className="border-t border-slate-100">
          <td className="p-3"><p className="break-all font-medium">{document.name}</p><p className="mt-1 text-xs text-slate-500">{document.kind ? labels[document.kind] ?? document.kind : 'Cooperative document'}</p></td>
          <td className="p-3">{document.source === 'loan' ? <><p>Loan attachment</p><p className="text-xs text-slate-500">{document.applicationId ?? 'Application unavailable'}</p></> : 'Cooperative upload'}</td>
          <td className="whitespace-nowrap p-3">{document.size == null ? 'Not recorded' : `${(document.size / 1024).toFixed(1)} KB`}</td>
          <td className="whitespace-nowrap p-3">{document.createdAt && Number.isFinite(Date.parse(document.createdAt)) ? new Date(document.createdAt).toLocaleDateString('en-PH') : 'Not recorded'}</td>
          <td className="p-3"><div className="flex flex-wrap gap-3">{document.url ? <a href={document.url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-green-800 underline">View / download</a> : <span className="text-xs text-red-700">{document.linkError ?? 'File unavailable'}</span>}
            {role === 'super_admin' && document.source === 'cooperative' && <button disabled={busy} onClick={() => void remove(document.id)} className="text-red-700">Delete</button>}</div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && !error && !filtered.length && <p className="py-8 text-center text-sm text-slate-500">{documents.length ? 'No documents match your search or source filter.' : 'No documents found.'}</p>}
      {pages > 1 && <nav aria-label="Document pagination" className="mt-4 flex items-center justify-end gap-4 text-sm"><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="disabled:opacity-40">Previous</button><span>Page {currentPage} of {pages}</span><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="disabled:opacity-40">Next</button></nav>}
    </>}
  </section>;
}
