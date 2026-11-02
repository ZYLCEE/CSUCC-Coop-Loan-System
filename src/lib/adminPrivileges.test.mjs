import test from 'node:test';
import assert from 'node:assert/strict';
import { assignedPrivileges, hasAdminPrivilege, validatePrivileges } from './adminPrivileges.ts';

test('privileges default to denied, are scoped per admin, and ignore user-editable metadata', () => {
  const user = { app_metadata: { role: 'admin' }, user_metadata: { admin_privileges: ['settings.manage'] } };
  assert.equal(hasAdminPrivilege(user, 'settings.manage'), false);
  const granted = { app_metadata: { role: 'admin', admin_privileges: ['settings.manage'] } };
  assert.equal(hasAdminPrivilege(granted, 'settings.manage'), true);
  assert.equal(hasAdminPrivilege(granted, 'documents.delete'), false);
  assert.equal(hasAdminPrivilege(user, 'settings.manage'), false);
});

test('blocked, banned, member and missing accounts cannot inherit admin capabilities', () => {
  for (const user of [null, { app_metadata: { role: 'member', admin_privileges: ['settings.manage'] } },
    { app_metadata: { role: 'admin', account_status: 'blocked', admin_privileges: ['settings.manage'] } },
    { app_metadata: { role: 'super_admin' }, banned_until: '2099-01-01' }]) {
    assert.equal(hasAdminPrivilege(user, 'settings.manage'), false);
  }
  assert.equal(hasAdminPrivilege({ app_metadata: { role: 'super_admin' } }, 'settings.manage'), true);
  assert.equal(hasAdminPrivilege({ app_metadata: { role: 'coop_admin', admin_privileges: ['documents.upload'] } }, 'documents.upload'), true);
});

test('unknown privileges, duplicate entries and invalid data are rejected', () => {
  for (const value of [null, {}, ['super_admin'], ['settings.manage', 'settings.manage'], [true]]) assert.equal(validatePrivileges(value), false);
  assert.equal(validatePrivileges([]), true);
  assert.equal(validatePrivileges(['settings.manage', 'documents.upload']), true);
  assert.deepEqual(assignedPrivileges({ app_metadata: { role: 'admin', admin_privileges: ['super_admin'] } }), []);
});
