"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Banknote, History, RefreshCw } from "lucide-react";
import { useAdminAuth } from "@/components/auth/AdminAuthProvider";
import { ActionResultDialog } from "@/components/ui/ActionResultDialog";
import { Button } from "@/components/ui/Button";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { EmptyState, LoadingState } from "@/components/ui/Feedback";
import { Select, Textarea } from "@/components/ui/Fields";
import { FormDialog } from "@/components/ui/FormDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { pesos, reverseCounterPayment, type CounterPayment } from "@/lib/counterPayments";
import { loadRepaymentDetails } from "@/lib/repaymentDetailsData";
import { monthlyRepayments, paymentMonthKey } from "@/lib/repaymentDetails";
import CounterPaymentDialog from "./CounterPaymentDialog";
import PaymentHistory from "./PaymentHistory";
import RepaymentProgress from "./RepaymentProgress";

export default function RepaymentDetailsDialog(props: { loanId: string; onClose: () => void; onUpdated?: () => void }) {
  return <RepaymentDetails key={props.loanId} {...props} />;
}

function RepaymentDetails({ loanId, onClose, onUpdated }: { loanId: string; onClose: () => void; onUpdated?: () => void }) {
  const { role } = useAdminAuth();
  const canWrite = role === "super_admin";
  const id = useId();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadRepaymentDetails>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"history" | "monthly">("history");
  const [month, setMonth] = useState("all");
  const [recording, setRecording] = useState(false);
  const [reversal, setReversal] = useState<CounterPayment | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const refreshState = useRef({ version: 0 });

  useEffect(() => {
    let active = true;
    const state = refreshState.current;
    void loadRepaymentDetails(loanId).then(value => { if (active) setData(value); })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Unable to load repayment details."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; state.version++; };
  }, [loanId]);

  const refresh = async () => {
    const state = refreshState.current;
    const version = ++state.version;
    setLoading(true); setError("");
    try { const value = await loadRepaymentDetails(loanId); if (version === state.version) setData(value); }
    catch (error) { if (version === state.version) setError(error instanceof Error ? error.message : "Unable to load repayment details."); }
    finally { if (version === state.version) setLoading(false); }
  };
  const reverse = async () => {
    if (!reversal || submitting.current || !canWrite || reason.trim().length < 5 || reason.trim().length > 1000) return;
    submitting.current = true; setBusy(true); setActionError("");
    try {
      await reverseCounterPayment(reversal.id, reason);
      setReversal(null); setReason("");
      setNotice("Payment reversed. The original receipt and reason remain in history. This does not issue a cash refund.");
      onUpdated?.(); await refresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : "Reversal failed. Refresh the ledger before retrying."); }
    finally { submitting.current = false; setBusy(false); }
  };
  const months = useMemo(() => monthlyRepayments(data?.ledger.payments ?? []), [data]);
  const payments = data?.ledger.payments.filter(payment => month === "all" || paymentMonthKey(payment.payment_date) === month) ?? [];
  const canRecord = canWrite && data && ["released", "overdue"].includes(data.ledger.status) && !!data.ledger.date_released && !data.ledger.unallocated_payments;
  const selectTab = (value: "history" | "monthly") => setTab(value);

  return <>
    <FormDialog title="Repayment Details" icon={History} subtitle={data ? `${data.loan.applicationId} · ${data.loan.member}` : undefined}
      className="max-w-[1000px]" dirty={!!reason} busy={busy} onClose={onClose}
      footer={<>
        <Button type="button" data-dialog-close disabled={busy}>Close</Button>
        {canRecord && <Button variant="primary" disabled={busy || loading || !!error} onClick={() => setRecording(true)}>
          <Banknote className="h-4 w-4" aria-hidden="true" />Record payment
        </Button>}
      </>}>
      {error && <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-body text-status-danger">{error}<Button onClick={() => void refresh()}>Retry</Button></div>}
      {loading && <LoadingState label="Loading repayment details…" />}
      {data && <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={data.loan.status} />
          <Button size="compact" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Refresh</Button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-surface-muted p-3"><p className="text-caption text-portal-secondary">Net recorded payments</p><p className="mt-1 text-card-title font-semibold tabular-nums">{pesos(Number(data.ledger.total_received))}</p></div>
          <div className="rounded-lg bg-surface-muted p-3"><p className="text-caption text-portal-secondary">Principal remaining</p><p className="mt-1 text-card-title font-semibold tabular-nums">{data.ledger.principal_remaining === null ? "Needs reconciliation" : pesos(Number(data.ledger.principal_remaining))}</p></div>
          <div className="rounded-lg bg-surface-muted p-3"><p className="text-caption text-portal-secondary">Total remaining balance</p><p className="mt-1 text-card-title font-semibold tabular-nums">{data.ledger.total_remaining === undefined ? "Update required" : data.ledger.total_remaining === null ? "Needs reconciliation" : pesos(Number(data.ledger.total_remaining))}</p><p className="mt-1 text-caption text-portal-secondary">Includes unpaid interest and penalties</p></div>
          <div className="col-span-2 rounded-lg bg-surface-muted p-3 sm:col-span-1"><p className="mb-2 text-caption text-portal-secondary">Principal installments covered</p><RepaymentProgress progress={data.loan.progress} loanLabel={data.loan.applicationId} overdue={data.loan.status === "Overdue"} /></div>
        </div>
        <p className="mb-4 text-caption leading-5 text-portal-secondary">Month counts track principal installments. Interest, penalties and fees do not add months. Loan completion requires separate review.</p>
        <div role="tablist" aria-label="Repayment views" className="mb-3 flex gap-2 border-b border-portal-border pb-2">
          {([ ["history", "Payment History"], ["monthly", "Monthly Summary"] ] as const).map(([value, label]) => <button key={value} type="button" role="tab"
            id={`${id}-${value}-tab`} aria-selected={tab === value} aria-controls={`${id}-${value}-panel`} tabIndex={tab === value ? 0 : -1}
            className={`ui-button ui-button--compact ${tab === value ? "ui-button--primary" : "ui-button--ghost"}`}
            onClick={() => selectTab(value)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault(); const next = event.key === "Home" ? "history" : event.key === "End" ? "monthly" : value === "history" ? "monthly" : "history";
              selectTab(next); document.getElementById(`${id}-${next}-tab`)?.focus();
            }}>{label}</button>)}
        </div>
        <div role="tabpanel" id={`${id}-history-panel`} aria-labelledby={`${id}-history-tab`} hidden={tab !== "history"}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-support font-medium">Payment history ({payments.length})</p>
            <Select aria-label="Filter payment history by month" value={month} onChange={event => setMonth(event.target.value)} size="compact" className="max-w-full">
              <option value="all">All payment months</option>{months.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
            </Select>
          </div>
          <p className="mb-3 text-caption leading-5 text-portal-secondary">Payment date follows the receipt. Recorded at shows when staff saved it, in Philippine time.</p>
          <PaymentHistory key={month} payments={payments} busy={busy || loading || !!error} canReverse={canWrite} onReverse={(payment, button) => {
            returnFocus.current = button; setReversal(payment); setReason(""); setActionError("");
          }} />
        </div>
        <div role="tabpanel" id={`${id}-monthly-panel`} aria-labelledby={`${id}-monthly-tab`} hidden={tab !== "monthly"}>
          <p className="mb-3 text-caption leading-5 text-portal-secondary">Totals are grouped by payment date. Late or advance payments can cover other installments. Reversed receipts are excluded from totals.</p>
          {months.length ? <div className="space-y-3">{months.map(group => <article key={group.key} aria-label={group.label} className="rounded-lg border border-portal-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-body font-semibold">{group.label}</h3>
              <p className="mt-1 text-caption text-portal-secondary">{group.postedReceipts} posted {group.postedReceipts === 1 ? "receipt" : "receipts"}{group.reversedReceipts > 0 && ` · ${group.reversedReceipts} reversed`}</p></div>
              <p className="text-card-title font-semibold tabular-nums">{pesos(group.amount)}</p>
            </div>
            <dl className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{([ ["Principal", group.principal], ["Interest", group.interest], ["Penalties", group.penalties], ["Fees", group.fees] ] as const).map(([label, amount]) => <div key={label}>
              <dt className="text-caption text-portal-secondary">{label}</dt><dd className="mt-0.5 text-support tabular-nums">{amount === null ? "Not allocated" : pesos(amount)}</dd>
            </div>)}</dl>
            <Button size="compact" aria-label={`View ${group.label} receipts`} onClick={() => { setMonth(group.key); setTab("history"); }}>View receipts</Button>
          </article>)}</div> : <EmptyState title="No payments recorded" />}
        </div>
      </>}
    </FormDialog>
    {reversal && data && <ConfirmActionDialog title="Reverse this recorded payment?" tone="destructive" confirmLabel="Confirm reversal" returnFocusRef={returnFocus}
      question="This excludes the payment from totals and restores its principal allocation. The original receipt stays in the audit trail. This does not issue a cash refund."
      details={[ { label: "Member", value: data.loan.member }, { label: "Application", value: data.loan.applicationId },
        { label: "Receipt", value: reversal.receipt_number ?? "Not recorded" }, { label: "Amount", value: pesos(Number(reversal.payment_amount)) },
        { label: "Payment date", value: reversal.payment_date } ]}
      busy={busy} disabled={reason.trim().length < 5 || reason.trim().length > 1000} error={actionError} onConfirm={reverse}
      onClose={() => { setReversal(null); setReason(""); setActionError(""); }}>
      <label className="block text-label">Reason<Textarea required minLength={5} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 block w-full" /></label>
    </ConfirmActionDialog>}
    {notice && <ActionResultDialog success title="Payment records updated" message={notice} onClose={() => setNotice("")} />}
    {recording && <CounterPaymentDialog loanId={loanId} onClose={() => setRecording(false)} onSaved={() => { onUpdated?.(); void refresh(); }} />}
  </>;
}
