import type { CounterPayment } from "./counterPayments";

export function paymentMonthKey(paymentDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return "unrecorded";
  const date = new Date(`${paymentDate}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === paymentDate
    ? paymentDate.slice(0, 7) : "unrecorded";
}

export function paymentMonthLabel(key: string): string {
  return /^\d{4}-\d{2}$/.test(key) ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long", year: "numeric", timeZone: "Asia/Manila",
  }) : "Payment date not recorded";
}

export function paymentDateLabel(value: string): string {
  return paymentMonthKey(value) === "unrecorded" ? "Date not recorded" : new Date(`${value}T00:00:00Z`)
    .toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
}

export function recordedAtLabel(value: string | null | undefined): string {
  // A date without a saved time is not a midnight receipt timestamp.
  if (!value || !/T\d{2}:\d{2}/.test(value) || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return "Time not recorded";
  return `${new Date(value).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Asia/Manila",
  })} PHT`;
}

export interface MonthlyRepayment {
  key: string;
  label: string;
  postedReceipts: number;
  reversedReceipts: number;
  amount: number;
  principal: number | null;
  interest: number | null;
  penalties: number | null;
  fees: number | null;
}

export function monthlyRepayments(payments: CounterPayment[]): MonthlyRepayment[] {
  const groups = new Map<string, MonthlyRepayment>();
  const sum = (current: number | null, value: number | null) => current === null || value === null || !Number.isFinite(Number(value))
    ? null : (Math.round(current * 100) + Math.round(Number(value) * 100)) / 100;
  for (const payment of payments) {
    const key = paymentMonthKey(payment.payment_date);
    const group = groups.get(key) ?? { key, label: paymentMonthLabel(key), postedReceipts: 0, reversedReceipts: 0,
      amount: 0, principal: 0, interest: 0, penalties: 0, fees: 0 };
    if (payment.payment_status === "reversed") group.reversedReceipts++;
    else if (payment.payment_status === "posted") {
      group.postedReceipts++;
      group.amount = (Math.round(group.amount * 100) + Math.round(Number(payment.payment_amount) * 100)) / 100;
      group.principal = sum(group.principal, payment.principal_amount);
      group.interest = sum(group.interest, payment.interest_amount);
      group.penalties = sum(group.penalties, payment.penalty_amount);
      group.fees = sum(group.fees, payment.fee_amount);
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.key === "unrecorded" ? 1 : b.key === "unrecorded" ? -1 : b.key.localeCompare(a.key));
}
