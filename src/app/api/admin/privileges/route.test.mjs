import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as privilegesModule from '../../../../lib/adminPrivileges.ts';

const code = ts.transpileModule(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const targetId = '11111111-1111-4111-8111-111111111111';
function setup({ callerRole = 'super_admin', targetRole = 'admin', status = 'active', passwordValid = true, auditError = null, version = null } = {}) {
  const calls = [];
  const actor = { id: 'super-id', email: 'super@example.invalid', app_metadata: { role: callerRole }, user_metadata: {} };
  let target = { id: targetId, email: 'admin@example.invalid', app_metadata: { role: targetRole, account_status: status, preserved: 'unchanged', admin_privileges_version: version }, user_metadata: { full_name: 'Test Admin' } };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: actor }, error: null }),
      signInWithPassword: async () => ({ data: { user: passwordValid ? actor : null }, error: passwordValid ? null : { status: 401 } }),
      signOut: async () => ({ error: null }),
      admin: {
        listUsers: async ({ page }) => ({ data: { users: page === 1 ? [target, actor] : [] }, error: null }),
        getUserById: async id => ({ data: { user: id === targetId ? structuredClone(target) : null }, error: null }),
        updateUserById: async (id, data) => { calls.push({ id, ...data }); target = { ...target, ...data }; return { data: { user: target }, error: null }; },
      },
    },
    from: () => ({ insert: async row => { calls.push({ audit: row }); return { error: auditError }; } }),
  };
  const exports = {};
  new Function('require', 'exports', 'process', code)(name => name === '@/lib/adminPrivileges' ? privilegesModule : { createClient: () => client }, exports,
    { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key' } });
  const request = (method = 'PUT', body = {}) => new Request('http://localhost/api/admin/privileges', { method,
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify({ userId: targetId, privileges: ['documents.upload'], version, password: 'test-only', ...body }) }) });
  return { ...exports, calls, request, actor, getTarget: () => target };
}

test('only Super Admin can read or change privileges, including direct API requests', async () => {
  for (const callerRole of ['admin', 'coop_admin', 'member', null]) {
    const f = setup({ callerRole });
    assert.equal((await f.GET(f.request('GET'))).status, 403);
    assert.equal((await f.PUT(f.request())).status, 403);
    assert.equal(f.calls.length, 0);
  }
  const f = setup();
  assert.equal((await f.GET(new Request('http://localhost/api/admin/privileges'))).status, 401);
});

test('listing returns only admin accounts and does not expose credentials or metadata', async () => {
  const f = setup(); const response = await f.GET(f.request('GET'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { accounts } = await response.json();
  assert.equal(accounts.length, 1); assert.equal(accounts[0].id, targetId);
  assert.equal('app_metadata' in accounts[0], false); assert.deepEqual(accounts[0].privileges, []);
});

test('password-verified grants persist per admin and preserve unrelated metadata', async () => {
  const f = setup(); const response = await f.PUT(f.request());
  assert.equal(response.status, 200); const saved = await response.json();
  assert.equal(saved.success, true); assert.ok(saved.version);
  assert.equal(f.getTarget().app_metadata.role, 'admin');
  assert.equal(f.getTarget().app_metadata.preserved, 'unchanged');
  assert.deepEqual(f.getTarget().app_metadata.admin_privileges, ['documents.upload']);
  assert.equal(f.calls[1].audit.action_name, 'update-admin-privileges');
  assert.deepEqual(f.calls[1].audit.details.before, []);
  assert.equal((await f.PUT(f.request('PUT', { privileges: [] }))).status, 409);
  const revoked = await f.PUT(f.request('PUT', { privileges: [], version: saved.version }));
  assert.equal(revoked.status, 200); assert.deepEqual(f.getTarget().app_metadata.admin_privileges, []);
});

test('member/Super Admin targets, inactive accounts, unknown keys and wrong passwords cannot change privileges', async () => {
  for (const options of [{ targetRole: 'member' }, { targetRole: 'super_admin' }, { status: 'blocked' }, { passwordValid: false }]) {
    const f = setup(options); assert.ok((await f.PUT(f.request())).status >= 400); assert.equal(f.calls.length, 0);
  }
  for (const privileges of [['loan.approve'], ['settings.manage', 'settings.manage'], 'settings.manage']) {
    const f = setup(); assert.equal((await f.PUT(f.request('PUT', { privileges }))).status, 400); assert.equal(f.calls.length, 0);
  }
});

test('an audit failure is reported without pretending the saved permissions failed', async () => {
  const f = setup({ auditError: { message: 'unavailable' } });
  const response = await f.PUT(f.request()); assert.equal(response.status, 200);
  assert.match((await response.json()).warning, /audit log/);
});
