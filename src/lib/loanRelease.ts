import {reviewRequest} from "./committeeReviewRequest";
import { getSupabaseClient } from './supabase';

export type ReleaseDetails = {
  application_id: string; member_name: string; amount: number | string; status: string;
  date_submitted: string; date_approved: string | null; date_released: string | null;
  tenure_months: number; base_interest_rate: number; processing_fee_percent: number; service_fee_percent: number;
};
export type ReleaseDraft = { date: string; reference: string; notes: string };
export type ReleasedLoan = {
  id: string; application_id: string; status: string; date_released: string;
  release_reference: string; amount: number; interest_rate_at_release: number;
  processing_fee_amount_at_release: number; service_fee_amount_at_release: number;
  loan_lppi_factor_percent_at_release: number; loan_insurance_premium_at_release: number; net_proceeds: number;
};

const lppiFactorsPercent: Record<number, number> = {
  1: 0.1629, 2: 0.1629, 3: 0.2444, 4: 0.3259, 5: 0.4073, 6: 0.4888,
  7: 0.5703, 8: 0.6518, 9: 0.7332, 10: 0.8147, 11: 0.8962, 12: 0.9750,
  13: 1.0519, 14: 1.1406, 15: 1.2221, 16: 1.3036, 17: 1.3850, 18: 1.4665,
  19: 1.5430, 20: 1.6295, 21: 1.7110, 22: 1.7924, 23: 1.8739, 24: 1.9500,
};

export function releaseChargePreview(details: ReleaseDetails) {
  const amount = Number(details.amount);
  const processingFee = Math.round(amount * details.processing_fee_percent) / 100;
  const serviceFee = Math.round(amount * details.service_fee_percent) / 100;
  const loanInsuranceFactorPercent = lppiFactorsPercent[details.tenure_months];
  if (loanInsuranceFactorPercent === undefined) throw new Error('The loan term has no configured LPPI factor.');
  const loanInsurancePremium = Math.round(amount * loanInsuranceFactorPercent) / 100;
  return {
    processingFee, serviceFee, loanInsuranceFactorPercent, loanInsurancePremium,
    netProceeds: amount - processingFee - serviceFee - loanInsurancePremium,
  };
}

export async function loadLoanRelease(applicationId: string): Promise<ReleaseDetails> {
  const client = getSupabaseClient();
  const [loan, policy] = await Promise.all([
    client.from('loan_applications')
      .select('application_id,member_name,amount,status,date_submitted,date_approved,date_released,tenure_months')
      .eq('application_id', applicationId).single(),
    client.from('loan_policy_settings')
      .select('base_interest_rate,processing_fee_percent,service_fee_percent')
      .eq('singleton', true).single(),
  ]);
  if (loan.error) throw new Error(loan.error.message);
  if (policy.error) throw new Error(policy.error.message);
  return {
    ...loan.data,
    base_interest_rate: Number(policy.data.base_interest_rate),
    processing_fee_percent: Number(policy.data.processing_fee_percent),
    service_fee_percent: Number(policy.data.service_fee_percent),
  };
}

export async function releaseApprovedLoan(details: ReleaseDetails, draft: ReleaseDraft, requestId: string, password: string): Promise<ReleasedLoan> {
  if (!draft.reference.trim() || draft.reference.trim().length > 80) throw new Error('Enter a disbursement reference of 1 to 80 characters.');
  if (draft.notes.length > 2000) throw new Error('Notes must be at most 2000 characters.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.date))
    || new Date(draft.date).toISOString().slice(0,10) !== draft.date || draft.date > today) throw new Error('Enter a valid release date that is not in the future.');
  if (details.status !== 'approved' || details.date_released) throw new Error('Only approved loans awaiting release can be marked as released.');
  if (!details.date_approved || draft.date < details.date_approved || draft.date < details.date_submitted) throw new Error('Release date must be on or after approval and submission.');
  if(!password)throw new Error("Enter your account password to confirm this release.");
  return reviewRequest<ReleasedLoan>("",{method:"POST",body:JSON.stringify({applicationId:details.application_id,requestId,date:draft.date,reference:draft.reference.trim(),amount:details.amount,notes:draft.notes,password})},"/api/admin/loan-release");
}
