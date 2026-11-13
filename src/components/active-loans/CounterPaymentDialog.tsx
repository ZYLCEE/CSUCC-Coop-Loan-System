"use client";

import { Button } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { ConfirmActionDialog, ActionSummary } from "@/components/ui/ConfirmActionDialog";
import { ActionResultDialog } from "@/components/ui/ActionResultDialog";
import { LoadingState } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Fields";
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useAdminAuth } from '@/components/auth/AdminAuthProvider';
import { amountInCentavos, loadPaymentLedger, manilaToday, pesos, previewCounterPayment, recordCounterPayment, type PaymentAllocation, type PaymentDraft, type PaymentLedger } from '@/lib/counterPayments';

const blankDraft = (): PaymentDraft => ({ receipt: '', date: manilaToday(), amount: '' });
const allocationLabels = { principal: 'Principal', interest: 'Interest', penalty: 'Penalty', fee: 'Fees' } as const;
const control = 'mt-1 block w-full';

export default function CounterPaymentDialog({ loanId, onClose, onSaved }: { loanId: string; onClose: () => void; onSaved?: () => void }) {
  const { role } = useAdminAuth();
  const canWrite = role === 'super_admin';
  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [draft, setDraft] = useState<PaymentDraft>(blankDraft);
  const [review, setReview] = useState<{ total: number; allocation: PaymentAllocation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const submitting = useRef(false);
  const receiptField = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!review && returnFocus.current) {
      returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [review]);
  useEffect(() => {
    let active = true;
    void loadPaymentLedger(loanId).then(data => { if (active) setLedger(data); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loanId]);
  const refresh = async () => {
    setError(''); setLoading(true);
    try { setLedger(await loadPaymentLedger(loanId)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to load payments.'); }
    finally { setLoading(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || ledger?.automatic_allocation !== true) return;
    setError(''); setNotice('');
    submitting.current = true; setBusy(true);
    try {
      const allocation = await previewCounterPayment(loanId, draft);
      setReview({ total: amountInCentavos(draft.amount) / 100, allocation });
    } catch (error) { setError(error instanceof Error ? error.message : 'Check payment details.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!review || submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const payload = JSON.stringify([draft, review.allocation]);
      if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
      const payment = await recordCounterPayment(loanId, request.current.id, draft, review.allocation);
      setReview(null); setDraft(blankDraft()); request.current = null;
      setNotice(`Receipt ${payment.receipt_number} recorded: ${pesos(Number(payment.payment_amount))}.`);
      onSaved?.(); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Save failed. Refresh balances before retrying.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  const eligible = ledger && ['released', 'overdue'].includes(ledger.status) && ledger.date_released && !ledger.unallocated_payments;
  const fullyPaid = ledger?.total_remaining != null && Number(ledger.total_remaining) <= 0 && !ledger.unallocated_payments;
  const setupRequired = ledger?.automatic_allocation === undefined;
  const allocationBlocked = ledger?.automatic_allocation === false;
  let total: number | null = null;
  try { total = amountInCentavos(draft.amount) / 100; } catch { /* Input validation is shown on review. */ }

  return <FormDialog icon={Wallet} dirty={!!draft.receipt || !!draft.amount || draft.date !== manilaToday() || !!review} title="Record payment" titleId="counter-payment-title" subtitle={ledger ? `${ledger.application_id} · ${ledger.member_name}` : undefined}
    className="max-w-[640px]" busy={busy} onClose={() => { if (!submitting.current) onClose(); }}
    footer={<><Button data-dialog-close disabled={busy}>Close</Button>
      {canWrite && eligible && !fullyPaid && <Button type="submit" form="counter-payment-form" variant="primary" loading={busy}
        disabled={setupRequired || allocationBlocked || busy || loading || !!review}>{busy ? "Calculating…" : "Review payment"}</Button>}
    </>}>
      {error && <p role="alert" className="mb-4 rounded-lg bg-status-danger-surface p-3 text-sm text-status-danger">{error}</p>}
      {notice && <ActionResultDialog success title="Payment records updated" message={notice} onClose={() => setNotice('')}>
        {ledger && <ActionSummary details={[{ label: "Member", value: ledger.member_name }, { label: "Application", value: ledger.application_id }]} />}
      </ActionResultDialog>}
      {loading && <LoadingState label="Loading payment records…" />}
      <button disabled={busy || loading} onClick={() => void refresh()} className="ui-button ui-button--compact">Refresh balances</button>
      {ledger && <>
        <dl className="my-3 grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-3 text-sm sm:grid-cols-3"><div><dt>Original principal</dt><dd className="mt-1 font-semibold">{pesos(Number(ledger.principal))}</dd></div><div><dt>Principal remaining</dt><dd className="mt-1 font-semibold">{ledger.principal_remaining == null ? 'Needs reconciliation' : pesos(Number(ledger.principal_remaining))}</dd></div><div><dt>Total remaining balance</dt><dd className="mt-1 font-semibold">{ledger.total_remaining === undefined ? 'Update required' : ledger.total_remaining === null ? 'Needs reconciliation' : pesos(Number(ledger.total_remaining))}</dd></div></dl>
        <p className="mb-3 text-xs text-portal-secondary">Total remaining includes unpaid principal, interest, and penalties. Processing and service fees are deducted at release and are not charged again here.</p>
        {ledger.automatic_allocation !== undefined && <details className="mb-3 text-xs leading-5 text-portal-muted">
          <summary className="cursor-pointer font-medium">How payments are applied</summary>
          <p className="mt-2">The payment covers penalties first, then scheduled interest, then principal.</p>
          <p className="mt-1">
          {'Interest follows the saved repayment schedule when available; otherwise it uses the release-time rate snapshot.'}
          {' '}Processing and service fees are charged once at release, not in this receipt. Unknown historical penalty periods are not back-charged.
          </p>
        </details>}
        {canWrite && !eligible && !fullyPaid && <p className="mb-4 text-sm text-status-warning">{ledger.unallocated_payments ? 'Older payments have no recorded allocation. Reconcile those records before adding payments.' : 'Payments are enabled after the loan is released and its release date is recorded.'}</p>}
        {canWrite && fullyPaid && <p role="status" className="mb-4 text-sm text-status-success">Fully paid. There is no remaining balance to record.</p>}
        {canWrite && eligible && allocationBlocked && <p role="alert" className="mb-4 text-sm text-status-warning">Recorded charges do not match the calculated balance. Reconcile the payment history before recording another receipt.</p>}
        {canWrite && eligible && !fullyPaid && <form id="counter-payment-form" onSubmit={event => void submit(event)}>
          {setupRequired ? (
            <p role="status" className="mb-3 text-support text-status-warning">Payment review and recording are unavailable until the counter-payment service is set up.</p>
          ) : null}
          <fieldset disabled={setupRequired || allocationBlocked || busy || !!review || loading} className="grid gap-3 sm:grid-cols-2">
            <label className="block text-label">Official receipt number<Input ref={receiptField} required maxLength={80} value={draft.receipt} onChange={event => setDraft({ ...draft, receipt: event.target.value })} className={control} /></label>
            <label className="block text-label">Payment date<Input required type="date" min={ledger.date_released ?? undefined} max={manilaToday()} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={control} /></label>
            <label className="block text-label sm:col-span-2">Amount paid (₱)<Input required inputMode="decimal" type="number" min="0.01" max="999999999.99" step="0.01" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} className={control} /></label>
          </fieldset>
          <p className="my-3 text-support text-portal-muted">{total === null ? "Enter a valid amount to review this payment." : <>Payment total: <strong>{pesos(total)}</strong> · Cash · Over the counter</>}</p>
          {review && <ConfirmActionDialog icon={Wallet} title="Review payment allocation" confirmLabel="Confirm and record" cancelLabel="Edit details"
            question="Save only after staff has received and checked the payment. Recording this receipt updates the payment ledger."
            details={[
              { label: "Member", value: ledger.member_name }, { label: "Application", value: ledger.application_id },
              { label: "Receipt", value: draft.receipt }, { label: "Payment date (Philippine time)", value: draft.date },
              { label: "Amount received", value: pesos(review.total) }, { label: "Method", value: "Cash · Over the counter" },
              ...(['penalty', 'fee', 'interest', 'principal'] as const).map(key => ({ label: allocationLabels[key], value: pesos(review.allocation[key]) })),
            ]} busy={busy} disabled={loading} error={error} onConfirm={save}
            onClose={() => { returnFocus.current = receiptField.current; setReview(null); setError(''); }} />}

        </form>}
      </>}
  </FormDialog>;
}
