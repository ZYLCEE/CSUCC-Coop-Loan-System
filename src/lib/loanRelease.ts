import {reviewRequest} from "./committeeReviewRequest";
import { getSupabaseClient } from './supabase';

export type ReleaseDetails = {
  application_id: string; member_name: string; amount: number | string; status: string;
  date_submitted: string; date_approved: string | null; date_released: string | null;
  base_interest_rate: number; processing_fee_percent: number; service_fee_percent: number;
};
export type ReleaseDraft = { date: string; reference: string; notes: string };
export type ReleasedLoan = {
  id: string; application_id: string; status: string; date_released: string;
  release_reference: string; amount: number; interest_rate_at_release: number;
  processing_fee_amount_at_release: number; service_fee_amount_at_release: number; net_proceeds: number;
};

export function releaseChargePreview(details: ReleaseDetails) {
  const amount = Number(details.amount);
  const processingFee = Math.round(amount * details.processing_fee_percent) / 100;
  const serviceFee = Math.round(amount * details.service_fee_percent) / 100;
  return { processingFee, serviceFee, netProceeds: amount - processingFee - serviceFee };
}

export async function loadLoanRelease(applicationId: string): Promise<ReleaseDetails> {
  const client = getSupabaseClient();
  const [loan, policy] = await Promise.all([
    client.from('loan_applications')
      .select('application_id,member_name,amount,status,date_submitted,date_approved,date_released')
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
