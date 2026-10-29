"use client";
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import LoanDocumentsModal from './LoanDocumentsModal';

export default function LoanDetailsModal({ applicationId, onClose }: { applicationId: string; onClose: () => void }) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [payments, setPayments] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState(false);
  useEffect(() => {
    let active = true;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    void (async () => {
      const client = getSupabaseClient();
      const { data, error } = await client.from('loan_applications').select('*').eq('application_id', applicationId).single();
      if (error) throw error;
      const result = await client.from('loan_payments').select('*').eq('loan_application_id', data.id).order('payment_date', { ascending: false });
      if (result.error) throw result.error;
      if (active) { setRecord(data); setPayments(result.data); }
    })().catch(error => { if (active) setError(error.message); });
    return () => { active = false; document.removeEventListener('keydown', key); };
  }, [applicationId, onClose]);
  return <div role="dialog" aria-modal="true" aria-label={`Loan ${applicationId}`} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <section className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}>
      <div className="mb-4 flex justify-between"><h2 className="font-bold">{applicationId}</h2><button autoFocus onClick={onClose}>Close</button></div>
      {error ? <p role="alert">{error}</p> : !record ? <p>Loading loan…</p> : <>
        <dl className="grid grid-cols-2 gap-3 text-sm">{Object.entries(record).filter(([key]) => !['id','member_id'].includes(key)).map(([key, value]) => <div key={key}><dt className="text-slate-500">{key.replaceAll('_',' ')}</dt><dd className="break-words">{value == null ? 'Not recorded' : String(value)}</dd></div>)}</dl>
        <h3 className="mt-5 font-semibold">Payment history</h3>
        {payments.length ? payments.map(payment => <p key={String(payment.id)} className="mt-2 text-sm">{String(payment.payment_date)} — ₱{Number(payment.payment_amount).toLocaleString('en-PH')} · {String(payment.payment_method ?? 'Not recorded')}</p>) : <p className="text-sm text-slate-500">No payments recorded.</p>}
        <button className="mt-5 rounded bg-green-800 px-4 py-2 text-white" onClick={() => setDocuments(true)}>View documents</button>
      </>}
      {documents && <LoanDocumentsModal applicationId={applicationId} onClose={() => setDocuments(false)} />}
    </section>
  </div>;
}
