import { toActiveLoan } from "./activeLoans";
import { loadPaymentLedger } from "./counterPayments";
import { getSupabaseClient } from "./supabase";

export async function loadRepaymentDetails(loanId: string) {
  const [ledger, result] = await Promise.all([
    loadPaymentLedger(loanId),
    getSupabaseClient().from("loan_applications")
      .select("id,application_id,member_name,loan_type,amount,monthly_payment,status,date_submitted,tenure_months,members:members!loan_applications_member_id_fkey(member_id,membership_type)")
      .eq("id", loanId).single(),
  ]);
  if (result.error) throw new Error("Unable to load the loan's repayment terms. Please retry.");
  if (!result.data) throw new Error("Loan repayment details are not available.");
  return { ledger, loan: toActiveLoan(result.data, ledger.payments) };
}
