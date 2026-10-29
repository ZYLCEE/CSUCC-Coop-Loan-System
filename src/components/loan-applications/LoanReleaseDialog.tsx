"use client";

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/components/auth/AdminAuthProvider';
import { loadLoanRelease, releaseApprovedLoan, type ReleaseDetails, type ReleaseDraft, type ReleasedLoan } from '@/lib/loanRelease';

const control = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40';
const currency = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));

export default function LoanReleaseDialog({ applicationId, onClose, onReleased }: { applicationId: string; onClose: () => void; onReleased: () => void }) {
  const { role } = useAdminAuth();
  const [details, setDetails] = useState<ReleaseDetails | null>(null);
  const [draft, setDraft] = useState<ReleaseDraft>({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()), reference: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<ReleasedLoan | null>(null);
  const panel = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = () => { if (saved) onReleased(); onClose(); }; }, [onClose, onReleased, saved]);
  useEffect(() => {
    let active = true;
    if (role !== 'super_admin') return;
    void loadLoanRelease(applicationId).then(data => { if (active) setDetails(data); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applicationId, role]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]') ?? []).filter(item => item.offsetParent !== null);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const submit = (event: FormEvent) => { event.preventDefault(); if (confirmed && details) { setError(''); setReview(true); } };
  const save = async () => {
    if (!details || !confirmed || submitting.current || saved || role !== 'super_admin') return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const payload = JSON.stringify(draft);
      if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
      setSaved(await releaseApprovedLoan(details, draft, request.current.id));
    } catch (error) { setError(error instanceof Error ? error.message : 'Release could not be recorded. Refresh the loan before retrying.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  const eligible = details?.status === 'approved' && details.date_approved && !details.date_released;
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="release-loan-title" className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-6 text-slate-900 shadow-xl">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 id="release-loan-title" className="text-lg font-bold">Mark loan as released</h2><button disabled={busy} onClick={() => closeRef.current()} className={button}>Close</button></div>
      {role !== 'super_admin' ? <p role="alert">Super Admin access required.</p> : <>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {loading ? <p role="status">Loading approved loan…</p> : saved ? <div role="status" className="space-y-3 rounded-lg bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">{saved.application_id} is marked as released.</p>
          <p>{currency(saved.amount)} · Release date: {saved.date_released} · Reference: {saved.release_reference}</p>
          <p>You can now record counter payments for this loan under Active Loans.</p>
          <div className="flex gap-3"><button onClick={() => closeRef.current()} className={button}>Done</button><Link href="/super-admin/active-loans" onClick={onReleased} className="rounded-lg bg-green-800 px-3 py-2 text-white">Open Active Loans</Link></div>
        </div> : details && <>
          <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm"><div><dt className="text-slate-500">Application</dt><dd className="font-semibold">{details.application_id}</dd></div><div><dt className="text-slate-500">Member</dt><dd className="font-semibold">{details.member_name}</dd></div><div><dt className="text-slate-500">Approved principal</dt><dd className="font-semibold">{currency(details.amount)}</dd></div><div><dt className="text-slate-500">Approval date</dt><dd>{details.date_approved ?? 'Not recorded'}</dd></div></dl>
          {!eligible ? <p role="alert" className="text-sm text-amber-800">This loan must be Approved, have an approval date, and have no previous release. Refresh Loan Applications to see its current status.</p> : <form onSubmit={submit}>
            <p className="mb-4 text-sm text-slate-600">Record the release only after the loan proceeds have been handed to the member. This action records the disbursement; it does not transfer money.</p>
            <fieldset disabled={busy || review} className="space-y-4">
              <label className="block text-sm">Release date<input required type="date" min={details.date_approved && details.date_approved > details.date_submitted ? details.date_approved : details.date_submitted} max={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={control} /></label>
              <label className="block text-sm">Disbursement reference / voucher number<input required maxLength={80} value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })} className={control} /></label>
              <label className="block text-sm">Notes (optional)<textarea maxLength={2000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} className={control} /></label>
              <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>I confirm that the loan proceeds have been disbursed to this member and these details match the disbursement record.</span></label>
            </fieldset>
            {review ? <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm"><p>Confirm release of <strong>{currency(details.amount)}</strong> for <strong>{details.application_id}</strong> on {draft.date}, reference <strong>{draft.reference}</strong>. The status, release date, and staff audit record will be saved together.</p><div className="mt-3 flex gap-3"><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-green-800 px-4 py-2 text-white disabled:opacity-40">{busy ? 'Recording…' : 'Confirm release'}</button><button type="button" disabled={busy} onClick={() => { setReview(false); setError(''); }} className={button}>Edit details</button></div></div> : <button disabled={!confirmed || busy} className="mt-4 rounded-lg bg-green-800 px-4 py-2 text-sm text-white disabled:opacity-40">Review release</button>}
          </form>}
        </>}
      </>}
    </section>
  </div>;
}
