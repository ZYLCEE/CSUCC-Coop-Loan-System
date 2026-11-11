import type { SupabaseClient } from "@supabase/supabase-js";
import { toActiveLoan, type ActiveLoan, type LoanPaymentSummary } from "./activeLoans";

export async function fetchActiveLoanRecords(client: Pick<SupabaseClient, "from">): Promise<ActiveLoan[]> {
  const loans: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("loan_applications")
      .select("id,application_id,member_name,loan_type,amount,monthly_payment,status,date_submitted,tenure_months,members:members!loan_applications_member_id_fkey(member_id,membership_type)")
      .in("status", ["released", "overdue", "completed"])
      .order("created_at", { ascending: false }).order("id").range(offset, offset + 499);
    if (error) throw error;
    loans.push(...data);
    if (data.length < 500) break;
  }
  const payments = new Map<string, LoanPaymentSummary[]>();
  // Batch and paginate receipts: neither one request per loan nor truncated embedded ledgers.
  for (let start = 0; start < loans.length; start += 100) {
    const ids = loans.slice(start, start + 100).map(loan => String(loan.id));
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("loan_payments")
        .select("loan_application_id,payment_status,payment_amount,principal_amount")
        .in("loan_application_id", ids).eq("payment_status", "posted")
        .order("id").range(offset, offset + 499);
      if (error) throw error;
      for (const payment of data) {
        const entries = payments.get(payment.loan_application_id) ?? [];
        entries.push(payment);
        payments.set(payment.loan_application_id, entries);
      }
      if (data.length < 500) break;
    }
  }
  return loans.map(loan => toActiveLoan(loan, payments.get(String(loan.id)) ?? []));
}
