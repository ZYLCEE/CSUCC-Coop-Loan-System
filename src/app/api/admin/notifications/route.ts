import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
const types: Record<string, string> = { Information: 'info', Reminder: 'warning', Approval: 'loan_approval', Rejection: 'loan_rejection', Maintenance: 'warning', Emergency: 'error' };
type Payload = { title: string; message: string; type: string; sendTo: string; memberId: string | null; scheduledAt: string | null };
type Grant = { id: string; user: string; fingerprint: string; expires: number };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reply = (data: object, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

function normalize(body: Record<string, unknown>): Payload {
  const p = body.payload;
  if (!record(p) || !['send-notification', 'schedule-notification'].includes(String(body.action))) throw new Error('Unsupported notification request.');
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.trim().length > 200 || typeof p.message !== 'string' || !p.message.trim() || p.message.trim().length > 10000) throw new Error('Enter a title of up to 200 characters and a message of up to 10,000 characters.');
  if (typeof p.type !== 'string' || !Object.hasOwn(types, p.type)) throw new Error('Unsupported notification type.');
  if (!['allMembers', 'specificMember'].includes(String(p.sendTo))) throw new Error('Unsupported recipient selection.');
  const memberId = p.sendTo === 'specificMember' && typeof p.memberId === 'string' ? p.memberId.trim() : null;
  if (p.sendTo === 'specificMember' && (!memberId || memberId.length > 80)) throw new Error('Choose a member recipient.');
  if (body.target !== (memberId ?? p.sendTo)) throw new Error('Recipient selection does not match the verified target.');
  let scheduledAt: string | null = null;
  if (body.action === 'schedule-notification') {
    if (typeof p.scheduledAt !== 'string' || !Number.isFinite(Date.parse(p.scheduledAt)) || Date.parse(p.scheduledAt) <= Date.now()) throw new Error('Choose a valid future schedule.');
    scheduledAt = new Date(p.scheduledAt).toISOString();
  } else if (p.scheduledAt != null) throw new Error('Send Now cannot include a future schedule.');
  return { title: p.title.trim(), message: p.message.trim(), type: types[p.type], sendTo: String(p.sendTo), memberId, scheduledAt };
}
const fingerprint = (body: Record<string, unknown>, payload: Payload) => createHash('sha256').update(JSON.stringify([body.action, body.target, payload])).digest('hex');
const signature = (encoded: string, key: string) => createHmac('sha256', key).update(`coop-notification-verification-v1\0${encoded}`).digest();
function readGrant(value: unknown, key: string): Grant | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  const [encoded, signed, extra] = value.split('.');
  if (!encoded || !signed || extra !== undefined) return null;
  const actual = Buffer.from(signed, 'base64url'), expected = signature(encoded, key);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const g: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!record(g) || typeof g.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(g.id) || typeof g.user !== 'string' || typeof g.fingerprint !== 'string' || typeof g.expires !== 'number' || g.expires <= Date.now()) return null;
    return g as Grant;
  } catch { return null; }
}

export async function POST(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return fail('Server-side notification configuration is missing.', 503);
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return fail('Sign in again to continue.', 401);
    const { data: { user }, error: userError } = await client.auth.getUser(token);
    if (userError || !user) return fail('Your session expired. Sign in again.', 401);
    if (user.app_metadata.role !== 'super_admin' || (user.app_metadata.account_status && user.app_metadata.account_status !== 'active') || ('banned_until' in user && typeof user.banned_until === 'string' && Date.parse(user.banned_until) > Date.now())) return fail('Active Super Admin access required.', 403);
    const raw = await request.text();
    if (raw.length > 40000) return fail('Notification request is too large.');
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return fail('Invalid notification request.'); }
    if (!record(body) || !['verify', 'execute'].includes(String(body.mode))) return fail('Invalid notification request.');
    const payload = normalize(body), digest = fingerprint(body, payload);
    if (body.mode === 'verify') {
      if (!user.email || typeof body.password !== 'string' || !body.password || body.password.length > 1024) return fail('Enter your account password.');
      // A separate Auth client prevents verification from replacing the browser session.
      const verifier = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await verifier.auth.signInWithPassword({ email: user.email, password: body.password });
      if (error || data.user?.id !== user.id) return fail(error?.status === 429 ? 'Too many verification attempts. Wait before retrying.' : 'Your account password could not be verified.', error?.status === 429 ? 429 : 401);
      // Revoke only the temporary verification session, never the user's active sessions.
      await verifier.auth.signOut({ scope: 'local' });
      const grant: Grant = { id: randomUUID(), user: user.id, fingerprint: digest, expires: Date.now() + 5 * 60 * 1000 };
      const encoded = Buffer.from(JSON.stringify(grant)).toString('base64url');
      return reply({ success: true, grant: `${encoded}.${signature(encoded, key).toString('base64url')}` });
    }
    const grant = readGrant(body.grant, key);
    if (!grant || grant.user !== user.id || grant.fingerprint !== digest) return fail('Verification expired or the notification changed. Verify your password again.', 401);

    const result = (row: { id: string; status: string; recipient_count: number | null }) => {
      if (!['sent', 'scheduled'].includes(row.status) || (row.status === 'sent' && (!Number.isSafeInteger(row.recipient_count) || !(Number(row.recipient_count) > 0)))) return fail('The delivery service did not confirm recipients. Check outgoing history.', 503);
      return reply({ success: true, result: { id: row.id, status: row.status,
        recipientCount: row.recipient_count, message: row.status === 'scheduled' ? 'Notification scheduled. Recipients are calculated when it is delivered.' : `Notification delivered to ${row.recipient_count} member(s).` } });
    };
    // Reusing the verified UUID hits the same outbox row. The unique primary key
    // rolls back concurrent inserts, including trigger-created inbox entries.
    const existing = await client.from('notifications').select('id,status,recipient_count').eq('id', grant.id).maybeSingle();
    if (existing.error) return fail('Unable to check delivery history. Retry without changing your notification.', 503);
    if (existing.data) return ['sent', 'scheduled'].includes(existing.data.status) ? result(existing.data) : fail('The recorded request did not complete delivery. Check outgoing history.', 409);
    const saved = await client.from('notifications').insert({ id: grant.id, user_id: null, title: payload.title, message: payload.message, type: payload.type,
      send_to: payload.sendTo, member_id: payload.memberId, recipient_count: 0, recipient_summary: 'Pending delivery', scheduled_at: payload.scheduledAt,
      status: payload.scheduledAt ? 'scheduled' : 'sent' }).select('id,status,recipient_count').single();
    if (saved.error) {
      if (saved.error.code === '23505') {
        const retry = await client.from('notifications').select('id,status,recipient_count').eq('id', grant.id).maybeSingle();
        if (!retry.error && retry.data && ['sent', 'scheduled'].includes(retry.data.status)) return result(retry.data);
      }
      return fail(saved.error.message || 'Notification delivery failed. Check outgoing history before retrying.');
    }
    if (!saved.data || !['sent', 'scheduled'].includes(saved.data.status) || (saved.data.status === 'sent' && !(saved.data.recipient_count > 0))) return fail('The delivery service did not confirm recipients. Check outgoing history.', 503);
    return result(saved.data);
  } catch (error) { return fail(error instanceof Error ? error.message : 'Notification request failed.'); }
}
