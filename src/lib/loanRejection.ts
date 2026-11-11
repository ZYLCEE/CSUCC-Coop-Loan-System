import { getSupabaseClient } from "./supabase";

export const rejectionReasonMaxLength = 2000;
export const rejectionWarning = "Rejecting this application will change its status to Rejected. The applicant will no longer proceed through the normal approval process for this application.";
export const rejectionEligible = (status: string) => ["pending", "under review"].includes(status.trim().toLowerCase());
export function validateRejectionReason(value: string) {
  const reason = value.trim();
  if (!reason) throw new Error("Please enter a reason for rejecting this application.");
  if (Array.from(reason).length > rejectionReasonMaxLength) throw new Error(`Enter a rejection reason of up to ${rejectionReasonMaxLength} characters.`);
  return reason;
}
export async function loanRejectionAvailable(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient().functions.invoke("secure-admin-action", { body: { mode: "loan-rejection-capability" } });
    return !error && data?.version === 1 && data.reason_max_length === rejectionReasonMaxLength &&
      Array.isArray(data.statuses) && data.statuses.length === 2 && data.statuses.includes("pending") && data.statuses.includes("under review");
  } catch { return false; }
}
export type LoanRejectionDetails = { reason: string; rejected_at: string; rejected_by: string | null };
export async function loadLoanRejectionDetails(applicationId: string): Promise<LoanRejectionDetails | null> {
  const { data, error } = await getSupabaseClient().rpc("loan_rejection_details", { p_application_id: applicationId });
  if (error) throw new Error("Rejection information is unavailable. Please retry or contact the system administrator.");
  if (data === null) return null;
  if (!data || typeof data.reason !== "string" || !data.reason.trim() || typeof data.rejected_at !== "string" || !Number.isFinite(Date.parse(data.rejected_at)) || (data.rejected_by !== null && typeof data.rejected_by !== "string")) {
    throw new Error("Rejection information could not be read reliably. Please retry.");
  }
  return data;
}
