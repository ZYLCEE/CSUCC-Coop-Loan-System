import { getSupabaseClient } from './supabase';

export async function invokeProtectedAction(body: Record<string, unknown>) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('Sign in again to continue.');
  const endpoint=body.action==='send-notification'||body.action==='schedule-notification'?'/api/admin/notifications':'/api/admin/action';
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body),cache:'no-store' });
  let result: Record<string, unknown> | null = null;
  try {
    const payload: unknown = await response.clone().json();
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      result = payload as Record<string, unknown>;
    }
  } catch {
    // Next can return an HTML 404 page while its dev route manifest is stale.
  }
  return { data: result, error: response.ok && result ? null : { context: response } };
}
