import { getSupabaseClient } from "./supabase";

export async function adminPrivilegeRequest(init: RequestInit = {}) {
  const { data } = await getSupabaseClient().auth.getSession();
  if (!data.session) throw new Error("Sign in again to continue.");
  const response = await fetch("/api/admin/privileges", { ...init, headers: {
    "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`,
  } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to load admin privileges.");
  return result;
}
