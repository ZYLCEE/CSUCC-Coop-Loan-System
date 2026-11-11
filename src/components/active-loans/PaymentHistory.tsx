"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { pesos, type CounterPayment } from "@/lib/counterPayments";
import { paymentDateLabel, recordedAtLabel } from "@/lib/repaymentDetails";

const allocations = [ ["principal_amount", "Principal"], ["interest_amount", "Interest"], ["penalty_amount", "Penalties"], ["fee_amount", "Fees"] ] as const;

export default function PaymentHistory({ payments, canReverse, busy, onReverse }: {
  payments: CounterPayment[];
  canReverse: boolean;
  busy: boolean;
  onReverse: (payment: CounterPayment, button: HTMLButtonElement) => void;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(payments.length / 10));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * 10;
  if (!payments.length) return <EmptyState title="No payments recorded" description="Receipts for the selected month will appear here." />;
  return <>
    <DataTable label="Payment history" className="min-w-[780px]">
      <thead><tr>
        <th scope="col" className="text-left">Receipt / payment date</th>
        <th scope="col" className="text-right">Amount / breakdown</th>
        <th scope="col" className="text-left">Recorded at (PHT)</th>
        <th scope="col" className="text-left">Recorded by</th>
        <th scope="col" className="text-left">Status / action</th>
      </tr></thead>
      <tbody>{payments.slice(start, start + 10).map(payment => <tr key={payment.id}>
        <td className="max-w-48 align-top [overflow-wrap:anywhere]">
          <p className="font-medium">{payment.receipt_number ?? "Legacy receipt not recorded"}</p>
          <p className="mt-1 text-caption text-portal-secondary">{paymentDateLabel(payment.payment_date)}</p>
          <p className="mt-1 text-caption capitalize text-portal-secondary">{payment.payment_method.replaceAll("_", " ")}</p>
          {payment.notes && <p className="mt-1 text-caption">{payment.notes}</p>}
        </td>
        <td className="min-w-[140px] text-right align-top tabular-nums">
          <p className="font-semibold">{pesos(Number(payment.payment_amount))}</p>
          <dl className="mt-1 text-caption text-portal-secondary">{allocations.map(([key, label]) => <div key={key} className="flex flex-wrap justify-end gap-x-1">
            <dt>{label}</dt><dd>{payment[key] == null ? "Not allocated" : pesos(Number(payment[key]))}</dd>
          </div>)}</dl>
        </td>
        <td className="max-w-[165px] align-top text-caption leading-5">{recordedAtLabel(payment.created_at)}</td>
        <td className="max-w-40 align-top text-caption [overflow-wrap:anywhere]">{payment.recorded_by_name ?? "Not recorded"}</td>
        <td className="max-w-48 align-top">
          <StatusBadge status={payment.payment_status} className="capitalize" />
          {payment.reversal_reason && <p className="mt-1 text-caption [overflow-wrap:anywhere]">{payment.reversal_reason}</p>}
          {payment.reversed_at && <p className="mt-1 text-caption text-portal-secondary">Reversed {recordedAtLabel(payment.reversed_at)}</p>}
          {canReverse && payment.payment_status === "posted" && payment.recorded_by && <Button size="compact" variant="destructive" disabled={busy}
            className="mt-2" onClick={event => onReverse(payment, event.currentTarget)}>Reverse payment</Button>}
        </td>
      </tr>)}</tbody>
    </DataTable>
    <Pagination mode="summary" label="Payment history pagination" currentPage={current} totalPages={totalPages}
      totalItems={payments.length} itemLabel="payments" showingFrom={start + 1} showingTo={Math.min(start + 10, payments.length)} onPageChange={setPage} />
  </>;
}
