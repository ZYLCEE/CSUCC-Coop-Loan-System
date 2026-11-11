import { getSupabaseClient } from "./supabase";

export type ReasonedAccountAction = "block-account" | "delete-account";
export const accountActionReasonMaxLength = 2000;

export function validateAccountActionReason(value: string): string {
  const reason = value.trim();
  if (!reason) throw new Error("Please enter a reason for this account action.");
  if (reason.length > accountActionReasonMaxLength) throw new Error(`Enter a reason of up to ${accountActionReasonMaxLength} characters.`);
  return reason;
}

export async function accountActionReasonsAvailable(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseClient().functions.invoke("secure-admin-action", { body: { mode: "account-action-reason-capability" } });
    return !error && data?.version === 1 && data.reason_max_length === accountActionReasonMaxLength &&
      data.audit_mode === "authorized-request-and-result" && Array.isArray(data.actions) && data.actions.length === 2 &&
      data.actions.includes("block-account") && data.actions.includes("delete-account");
  } catch { return false; }
}
