import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./loanRelease.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const details = { application_id: 'APP-001', member_name: 'Member', amount: '1000.50', status: 'approved', date_submitted: '2026-01-01', date_approved: '2026-01-02', date_released: null };
const draft = { date: '2026-01-03', reference: ' DV-001 ', notes: 'Voucher checked' };
function setup(error = null) {
  const calls = [];
  const client = { from(table) { calls.push(table); return { select(columns) { calls.push(columns); return this; }, eq(key, value) { calls.push([key, value]); return this; }, single: async () => ({ data: details, error: null }) }; }, rpc: async (name, args) => { calls.push({ name, args }); return { data: { status: 'released' }, error }; } };
  const exports = {};
  new Function('require', 'exports', code)(() => ({ getSupabaseClient: () => client }), exports);
  return { ...exports, calls };
}
test('release preview looks up the application number rather than treating it as a database UUID', async () => {
  const f = setup(); assert.deepEqual(await f.loadLoanRelease('APP-001'), details);
  assert.deepEqual(f.calls[2], ['application_id', 'APP-001']);
});
test('release submits the recorded approval amount, reference and retry identifier without changing the amount', async () => {
  const f = setup(); await f.releaseApprovedLoan(details, draft, 'request-id');
  assert.deepEqual(f.calls, [{ name: 'release_approved_loan', args: { p_application_id: 'APP-001', p_request_id: 'request-id', p_date: '2026-01-03', p_reference: 'DV-001', p_expected_amount: '1000.50', p_notes: 'Voucher checked' } }]);
});
test('invalid dates, blank references, missing approval and already released loans do not reach the database', async () => {
  const f = setup();
  for (const date of ['bad', '2026-02-30', '2026-01-01', '2099-01-01']) await assert.rejects(f.releaseApprovedLoan(details, { ...draft, date }, 'request-id'));
  await assert.rejects(f.releaseApprovedLoan(details, { ...draft, reference: ' ' }, 'request-id'));
  await assert.rejects(f.releaseApprovedLoan({ ...details, status: 'released' }, draft, 'request-id'));
  await assert.rejects(f.releaseApprovedLoan({ ...details, date_approved: null }, draft, 'request-id'));
  await assert.rejects(f.releaseApprovedLoan({ ...details, date_released: '2026-01-03' }, draft, 'request-id'));
  assert.equal(f.calls.length, 0);
});
test('missing setup and duplicate references have actionable messages', async () => {
  await assert.rejects(setup({ code: 'PGRST202' }).releaseApprovedLoan(details, draft, 'request-id'), /database migration/);
  await assert.rejects(setup({ code: '23505' }).releaseApprovedLoan(details, draft, 'request-id'), /already used/);
  await assert.rejects(setup({ code: '42501', message: 'Super Admin access required.' }).releaseApprovedLoan(details, draft, 'request-id'), /Super Admin/);
});
