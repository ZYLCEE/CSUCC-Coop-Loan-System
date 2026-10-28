import { getSupabaseClient } from "@/lib/supabase";

export interface LoanPolicy {
  base_interest_rate: number;
  processing_fee_percent: number;
  max_loan_multiplier: number;
  min_member_tenure_months: number;
  penalty_rate_percent: number;
  service_fee_percent: number;
  co_maker_required_above: number;
  collateral_required_above: number;
  loan_processing_time: string;
  min_loan_amount: number;
  max_loan_amount: number;
  updated_at?: string;
  updated_by?: string | null;
}

export const defaultLoanPolicy: LoanPolicy = {
  base_interest_rate: 1.5,
  processing_fee_percent: 1,
  max_loan_multiplier: 3,
  min_member_tenure_months: 6,
  penalty_rate_percent: 2,
  service_fee_percent: 0.5,
  co_maker_required_above: 50000,
  collateral_required_above: 200000,
  loan_processing_time: "3–5",
  min_loan_amount: 1000,
  max_loan_amount: 500000,
};

export async function fetchLoanPolicy(): Promise<LoanPolicy> {
  const { data, error } = await getSupabaseClient()
    .from("loan_policy_settings")
    .select("base_interest_rate,processing_fee_percent,max_loan_multiplier,min_member_tenure_months,penalty_rate_percent,service_fee_percent,co_maker_required_above,collateral_required_above,loan_processing_time,min_loan_amount,max_loan_amount,updated_at,updated_by")
    .eq("singleton", true)
    .single();
  if (error) throw error;
  return {
    base_interest_rate: Number(data.base_interest_rate),
    processing_fee_percent: Number(data.processing_fee_percent),
    max_loan_multiplier: Number(data.max_loan_multiplier),
    min_member_tenure_months: Number(data.min_member_tenure_months),
    penalty_rate_percent: Number(data.penalty_rate_percent),
    service_fee_percent: Number(data.service_fee_percent),
    co_maker_required_above: Number(data.co_maker_required_above),
    collateral_required_above: Number(data.collateral_required_above),
    loan_processing_time: String(data.loan_processing_time),
    min_loan_amount: Number(data.min_loan_amount),
    max_loan_amount: Number(data.max_loan_amount),
    updated_at: data.updated_at,
    updated_by: data.updated_by,
  };
}
