import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./loanRelease.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const details = { application_id: 'APP-001', member_name: 'Member', amount: '1000.50', status: 'approved', date_submitted: '2026-01-01', date_approved: '2026-01-02', date_released: null };
const policy = { base_interest_rate: 2, processing_fee_percent: 1, service_fee_percent: 0.5 };
const draft = { date: '2026-01-03', reference: ' DV-001 ', notes: 'Voucher checked' };
function setup(error = null) {
  const calls = [];
  const client = { from(table) { calls.push(table); return { select(columns) { calls.push(columns); return this; }, eq(key, value) { calls.push([key, value]); return this; }, single: async () => ({ data: table === 'loan_policy_settings' ? policy : details, error: null }) }; }, rpc: async (name, args) => { calls.push({ name, args }); return { data: { status: 'released' }, error }; } };
  const exports = {};
  new Function('require', 'exports', code)(name => name.includes('committeeReviewRequest') ? {reviewRequest:async(_query,init,endpoint)=>{const body=JSON.parse(init.body);calls.push({endpoint,body});if(error)throw new Error(error.message??(error.code==='23505'?'Reference already used.':error.code==='PGRST202'?'Apply the database migration.':'Release failed.'));return {status:'released'};}} : ({ getSupabaseClient: () => client }), exports);
  return { ...exports, calls };
}
test('release preview loads policy rates and looks up the application number', async () => {
  const f = setup();
  assert.deepEqual(await f.loadLoanRelease('APP-001'), { ...details, ...policy });
  assert.deepEqual(f.calls.slice(0, 6), [
    'loan_applications', 'application_id,member_name,amount,status,date_submitted,date_approved,date_released', ['application_id', 'APP-001'],
    'loan_policy_settings', 'base_interest_rate,processing_fee_percent,service_fee_percent', ['singleton', true],
  ]);
});
test('release submits the recorded approval amount, reference and retry identifier without changing the amount', async () => {
  const f = setup(); await f.releaseApprovedLoan(details, draft, 'request-id', 'Synthetic-Password1!');
  assert.deepEqual(f.calls, [{endpoint:'/api/admin/loan-release',body:{applicationId:'APP-001',requestId:'request-id',date:'2026-01-03',reference:'DV-001',amount:'1000.50',notes:'Voucher checked',password:'Synthetic-Password1!'}}]);
});
test('release fee preview rounds one-time fees to cents and subtracts them from proceeds', () => {
  assert.deepEqual(setup().releaseChargePreview({ ...details, ...policy }), {
    processingFee: 10.01, serviceFee: 5, netProceeds: 985.49,
  });
});
test('invalid dates, blank references, missing approval and already released loans do not reach the database', async () => {
  const f = setup();
  for (const date of ['bad', '2026-02-30', '2026-01-01', '2099-01-01']) await assert.rejects(f.releaseApprovedLoan(details, { ...draft, date }, 'request-id'));
  await assert.rejects(f.releaseApprovedLoan(details, { ...draft, reference: ' ' }, 'request-id'));
  await assert.rejects(f.releaseApprovedLoan({ ...details, status: 'released' }, draft, 'request-id', 'Synthetic-Password1!'));
  await assert.rejects(f.releaseApprovedLoan({ ...details, date_approved: null }, draft, 'request-id', 'Synthetic-Password1!'));
  await assert.rejects(f.releaseApprovedLoan({ ...details, date_released: '2026-01-03' }, draft, 'request-id', 'Synthetic-Password1!'));
  assert.equal(f.calls.length, 0);
});
test('missing setup and duplicate references have actionable messages', async () => {
  await assert.rejects(setup({ code: 'PGRST202' }).releaseApprovedLoan(details, draft, 'request-id', 'Synthetic-Password1!'), /database migration/);
  await assert.rejects(setup({ code: '23505' }).releaseApprovedLoan(details, draft, 'request-id', 'Synthetic-Password1!'), /already used/);
  await assert.rejects(setup({ code: '42501', message: 'Super Admin access required.' }).releaseApprovedLoan(details, draft, 'request-id', 'Synthetic-Password1!'), /Super Admin/);
});
