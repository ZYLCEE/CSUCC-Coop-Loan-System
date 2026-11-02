import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, validatePasswordChange, validateEmailChange, emailChangeFailure } from './profileModel.ts';

const profile = { first_name: 'Test', last_name: 'Admin', phone: '+63 912 345 6789', department: 'Finance', position: 'Officer' };
test('profile edits normalize whitespace and accept international names and contact numbers', () => {
  assert.deepEqual(validateProfile({ ...profile, first_name: '  María  ' }), { ...profile, first_name: 'María' });
  assert.equal(validateProfile({ ...profile, phone: '' }).phone, '');
});
test('invalid personal data and attempts to edit access or identity are rejected', () => {
  for (const value of [null, [], { ...profile, role: 'super_admin' }, { ...profile, userId: 'other' }, { ...profile, email: 'other@test.invalid' },
    { ...profile, first_name: ' ' }, { ...profile, phone: '123' }, { ...profile, department: 'x'.repeat(101) }, { ...profile, last_name: 'Last\nName' }]) {
    assert.throws(() => validateProfile(value));
  }
});
test('password changes require matching, strong, different passwords and never trim them', () => {
  const value = { current: 'Old!Pass1', next: 'New!Pass2', confirm: 'New!Pass2' };
  assert.deepEqual(validatePasswordChange(value), value);
  for (const invalid of [{ ...value, current: '' }, { ...value, confirm: 'wrong' }, { ...value, next: 'weak', confirm: 'weak' },
    { ...value, current: value.next }, { ...value, userId: 'other' }]) assert.throws(() => validatePasswordChange(invalid));
});

test('email changes validate the address and password and reject identity overrides', () => {
  assert.deepEqual(validateEmailChange({ email: ' New@Example.com ', current: ' Password ' }), { email: 'new@example.com', current: ' Password ' });
  for (const value of [null, { email: 'invalid', current: 'password' }, { email: 'new@example.com', current: '' },
    { email: 'new@example.com', current: 'password', userId: 'other' }, { email: 'new\n@example.com', current: 'password' }]) assert.throws(() => validateEmailChange(value));
});

test('email-change errors distinguish delivery configuration, rate limits and account conflicts', () => {
  assert.equal(emailChangeFailure({ code: 'email_exists' }).status, 409);
  assert.match(emailChangeFailure({ code: 'email_address_not_authorized' }).error, /custom SMTP/);
  assert.equal(emailChangeFailure({ code: 'over_email_send_rate_limit' }).status, 429);
  assert.match(emailChangeFailure({ code: 'unexpected_failure', message: 'Error sending change email' }).error, /could not send/);
  assert.match(emailChangeFailure({ code: 'validation_failed', message: 'Email changes disabled by provider' }).error, /Email changes disabled by provider/);
  assert.equal(emailChangeFailure(null).status, 502);
});
