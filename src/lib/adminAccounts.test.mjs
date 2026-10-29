import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./adminAccounts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const success = { data: { success: true, accounts: [], dataIntegrityIssues: 0 }, error: null };
const rejected = (status = 401) => ({ data: null, error: { context: new Response(JSON.stringify({ error: { code: status === 403 ? 'forbidden' : 'session_expired' } }), { status }) } });
function setup({ replies = [success], refreshError = null, validUser = false, session = true } = {}) {
  const calls = [];
  const client = { auth: {
    getSession: async () => ({ data: { session: session ? { access_token: 'old' } : null }, error: null }),
    refreshSession: async () => { calls.push('refresh'); return { data: { session: refreshError ? null : { access_token: 'fresh' } }, error: refreshError }; },
    getUser: async () => ({ data: { user: validUser ? { id: 'admin' } : null }, error: validUser ? null : new Error('Invalid session') }),
  }, functions: { invoke: async (_name, options) => { calls.push(options.headers.Authorization); return replies.shift() ?? success; } } };
  const exports = {};
  new Function('require', 'exports', code)(name => name.includes('MembersData') ? { normalizedMemberRoles: new Set(['Member', 'Admin', 'Super Admin']) } : { getSupabaseClient: () => client }, exports);
  return { ...exports, calls };
}
test('overlapping account loads share one refresh and retry with the new token', async () => {
  const f = setup({ replies: [rejected(), success] });
  const first = f.fetchAdminAccounts(), second = f.fetchAdminAccounts();
  assert.equal(first, second); await Promise.all([first, second]);
  assert.deepEqual(f.calls, ['Bearer old', 'refresh', 'Bearer fresh']);
  await f.fetchAdminAccounts(); assert.equal(f.calls.length, 4);
});
test('expired refresh credentials produce a recoverable session error', async () => {
  const f = setup({ replies: [rejected()], refreshError: { status: 400 } });
  await assert.rejects(f.fetchAdminAccounts(), { code: 'session_expired' });
});
test('network failure during refresh does not claim the user session has expired', async () => {
  const f = setup({ replies: [rejected()], refreshError: { status: 503 } });
  await assert.rejects(f.fetchAdminAccounts(), { code: 'network_failure' });
});
test('a service rejection of a valid refreshed user is distinguished from an expired session', async () => {
  const f = setup({ replies: [rejected(), rejected()], validUser: true });
  await assert.rejects(f.fetchAdminAccounts(), { code: 'service_auth_failure' });
});
test('a repeatedly rejected invalid user is prompted to sign in and retries remain bounded', async () => {
  const f = setup({ replies: [rejected(), rejected()] });
  await assert.rejects(f.fetchAdminAccounts(), { code: 'session_expired' });
  assert.equal(f.calls.length, 3);
});
test('access denials never refresh tokens and missing sessions never call the account service', async () => {
  const f = setup({ replies: [rejected(403)] });
  await assert.rejects(f.fetchAdminAccounts(), { code: 'unauthorized' });
  assert.deepEqual(f.calls, ['Bearer old']);
  const missing = setup({ session: false });
  await assert.rejects(missing.fetchAdminAccounts(), { code: 'session_expired' });
  assert.deepEqual(missing.calls, []);
});
