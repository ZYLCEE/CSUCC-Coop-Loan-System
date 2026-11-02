import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as privilegesModule from '../../../../lib/adminPrivileges.ts';
import * as profileModule from '../../../../lib/profileModel.ts';

const code = ts.transpileModule(readFileSync(new URL('./route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const profile = { first_name: 'Test', last_name: 'Admin', phone: '+63 912 345 6789', department: 'Finance', position: 'Officer' };
const passwords = { current: 'Old!Pass1', next: 'New!Pass2', confirm: 'New!Pass2' };

function setup({ role = 'super_admin', status = 'active', member = null, memberError = null, passwordValid = true, verifiedId = 'self', updateError = null, authUpdateError = null, auditError = null, emailImmediate = false } = {}) {
  const calls = [];
  const user = { id: 'self', email: 'self@test.invalid', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-11-03T01:00:00Z', email_confirmed_at: '2026-01-01',
    app_metadata: { role, account_status: status }, user_metadata: { first_name: 'Existing', last_name: 'Admin', preserved: 'keep' } };
  const client = {
    auth: { getUser: async () => ({ data: { user: role ? user : null }, error: null }), admin: {
      updateUserById: async (id, attrs) => { calls.push({ authUpdate: { id, attrs } }); if (!authUpdateError) user.user_metadata = attrs.user_metadata; return { data: { user }, error: authUpdateError }; },
    } },
    from(table) {
      const filters = []; let fields;
      return {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, order() { return this; },
        maybeSingle: async () => { calls.push({ lookup: table, filters }); return { data: member, error: memberError }; },
        update(data) { fields = data; return this; },
        single: async () => { calls.push({ memberUpdate: { fields, filters } }); return { data: { id: member?.id }, error: updateError }; },
        limit: async () => { calls.push({ activity: table, filters }); return { data: [{ id: 'event', action_name: 'update-own-profile', result: 'success', created_at: '2026-11-03' }], error: auditError }; },
        insert: async data => { calls.push({ audit: data }); return { error: auditError }; },
      };
    },
  };
  const verifier = { auth: {
    signInWithPassword: async args => { calls.push({ verifyEmail: args.email }); return { data: { user: passwordValid ? { ...user, id: verifiedId } : null, session: passwordValid ? {} : null }, error: passwordValid ? null : { status: 401 } }; },
    updateUser: async attrs => { calls.push(attrs.email ? { emailUpdate: attrs } : { passwordUpdate: attrs }); return { data: { user: attrs.email ? { ...user, ...(emailImmediate ? { email: attrs.email } : { new_email: attrs.email }) } : user }, error: updateError }; },
    signOut: async options => { calls.push({ temporarySignOut: options }); return { error: null }; },
  } };
  const exports = {};
  new Function('require', 'exports', 'process', code)(name => name === '@/lib/adminPrivileges' ? privilegesModule : name === '@/lib/profileModel' ? profileModule : {
    createClient: (_url, key) => key === 'test-service-key' ? client : verifier,
  }, exports, { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key' } });
  const request = (method = 'GET', body) => new Request('http://localhost/api/admin/profile', { method, headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { ...exports, calls, user, request };
}

test('both admin roles can load their profile without a linked member record', async () => {
  for (const role of ['admin', 'coop_admin', 'super_admin']) {
    const f = setup({ role }); const response = await f.GET(f.request()); const data = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(data.profile.first_name, 'Existing'); assert.equal(data.memberLinked, false);
    assert.equal(data.account.id, 'self'); assert.equal('app_metadata' in data.account, false);
    assert.deepEqual(f.calls.find(call => call.activity).filters, [['actor_id', 'self']]);
  }
});
test('missing, member and inactive sessions cannot read or change admin profiles', async () => {
  for (const options of [{ role: null }, { role: 'member' }, { status: 'blocked' }]) {
    const f = setup(options);
    for (const [method, body] of [['GET'], ['PUT', profile], ['POST', passwords]]) assert.ok((await f[method](f.request(method, body))).status >= 400);
    assert.equal(f.calls.length, 0);
  }
  const f = setup(); assert.equal((await f.GET(new Request('http://localhost/api/admin/profile'))).status, 401);
});
test('profile save persists Auth metadata without creating a member or changing account privileges', async () => {
  const f = setup(); const response = await f.PUT(f.request('PUT', profile)); assert.equal(response.status, 200);
  assert.deepEqual(f.user.app_metadata, { role: 'super_admin', account_status: 'active' });
  assert.equal(f.user.user_metadata.full_name, 'Test Admin'); assert.equal(f.user.user_metadata.preserved, 'keep');
  assert.equal(f.calls.find(call => call.authUpdate).authUpdate.id, 'self');
  assert.equal(f.calls.some(call => call.memberUpdate), false);
  assert.equal(f.calls.at(-1).audit.action_name, 'update-own-profile');
});
test('linked profiles are scoped to the signed-in user and synchronized with Auth', async () => {
  const f = setup({ member: { id: 'member-self', ...profile } });
  assert.equal((await f.PUT(f.request('PUT', profile))).status, 200);
  const write = f.calls.find(call => call.memberUpdate).memberUpdate;
  assert.deepEqual(write.filters, [['id', 'member-self'], ['user_id', 'self']]);
  assert.equal('position' in write.fields, false);
});
test('invalid fields, failed writes and partial synchronization return actionable errors', async () => {
  for (const body of [{ ...profile, userId: 'another' }, { ...profile, role: 'admin' }, { ...profile, first_name: '' }]) {
    const f = setup(); assert.equal((await f.PUT(f.request('PUT', body))).status, 400); assert.equal(f.calls.some(call => call.authUpdate), false);
  }
  const failed = setup({ member: { id: 'linked' }, updateError: { message: 'denied' } });
  assert.equal((await failed.PUT(failed.request('PUT', profile))).status, 503); assert.equal(failed.calls.some(call => call.authUpdate), false);
  const partial = setup({ member: { id: 'linked' }, authUpdateError: { message: 'unavailable' } });
  const response = await partial.PUT(partial.request('PUT', profile)); assert.equal(response.status, 503); assert.match((await response.json()).error, /synchronized/);
});
test('password update verifies identity and current password through an isolated session', async () => {
  const f = setup(); assert.equal((await f.POST(f.request('POST', passwords))).status, 200);
  assert.equal(f.calls[0].verifyEmail, f.user.email);
  assert.deepEqual(f.calls.find(call => call.passwordUpdate).passwordUpdate, { password: passwords.next, current_password: passwords.current });
  assert.deepEqual(f.calls.find(call => call.temporarySignOut).temporarySignOut, { scope: 'local' });
  assert.deepEqual(f.calls.at(-1).audit.details, {});
  assert.equal(f.calls.some(call => call.authUpdate), false);
});
test('wrong passwords, another verified identity, mismatches and Auth failures never claim a password changed', async () => {
  for (const options of [{ passwordValid: false }, { verifiedId: 'other' }, { updateError: { code: 'weak_password' } }]) {
    const f = setup(options); assert.ok((await f.POST(f.request('POST', passwords))).status >= 400);
    assert.equal(f.calls.some(call => call.audit), false);
    if (!options.updateError) assert.equal(f.calls.some(call => call.passwordUpdate), false);
  }
  const f = setup(); assert.equal((await f.POST(f.request('POST', { ...passwords, confirm: 'wrong' }))).status, 400); assert.equal(f.calls.length, 0);
});
test('activity failures do not prevent loading profiles or hide successful updates', async () => {
  const f = setup({ auditError: { message: 'unavailable' } }); const response = await f.GET(f.request());
  assert.equal(response.status, 200); assert.equal((await response.json()).activityUnavailable, true);
  assert.match((await (await f.PUT(f.request('PUT', profile))).json()).warning, /activity log/);
  assert.match((await (await f.POST(f.request('POST', passwords))).json()).warning, /activity log/);
});

test('Super Admin email changes verify the current password and preserve pending confirmation', async () => {
  const f = setup(); const response = await f.PATCH(f.request('PATCH', { email: ' New@Example.com ', current: 'test-only' }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.confirmationRequired, true); assert.equal(result.email, 'self@test.invalid'); assert.equal(result.pendingEmail, 'new@example.com');
  assert.deepEqual(f.calls.find(call => call.emailUpdate).emailUpdate, { email: 'new@example.com' });
  assert.equal(f.calls.some(call => call.authUpdate), false);
  assert.equal(f.calls.find(call => call.audit).audit.action_name, 'request-own-email-change');
  assert.deepEqual(f.calls.at(-1).temporarySignOut, { scope: 'local' });
});

test('email requests deny non-super admins, wrong passwords, invalid addresses and identity overrides', async () => {
  for (const options of [{ role: 'admin' }, { role: 'coop_admin' }, { status: 'blocked' }, { passwordValid: false }, { verifiedId: 'other' }]) {
    const f = setup(options); assert.ok((await f.PATCH(f.request('PATCH', { email: 'new@example.com', current: 'test-only' }))).status >= 400);
    assert.equal(f.calls.some(call => call.emailUpdate || call.authUpdate), false);
  }
  for (const body of [{ email: 'invalid', current: 'test-only' }, { email: 'self@test.invalid', current: 'test-only' }, { email: 'new@example.com', current: 'test-only', userId: 'other' }]) {
    const f = setup(); assert.equal((await f.PATCH(f.request('PATCH', body))).status, 400); assert.equal(f.calls.length, 0);
  }
  const f = setup({ updateError: { code: 'email_exists' } });
  assert.equal((await f.PATCH(f.request('PATCH', { email: 'used@example.com', current: 'test-only' }))).status, 409);
  assert.equal(f.calls.some(call => call.audit), false);
});

test('Auth-confirmed immediate changes are reported accurately without bypassing confirmation', async () => {
  const f = setup({ emailImmediate: true }); const response = await f.PATCH(f.request('PATCH', { email: 'new@example.com', current: 'test-only' }));
  const result = await response.json(); assert.equal(result.confirmationRequired, false); assert.equal(result.email, 'new@example.com'); assert.equal(result.pendingEmail, null);
});

test('email delivery failures return the actual Auth error code and a useful explanation', async () => {
  const f = setup({ updateError: { code: 'email_address_not_authorized', status: 403 } });
  const response = await f.PATCH(f.request('PATCH', { email: 'new@example.com', current: 'test-only' }));
  assert.equal(response.status, 503);
  const result = await response.json(); assert.equal(result.code, 'email_address_not_authorized'); assert.match(result.error, /custom SMTP/);
  assert.equal(f.calls.some(call => call.audit), false);
});
