import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const payload = { title: 'Test', message: 'Isolated test message', type: 'Information', sendTo: 'allMembers', recipientCount: 5000, recipientSummary: '5000 members', scheduledAt: null, memberId: null };
const base = { action: 'send-notification', target: 'allMembers', payload };
function setup({ role = 'super_admin', status = 'active', passwordValid = true, passwordStatus = 401, insertError = null, noRecipients = false } = {}) {
  const calls = [], rows = new Map(); let pending = null;
  const user = role ? { id: 'admin-id', email: 'admin@test.invalid', app_metadata: { role, account_status: status } } : null;
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      signInWithPassword: async args => { calls.push({ verify: args.email }); return { data: { user: passwordValid ? user : null }, error: passwordValid ? null : { status: passwordStatus } }; },
      signOut: async options => { calls.push({ signOut: options }); return { error: null }; },
    },
    from(table) { assert.equal(table, 'notifications'); let selectedId;
      return {
        select() { return this; }, eq(_key, id) { selectedId = id; return this; },
        maybeSingle: async () => ({ data: rows.get(selectedId) ?? null, error: null }),
        insert(value) { pending = value; calls.push({ insert: value }); return this; },
        single: async () => {
          if (insertError) return { data: null, error: insertError };
          const row = { ...pending, recipient_count: noRecipients ? 0 : 3, status: pending.scheduled_at ? 'scheduled' : 'sent' };
          rows.set(row.id, row); return { data: row, error: null };
        },
      };
    },
  };
  const exports = {};
  new Function('require', 'exports', 'process', code)(name => name === '@supabase/supabase-js' ? { createClient: () => client } : require(name), exports, { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.test', SUPABASE_SERVICE_ROLE_KEY: 'only-a-test-signing-key', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon' } });
  const send = body => exports.POST(new Request('http://localhost/api/admin/notifications', { method: 'POST', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const verify = async (body = base) => { const response = await send({ ...body, mode: 'verify', password: 'test-only-password' }); assert.equal(response.status, 200); return (await response.json()).grant; };
  return { ...exports, send, verify, calls, rows };
}
test('password verification is separate from delivery and creates no messages', async () => {
  const f = setup(); const grant = await f.verify(); assert.ok(grant);
  assert.equal(f.rows.size, 0); assert.equal(f.calls.filter(call => call.insert).length, 0);
  assert.deepEqual(f.calls[1], { signOut: { scope: 'local' } });
});
test('only active Super Admin users can verify or execute; wrong passwords fail closed', async () => {
  for (const options of [{ role: null }, { role: 'admin' }, { role: 'member' }, { status: 'blocked' }, { status: 'inactive' }]) {
    const f = setup(options); const response = await f.send({ ...base, mode: 'verify', password: 'test' });
    assert.ok([401,403].includes(response.status)); assert.equal(f.calls.length, 0);
  }
  const f = setup({ passwordValid: false });
  assert.equal((await f.send({ ...base, mode: 'verify', password: 'wrong' })).status, 401); assert.equal(f.rows.size, 0);
  const rateLimited = setup({ passwordValid: false, passwordStatus: 429 });
  assert.equal((await rateLimited.send({ ...base, mode: 'verify', password: 'test' })).status, 429);
});
test('confirmed delivery maps database types and reports actual counts; grant replay does not insert again', async () => {
  const f = setup(); const grant = await f.verify();
  const response = await f.send({ ...base, mode: 'execute', grant }); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.result.recipientCount, 3); assert.match(body.result.message, /3 member/);
  assert.equal(f.calls.find(call => call.insert).insert.type, 'info'); assert.equal(f.calls.find(call => call.insert).insert.recipient_count, 0);
  assert.equal((await f.send({ ...base, mode: 'execute', grant })).status, 200);
  assert.equal(f.calls.filter(call => call.insert).length, 1);
});
test('a grant is bound to the complete notification, action, recipient and user', async () => {
  const f = setup(); const grant = await f.verify();
  for (const changed of [{ ...base, payload: { ...payload, message: 'changed' } }, { ...base, target: 'other' }, { ...base, action: 'schedule-notification', payload: { ...payload, scheduledAt: '2099-01-01T00:00:00Z' } }]) {
    assert.ok((await f.send({ ...changed, mode: 'execute', grant })).status >= 400);
  }
  assert.equal((await setup().send({ ...base, mode: 'execute', grant: grant + 'tampered' })).status, 401);
  assert.equal(f.rows.size, 0);
});
test('persistence errors and missing recipient delivery never claim success', async () => {
  const f = setup({ insertError: { message: 'No active linked member recipients' } }); const grant = await f.verify();
  const response = await f.send({ ...base, mode: 'execute', grant }); assert.equal(response.status, 400); assert.equal((await response.json()).success, false);
  const empty = setup({ noRecipients: true }); const emptyGrant = await empty.verify();
  assert.equal((await empty.send({ ...base, mode: 'execute', grant: emptyGrant })).status, 503);
});
test('scheduled and specific-member requests preserve their validated destinations', async () => {
  const f = setup(); const scheduled = { ...base, action: 'schedule-notification', payload: { ...payload, scheduledAt: '2099-01-01T00:00:00Z', type: 'Reminder' } };
  const grant = await f.verify(scheduled); const response = await f.send({ ...scheduled, mode: 'execute', grant });
  assert.equal((await response.json()).result.status, 'scheduled');
  const specific = { ...base, target: 'MEM-001', payload: { ...payload, sendTo: 'specificMember', memberId: 'MEM-001' } };
  const single = await f.verify(specific); assert.equal((await f.send({ ...specific, mode: 'execute', grant: single })).status, 200);
  assert.equal(f.calls.filter(call => call.insert).at(-1).insert.member_id, 'MEM-001');
});
test('unverified requests, unsupported recipients and oversized content are rejected', async () => {
  const f = setup(); assert.equal((await f.send({ ...base, mode: 'execute' })).status, 401);
  for (const changed of [{ ...base, payload: { ...payload, sendTo: 'selectedMembers' } }, { ...base, payload: { ...payload, type: '__proto__' } }, { ...base, payload: { ...payload, message: 'x'.repeat(10001) } }]) assert.equal((await f.send({ ...changed, mode: 'verify', password: 'test' })).status, 400);
  assert.equal(f.calls.length, 0);
});
