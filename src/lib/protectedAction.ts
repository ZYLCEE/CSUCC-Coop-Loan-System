import { getSupabaseClient } from './supabase';

export async function invokeProtectedAction(body: Record<string, unknown>) {
  const client = getSupabaseClient();
  if (body.action !== 'send-notification' && body.action !== 'schedule-notification') {
    return client.functions.invoke('secure-admin-action', { body });
  }
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('Sign in again to continue.');
  const response = await fetch('/api/admin/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body) });
  return { data: await response.clone().json(), error: response.ok ? null : { context: response } };
}
