"use client";

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/components/auth/AdminAuthProvider';
import { loadPaymentLedger, manilaToday, paymentTotal, pesos, recordCounterPayment, reverseCounterPayment, type PaymentDraft, type PaymentLedger } from '@/lib/counterPayments';

const blankDraft = (): PaymentDraft => ({ receipt: '', date: manilaToday(), principal: '0', interest: '0', penalty: '0', fee: '0', notes: '' });
const control = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-40';

export default function CounterPaymentDialog({ loanId, onClose, onSaved }: { loanId: string; onClose: () => void; onSaved?: () => void }) {
  const { role } = useAdminAuth();
  const canWrite = role === 'super_admin';
  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [draft, setDraft] = useState<PaymentDraft>(blankDraft);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);
  const [reversal, setReversal] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    let active = true;
    void loadPaymentLedger(loanId).then(data => { if (active) setLedger(data); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loanId]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting.current) closeRef.current();
      if (event.key !== 'Tab') return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[href]') ?? []).filter(item => item.offsetParent !== null);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const refresh = async () => {
    setError(''); setLoading(true);
    try { setLedger(await loadPaymentLedger(loanId)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to load payments.'); }
    finally { setLoading(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    try {
      if (paymentTotal(draft) <= 0) throw new Error('Payment total must be greater than zero.');
      if (ledger?.principal_remaining != null && Number(draft.principal) > Number(ledger.principal_remaining)) throw new Error('Principal payment exceeds the remaining principal.');
      setReview(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'Check payment details.'); }
  };
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const payload = JSON.stringify(draft);
      if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
      const payment = await recordCounterPayment(loanId, request.current.id, draft);
      setReview(false); setDraft(blankDraft()); request.current = null;
      setNotice(`Receipt ${payment.receipt_number} recorded: ${pesos(Number(payment.payment_amount))}.`);
      onSaved?.(); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Save failed. Refresh history before retrying.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  const reverse = async () => {
    if (!reversal || submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try { await reverseCounterPayment(reversal, reason); setReversal(null); setReason(''); setNotice('Payment reversed. The original receipt and reason remain in history.'); onSaved?.(); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Reversal failed. Refresh history before retrying.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  const eligible = ledger && ['released', 'overdue'].includes(ledger.status) && ledger.date_released && !ledger.unallocated_payments;
  const pages = Math.max(1, Math.ceil((ledger?.payments.length ?? 0) / 10));
  const currentPage = Math.min(page, pages);
  let total = 0;
  try { total = paymentTotal(draft); } catch { /* Input validation is shown on review. */ }

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="counter-payment-title" className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-6 text-slate-900 shadow-xl">
      <div className="mb-4 flex items-start justify-between gap-4"><div><h2 id="counter-payment-title" className="text-lg font-bold">Counter payments</h2>{ledger && <p className="text-sm text-slate-600">{ledger.application_id} · {ledger.member_name}</p>}</div><button disabled={busy} onClick={onClose} className={button}>Close</button></div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {loading && <p role="status" className="mb-4 text-sm">Loading payment records…</p>}
      <button disabled={busy || loading} onClick={() => void refresh()} className={button}>Refresh history</button>
      {ledger && <>
        <dl className="my-5 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3"><div><dt>Original principal</dt><dd className="font-semibold">{pesos(Number(ledger.principal))}</dd></div><div><dt>Net recorded payments</dt><dd className="font-semibold">{pesos(Number(ledger.total_received))}</dd></div><div><dt>Principal remaining</dt><dd className="font-semibold">{ledger.principal_remaining == null ? 'Needs reconciliation' : pesos(Number(ledger.principal_remaining))}</dd></div></dl>
        <p className="mb-4 text-xs text-slate-500">Principal remaining excludes interest, penalties and fees. Staff enters the official receipt breakdown. Loan completion requires separate review.</p>
        {canWrite && !eligible && <p className="mb-4 text-sm text-amber-800">{ledger.unallocated_payments ? 'Older payments have no recorded allocation. Reconcile those records before adding payments.' : 'Payments are enabled after the loan is released and its release date is recorded.'}</p>}
        {canWrite && eligible && <form onSubmit={submit} className="mb-6 rounded-lg border border-slate-200 p-4">
          <h3 className="mb-3 font-semibold">Record cash payment received over the counter</h3>
          <fieldset disabled={busy || review || loading || reversal !== null} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Official receipt number<input required maxLength={80} value={draft.receipt} onChange={event => setDraft({ ...draft, receipt: event.target.value })} className={control} /></label>
            <label className="text-sm">Payment date<input required type="date" min={ledger.date_released ?? undefined} max={manilaToday()} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={control} /></label>
            {(['principal', 'interest', 'penalty', 'fee'] as const).map(key => <label key={key} className="text-sm capitalize">{key === 'fee' ? 'Fees' : key} (₱)<input required inputMode="decimal" type="number" min="0" max="999999999.99" step="0.01" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} className={control} /></label>)}
            <label className="text-sm sm:col-span-2">Notes (optional)<textarea maxLength={2000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} className={control} /></label>
          </fieldset>
          <p className="my-3 text-sm font-semibold">Payment total: {pesos(total)} · Cash · Over the counter</p>
          {review ? <div className="rounded-lg bg-amber-50 p-3 text-sm"><p>Confirm receipt <strong>{draft.receipt}</strong> for <strong>{pesos(total)}</strong>, received on {draft.date}. Save only after staff has received and checked the payment.</p><div className="mt-3 flex gap-3"><button type="button" disabled={busy || loading} onClick={() => void save()} className="rounded-lg bg-green-800 px-4 py-2 text-white disabled:opacity-40">{busy ? 'Saving…' : 'Confirm and record'}</button><button type="button" disabled={busy} onClick={() => { setReview(false); setError(''); }} className={button}>Edit details</button></div></div> : <button disabled={busy || loading || reversal !== null} className="rounded-lg bg-green-800 px-4 py-2 text-sm text-white disabled:opacity-40">Review payment</button>}
        </form>}
        <h3 className="mb-3 font-semibold">Payment history ({ledger.payments.length})</h3>
        {ledger.payments.length ? <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Receipt / date', 'Amount / breakdown', 'Recorded by', 'Status / action'].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{ledger.payments.slice((currentPage - 1) * 10, currentPage * 10).map(payment => <tr key={payment.id} className="border-t border-slate-100">
          <td className="p-3"><p>{payment.receipt_number ?? 'Legacy receipt not recorded'}</p><p className="text-xs text-slate-500">{payment.payment_date} · {payment.payment_method.replaceAll('_', ' ')}</p>{payment.notes && <p className="mt-1 max-w-xs break-words text-xs">{payment.notes}</p>}</td>
          <td className="p-3"><p className="font-semibold">{pesos(Number(payment.payment_amount))}</p><p className="text-xs text-slate-500">{payment.principal_amount == null ? 'Allocation not recorded' : `Principal ${pesos(Number(payment.principal_amount))} · Interest ${pesos(Number(payment.interest_amount))} · Penalty ${pesos(Number(payment.penalty_amount))} · Fees ${pesos(Number(payment.fee_amount))}`}</p></td>
          <td className="max-w-40 break-words p-3 text-xs">{payment.recorded_by_name ?? 'Not recorded'}</td>
          <td className="p-3"><p className={payment.payment_status === 'reversed' ? 'text-red-700' : 'text-green-800'}>{payment.payment_status === 'reversed' ? 'Reversed' : 'Posted'}</p>{payment.reversal_reason && <p className="mt-1 max-w-xs break-words text-xs">{payment.reversal_reason}</p>}{canWrite && payment.payment_status === 'posted' && payment.recorded_by && <button disabled={busy || review || loading} className="mt-2 text-xs text-red-700 underline" onClick={() => { setReversal(payment.id); setReason(''); setNotice(''); }}>Reverse payment</button>}</td>
        </tr>)}</tbody></table></div><nav aria-label="Payment history pagination" className="mt-3 flex items-center justify-end gap-3 text-sm"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className={button}>Previous</button><span>Page {currentPage} of {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)} className={button}>Next</button></nav></> : <p className="text-sm text-slate-500">No payments recorded for this loan.</p>}
        {reversal && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"><h3 className="font-semibold">Reverse this recorded payment?</h3><p className="my-2 text-sm">This excludes the payment from totals and restores its principal allocation. The original receipt stays in the audit trail. This does not issue a cash refund.</p><label className="text-sm">Reason<textarea required minLength={5} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className={control} /></label><div className="mt-3 flex gap-3"><button disabled={busy || reason.trim().length < 5} onClick={() => void reverse()} className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-40">Confirm reversal</button><button disabled={busy} onClick={() => setReversal(null)} className={button}>Cancel</button></div></div>}
      </>}
    </section>
  </div>;
}
