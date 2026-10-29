import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./protectedAction.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ session = true, status = 200 } = {}) {
  const calls = [];
  const client = { auth: { getSession: async () => ({ data: { session: session ? { access_token: 'test-token' } : null }, error: null }) }, functions: { invoke: async (name, options) => { calls.push({ name, ...options }); return { data: { success: true }, error: null }; } } };
  const fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(status === 200 ? { success: true, grant: 'test-grant' } : { success: false, error: 'Password verification failed.' }), { status }); };
  const exports = {};
  new Function('require', 'exports', 'fetch', code)(() => ({ getSupabaseClient: () => client }), exports, fetch);
  return { ...exports, calls };
}
test('both stages of notification actions use the dedicated authenticated endpoint', async () => {
  const f = setup();
  for (const action of ['send-notification', 'schedule-notification']) for (const mode of ['verify', 'execute']) {
    const body = { mode, action, target: 'allMembers', payload: { title: 'Test' } };
    await f.invokeProtectedAction(body);
    const call = f.calls.at(-1); assert.equal(call.url, '/api/admin/notifications');
    assert.equal(call.init.headers.Authorization, 'Bearer test-token'); assert.deepEqual(JSON.parse(call.init.body), body);
  }
});
test('other protected operations keep their existing edge service and payload', async () => {
  const f = setup(); const body = { mode: 'verify', action: 'approve-loan', target: 'APP-001', password: 'test-only', payload: {} };
  await f.invokeProtectedAction(body); assert.deepEqual(f.calls, [{ name: 'secure-admin-action', body }]);
});
test('missing sessions fail before sending and API errors remain visible in the verification dialog', async () => {
  const missing = setup({ session: false }); await assert.rejects(missing.invokeProtectedAction({ action: 'send-notification' }), /Sign in/); assert.equal(missing.calls.length, 0);
  const f = setup({ status: 401 }); const result = await f.invokeProtectedAction({ action: 'send-notification' });
  assert.equal(result.error.context.status, 401); assert.equal((await result.error.context.json()).error, 'Password verification failed.');
});
