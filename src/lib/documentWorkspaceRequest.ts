import { getSupabaseClient } from "./supabase";

export async function documentsRequest<T>(query = "", init: RequestInit = {}): Promise<T> {
  const { data } = await getSupabaseClient().auth.getSession();
  if (!data.session) throw new Error("Your session expired. Sign in again.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + data.session.access_token);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch("/api/admin/documents" + (query ? "?" + query : ""), { ...init, headers, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The document request could not be completed.");
  return result as T;
}
