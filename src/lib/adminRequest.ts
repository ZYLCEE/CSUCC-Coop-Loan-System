import { getSupabaseClient } from './supabase';

export async function adminRequest(resource: string, init: RequestInit = {}) {
  const { data } = await getSupabaseClient().auth.getSession();
  if (!data.session) throw new Error('Sign in again to continue.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/admin/resources?resource=${encodeURIComponent(resource)}`, { ...init, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed.');
  return result;
}
