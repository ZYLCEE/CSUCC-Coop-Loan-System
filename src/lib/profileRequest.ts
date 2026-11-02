import { getSupabaseClient } from "./supabase";

export async function profileRequest(init: RequestInit = {}) {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error || !data.session) throw new Error("Your session expired. Sign in again.");
  const response = await fetch("/api/admin/profile", { ...init, headers: {
    "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}`,
  } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to update your account.");
  return result;
}
