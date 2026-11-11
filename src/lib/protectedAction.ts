import { getSupabaseClient } from './supabase';

export async function invokeProtectedAction(body: Record<string, unknown>) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('Sign in again to continue.');
  const endpoint=body.action==='send-notification'||body.action==='schedule-notification'?'/api/admin/notifications':'/api/admin/action';
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body),cache:'no-store' });
  return { data: await response.clone().json(), error: response.ok ? null : { context: response } };
}
