import { getSupabaseClient } from './supabase';

export type ReleaseDetails = {
  application_id: string; member_name: string; amount: number | string; status: string;
  date_submitted: string; date_approved: string | null; date_released: string | null;
};
export type ReleaseDraft = { date: string; reference: string; notes: string };
export type ReleasedLoan = { id: string; application_id: string; status: string; date_released: string; release_reference: string; amount: number };

export async function loadLoanRelease(applicationId: string): Promise<ReleaseDetails> {
  const { data, error } = await getSupabaseClient().from('loan_applications')
    .select('application_id,member_name,amount,status,date_submitted,date_approved,date_released')
    .eq('application_id', applicationId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function releaseApprovedLoan(details: ReleaseDetails, draft: ReleaseDraft, requestId: string): Promise<ReleasedLoan> {
  if (!draft.reference.trim() || draft.reference.trim().length > 80) throw new Error('Enter a disbursement reference of 1 to 80 characters.');
  if (draft.notes.length > 2000) throw new Error('Notes must be at most 2000 characters.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.date))
    || new Date(draft.date).toISOString().slice(0,10) !== draft.date || draft.date > today) throw new Error('Enter a valid release date that is not in the future.');
  if (details.status !== 'approved' || details.date_released) throw new Error('Only approved loans awaiting release can be marked as released.');
  if (!details.date_approved || draft.date < details.date_approved || draft.date < details.date_submitted) throw new Error('Release date must be on or after approval and submission.');
  const { data, error } = await getSupabaseClient().rpc('release_approved_loan', {
    p_application_id: details.application_id, p_request_id: requestId, p_date: draft.date,
    p_reference: draft.reference.trim(), p_expected_amount: details.amount, p_notes: draft.notes,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Loan release setup is pending. Apply the loan release database migration before using this feature.');
    if (error.code === '23505') throw new Error('That disbursement reference or request was already used. Refresh the loan before retrying.');
    throw new Error(error.message || 'Unable to record the release. Refresh the loan before retrying.');
  }
  return data as ReleasedLoan;
}
