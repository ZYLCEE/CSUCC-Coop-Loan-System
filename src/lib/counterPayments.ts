import { getSupabaseClient } from './supabase';

export type CounterPayment = {
  id: string; payment_amount: number; payment_date: string; payment_method: string;
  receipt_number: string | null; principal_amount: number | null; interest_amount: number | null;
  penalty_amount: number | null; fee_amount: number | null; notes: string | null;
  recorded_by: string | null; recorded_by_name: string | null; payment_status: 'posted' | 'reversed';
  reversal_reason: string | null; reversed_at: string | null;
};
export type PaymentLedger = {
  loan_id: string; application_id: string; member_name: string; status: string;
  date_released: string | null; principal: number; total_received: number;
  principal_paid: number; principal_remaining: number | null; unallocated_payments: number;
  payments: CounterPayment[];
};
export type PaymentDraft = {
  receipt: string; date: string; principal: string; interest: string; penalty: string; fee: string; notes: string;
};
export const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
export const pesos = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);

export function amountInCentavos(value: string) {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error('Enter amounts from 0 to 999,999,999.99 with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function paymentTotal(draft: PaymentDraft) {
  return ['principal', 'interest', 'penalty', 'fee'].reduce((sum, key) => sum + amountInCentavos(draft[key as keyof PaymentDraft]), 0) / 100;
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Counter payment setup is pending. Apply the counter payments database migration before using this feature.');
    if (error.code === '23505') throw new Error('That receipt number or payment request has already been recorded. Refresh payment history before retrying.');
    if (error.code === '23514' && error.message.includes('loan_payments_payment_method_check')) throw new Error('Payment was not saved. The payment method database fix must be applied before recording counter payments.');
    throw new Error(error.message || 'Unable to save payment. Refresh history before retrying.');
  }
  return data as T;
}
export const loadPaymentLedger = (loanId: string) => rpc<PaymentLedger>('loan_payment_ledger', { p_loan_id: loanId });
export function recordCounterPayment(loanId: string, requestId: string, draft: PaymentDraft) {
  if (!draft.receipt.trim() || draft.receipt.trim().length > 80) throw new Error('Enter the official receipt number (up to 80 characters).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.date)) || new Date(draft.date).toISOString().slice(0,10) !== draft.date || draft.date > manilaToday()) throw new Error('Enter a valid payment date that is not in the future.');
  if (draft.notes.length > 2000) throw new Error('Notes must be at most 2000 characters.');
  if (paymentTotal(draft) <= 0) throw new Error('Payment total must be greater than zero.');
  return rpc<CounterPayment>('record_counter_payment', {
    p_loan_id: loanId, p_request_id: requestId, p_receipt: draft.receipt.trim(), p_date: draft.date,
    p_principal: draft.principal, p_interest: draft.interest, p_penalty: draft.penalty, p_fee: draft.fee, p_notes: draft.notes,
  });
}
export const reverseCounterPayment = (paymentId: string, reason: string) => rpc<CounterPayment>('reverse_counter_payment', { p_payment_id: paymentId, p_reason: reason.trim() });
