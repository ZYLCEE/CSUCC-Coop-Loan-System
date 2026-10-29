import test from 'node:test';
import assert from 'node:assert/strict';
import { demoNumber, repairProfile, seed } from './repair-demo-accounts.mjs';

function fixture() {
  const profile = {
    id: '2b925156-fc96-e263-45b3-980f010a5552', user_id: null,
    member_id: 'CSUCC-2025-0069', email: 'csucc.demo.0001@example.invalid',
    first_name: 'Demo Ana', last_name: 'Santos', role: 'member',
    membership_type: 'regular', department: 'Administration',
  };
  const users = [];
  const credentials = { accounts: [] };
  const state = { created: 0, writes: [], saved: false, duplicate: false, autoLink: false, linked: null };
  const client = {
    auth: { admin: { createUser: async (attributes) => {
      assert.equal(state.saved, true, 'credential must be saved before Auth creation');
      state.created++;
      return { data: { user: attributes }, error: null };
    } } },
    from(table) {
      assert.equal(table, 'members', 'financial records must never be changed');
      const query = {
        select() { return query; },
        eq(column) {
          if (column === 'user_id') return Promise.resolve({ data: state.duplicate ? [{ id: 'another-profile' }] : state.autoLink ? [{ id: profile.id }] : [], error: null });
          return query;
        },
        is() { return query; },
        update(values) { state.writes.push(values); state.linked = values.user_id; return query; },
        async maybeSingle() { return { data: { id: profile.id, user_id: state.linked }, error: null }; },
      };
      return query;
    },
  };
  return { profile, users, credentials, state, client, save: async () => { state.saved = true; } };
}

test('seed identity remains valid after database rewrites display IDs', () => {
  const { profile } = fixture();
  assert.equal(demoNumber(profile), 1);
  assert.throws(() => demoNumber({ ...profile, id: 'unrelated-id' }));
  assert.throws(() => demoNumber({ ...profile, role: 'super_admin' }));
});

test('preview cannot create Auth users, credentials or database changes', async () => {
  const f = fixture();
  assert.equal(await repairProfile(f.client, f.profile, f.users, f.credentials, f.save, false), 'would create and link demo Auth user');
  assert.equal(f.state.created, 0);
  assert.equal(f.state.saved, false);
  assert.deepEqual(f.state.writes, []);
});

test('repair creates a least-privilege member, changes only user_id, and reruns without password resets', async () => {
  const f = fixture();
  assert.equal(await repairProfile(f.client, f.profile, f.users, f.credentials, f.save, true), 'linked');
  assert.equal(f.users[0].app_metadata.role, 'member');
  assert.equal(f.users[0].app_metadata.demo_seed, seed);
  assert.equal(f.users[0].app_metadata.member_profile_id, f.profile.id);
  assert.deepEqual(f.state.writes, [{ user_id: f.users[0].id }]);
  assert.equal(f.credentials.accounts.length, 1);
  assert.equal(await repairProfile(f.client, { ...f.profile, user_id: f.users[0].id }, f.users, f.credentials, f.save, true), 'already linked');
  assert.equal(f.state.created, 1);
});

test('an existing unrelated Auth identity is never adopted or overwritten', async () => {
  const f = fixture();
  f.users.push({ id: 'existing', email: f.profile.email, app_metadata: { role: 'admin' } });
  await assert.rejects(repairProfile(f.client, f.profile, f.users, f.credentials, f.save, true), /not owned/);
  assert.equal(f.state.created, 0);
  assert.deepEqual(f.state.writes, []);
});

test('signup trigger linking the original profile counts as success without another update', async () => {
  const f = fixture();
  f.state.autoLink = true;
  assert.equal(await repairProfile(f.client, f.profile, f.users, f.credentials, f.save, true), 'linked');
  assert.equal(f.state.created, 1);
  assert.deepEqual(f.state.writes, []);
});

test('automatic duplicate profile stops repair without deleting or moving data', async () => {
  const f = fixture();
  f.state.duplicate = true;
  await assert.rejects(repairProfile(f.client, f.profile, f.users, f.credentials, f.save, true), /additional member profile/);
  assert.deepEqual(f.state.writes, []);
});

test('interrupted repair reuses its owned Auth user without creating another', async () => {
  const f = fixture();
  f.users.push({ id: 'created-in-previous-run', email: f.profile.email, app_metadata: { role: 'member', demo_seed: seed, member_profile_id: f.profile.id } });
  assert.equal(await repairProfile(f.client, f.profile, f.users, f.credentials, f.save, true), 'linked');
  assert.equal(f.state.created, 0);
  assert.deepEqual(f.state.writes, [{ user_id: 'created-in-previous-run' }]);
});
