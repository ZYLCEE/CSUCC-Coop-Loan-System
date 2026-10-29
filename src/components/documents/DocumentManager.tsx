"use client";
import { useEffect, useRef, useState } from 'react';
import { adminRequest } from '@/lib/adminRequest';
import { useAdminAuth } from '@/components/auth/AdminAuthProvider';
type Document = { id: string; name: string; size: number; createdAt: string; url: string };
export default function DocumentManager() {
  const {role} = useAdminAuth();
  const [documents,setDocuments] = useState<Document[]>([]);
  const [query,setQuery] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [loaded,setLoaded] = useState(false);
  const input=useRef<HTMLInputElement>(null);
  const load=async()=>{setError('');setBusy(true);try{setDocuments(await adminRequest('documents'));}catch(error){setError(error instanceof Error?error.message:'Loading failed.');}finally{setBusy(false);setLoaded(true);}};
  useEffect(()=>{let active=true;void adminRequest('documents').then(data=>{if(active)setDocuments(data);}).catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setLoaded(true);});return()=>{active=false;};},[]);
  const upload=async(file?:File)=>{if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.set('file',file);await adminRequest('documents',{method:'POST',body:form});await load();}catch(error){setError(error instanceof Error?error.message:'Upload failed.');}finally{setBusy(false);if(input.current)input.current.value='';}};
  const remove=async(id:string)=>{if(!window.confirm('Permanently delete this document?'))return;setBusy(true);setError('');try{await adminRequest('documents',{method:'DELETE',body:JSON.stringify({id})});await load();}catch(error){setError(error instanceof Error?error.message:'Delete failed.');}finally{setBusy(false);}};
  return <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 text-lg font-semibold">Cooperative documents</h2><div className="mb-4 flex flex-wrap gap-3"><input aria-label="Search documents" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search filenames" className="rounded border p-2"/><button disabled={busy} onClick={()=>void load()}>Refresh links</button>{role==='super_admin'&&<label className="rounded border p-2">Upload document<input ref={input} type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" disabled={busy} onChange={event=>void upload(event.target.files?.[0])}/></label>}</div><p className="mb-4 text-sm text-slate-500">PDF, DOCX, PNG or JPG · Up to 10 MB. Download links expire after five minutes; refresh to renew.</p>{error&&<p role="alert" className="text-red-700">{error}</p>}{busy&&<p>Working…</p>}<ul>{documents.filter(document=>document.name.toLowerCase().includes(query.toLowerCase())).map(document=><li key={document.id} className="flex flex-wrap items-center gap-4 border-t py-3"><span className="flex-1">{document.name}</span><span className="text-xs">{Math.ceil(document.size/1024)} KB</span><a href={document.url} target="_blank" rel="noreferrer" className="text-green-800 underline">View / download</a>{role==='super_admin'&&<button disabled={busy} onClick={()=>void remove(document.id)} className="text-red-700">Delete</button>}</li>)}</ul>{loaded&&!busy&&!error&&!documents.length&&<p>No documents uploaded yet.</p>}</section>;
}
