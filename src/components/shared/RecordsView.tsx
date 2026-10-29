"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminRequest } from '@/lib/adminRequest';
import LoanDetailsModal from '@/components/loan-applications/LoanDetailsModal';
import { exportCsv } from '@/lib/download';

export default function RecordsView({ resource, title }: { resource: string; title: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows(await adminRequest(resource)); } catch (error) { setError(error instanceof Error ? error.message : 'Loading failed.'); }
    finally { setLoading(false); }
  }, [resource]);
  useEffect(() => { let active = true; void adminRequest(resource).then(data => { if (active) setRows(data); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [resource]);
  const filtered = useMemo(() => rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()) && (!date || String((resource === 'active' ? row.date_submitted : row.created_at) ?? '').startsWith(date))), [rows, query, date, resource]);
  const columns = resource === 'active'
    ? ['application_id','member_name','loan_type','amount','monthly_payment','status','date_submitted']
    : ['created_at','action_name','target_id','result'];
  const labels: Record<string,string> = {application_id:'Application ID',member_name:'Member',loan_type:'Loan type',amount:'Principal',monthly_payment:'Monthly payment',status:'Status',date_submitted:'Submitted',created_at:'Date & time',action_name:'Action',target_id:'Target',result:'Result'};
  const display = (key: string, value: unknown) => {
    if (value == null) return 'Not recorded';
    if (['amount','monthly_payment'].includes(key)) return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value));
    if (['date_submitted','created_at'].includes(key) && Number.isFinite(Date.parse(String(value)))) return new Date(String(value)).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila',...(key==='created_at'?{hour:'numeric',minute:'2-digit'} as const:{})});
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value).replaceAll('_',' ');
  };
  const button = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-800 disabled:cursor-not-allowed disabled:opacity-40';
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  return <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
    <h2 className="border-b border-slate-200 px-5 py-4 text-base font-semibold">{title}</h2>
    <div className="flex flex-wrap items-center gap-3 px-5 py-4"><input aria-label={`Search ${title}`} placeholder="Search records" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 sm:max-w-sm" /><input aria-label="Filter date" type="date" value={date} onChange={event => { setDate(event.target.value); setPage(0); }} className="rounded-lg border border-slate-300 p-2 text-sm text-slate-900" /><button onClick={() => { setQuery(''); setDate(''); setPage(0); }} className={button}>Clear</button><button disabled={loading} onClick={() => void load()} className={button}>Refresh</button><button disabled={loading || !!error || !filtered.length} onClick={() => exportCsv(`${resource}.csv`, filtered)} className={button}>Export CSV</button></div>
    {error ? <p role="alert" className="text-red-700">{error}</p> : loading ? <p>Loading records…</p> : <><p className="border-y border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-600">{filtered.length} records</p><div className="max-w-full overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600"><tr>{columns.map(key => <th className="whitespace-nowrap border-b border-slate-200 px-5 py-3" key={key}>{labels[key] ?? key.replaceAll('_',' ')}</th>)}<th className="border-b border-slate-200 px-5 py-3">Action</th></tr></thead><tbody>{filtered.slice(current * 20, current * 20 + 20).map((row, index) => <tr key={String(row.id ?? index)}>{columns.map(key => <td className="max-w-[240px] whitespace-nowrap border-b border-slate-100 px-5 py-4 text-slate-700" key={key}>{key === 'status' ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${row[key] === 'overdue' ? 'border-red-200 bg-red-50 text-red-700' : row[key] === 'released' ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-green-200 bg-green-50 text-green-800'}`}>{display(key,row[key])}</span> : display(key,row[key])}</td>)}<td className="border-b border-slate-100 px-5 py-4"><button onClick={() => setSelected(row)} className="whitespace-nowrap text-green-800 underline">View details</button></td></tr>)}</tbody></table></div>{!filtered.length && <p>No matching records.</p>}<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-slate-600"><button className={button} disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current + 1} of {Math.max(1, Math.ceil(filtered.length / 20))}</span><button className={button} disabled={(current + 1) * 20 >= filtered.length} onClick={() => setPage(current + 1)}>Next</button></div></>}
    {selected && resource === "active" && <LoanDetailsModal applicationId={String(selected.application_id)} onClose={() => setSelected(null)} />}
    {selected && resource !== "active" && <div role="dialog" aria-modal="true" aria-label="Record details" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"><div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 text-slate-900 shadow-xl"><button autoFocus onClick={() => setSelected(null)} className="mb-4 rounded border p-2">Close details</button><dl>{Object.entries(selected).map(([key,value]) => <div key={key} className="mb-3"><dt className="text-sm font-semibold">{key.replaceAll('_',' ')}</dt><dd className="break-all text-sm">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? 'Not recorded')}</dd></div>)}</dl></div></div>}
  </section>;
}
