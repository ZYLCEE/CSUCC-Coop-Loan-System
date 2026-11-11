import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}
const { monthlyRepayments, paymentMonthKey, paymentDateLabel, recordedAtLabel } = load('./repaymentDetails.ts');
const receipt = (date, amount, overrides = {}) => ({ id: date, payment_date: date, payment_amount: amount,
  principal_amount: amount, interest_amount: 0, penalty_amount: 0, fee_amount: 0, payment_status: 'posted', ...overrides });

test('monthly totals combine receipts by payment date and exclude reversed payments', () => {
  const months = monthlyRepayments([
    receipt('2026-10-25', 1000, { principal_amount: 800, interest_amount: 200 }),
    receipt('2026-11-08', 1600, { principal_amount: 1200, interest_amount: 400, created_at: '2026-12-01T00:00:00Z' }),
    receipt('2026-11-10', 1000),
    receipt('2026-11-05', 500, { payment_status: 'reversed' }),
  ]);
  assert.deepEqual(months.map(month => month.key), ['2026-11', '2026-10']);
  assert.equal(months[0].amount, 2600);
  assert.equal(months[0].principal, 2200);
  assert.equal(months[0].interest, 400);
  assert.equal(months[0].postedReceipts, 2);
  assert.equal(months[0].reversedReceipts, 1);
  assert.equal(months[1].amount, 1000);
  assert.equal(months[1].label, 'October 2026');
});

test('calendar summaries retain exact centavos and do not invent legacy allocations', () => {
  assert.equal(monthlyRepayments([receipt('2026-11-01', 0.1), receipt('2026-11-02', 0.2)])[0].amount, 0.3);
  const unknown = monthlyRepayments([receipt('2026-11-01', 500, { principal_amount: null }), receipt('2026-11-02', 1000)])[0];
  assert.equal(unknown.amount, 1500);
  assert.equal(unknown.principal, null);
  const reversed = monthlyRepayments([receipt('2026-11-01', 500, { payment_status: 'reversed' })])[0];
  assert.equal(reversed.amount, 0);
  assert.equal(reversed.postedReceipts, 0);
  assert.equal(reversed.reversedReceipts, 1);
});

test('payment date and recording time are distinct and explicitly use Philippine time', () => {
  assert.equal(paymentDateLabel('2026-11-08'), 'November 8, 2026');
  const recorded = recordedAtLabel('2026-11-10T06:30:45Z');
  assert.match(recorded, /Nov 10, 2026/);
  assert.match(recorded, /2:30:45/);
  assert.ok(recorded.endsWith('PHT'));
  assert.match(recordedAtLabel('2026-01-31T23:15:30Z'), /Feb 1, 2026/);
  assert.equal(paymentMonthKey('2026-01-31'), '2026-01');
  for (const value of [null, undefined, '', 'bad', '2026-11-08', '2026-11-08T10:30:00']) assert.equal(recordedAtLabel(value), 'Time not recorded');
  for (const value of ['', '2026-02-30', '2026-13-01', '2026-11-01T00:00:00Z']) assert.equal(paymentMonthKey(value), 'unrecorded');
});

test('repayment details use the protected ledger and terms for the selected loan only', async () => {
  const activeLoans = load('./activeLoans.ts', { './membership': load('./membership.ts'), './loanTypeLabel': load('./loanTypeLabel.ts') });
  const queries = [];
  const loan = { id: 'loan-test', application_id: 'APP-TEST', amount: 12000, status: 'released', tenure_months: 12, members: null };
  const ledger = { payments: [receipt('2026-11-08', 3000)] };
  const imports = {
    './activeLoans': activeLoans,
    './counterPayments': { loadPaymentLedger: async id => { queries.push(['ledger', id]); return ledger; } },
    './supabase': { getSupabaseClient: () => ({ from(table) {
      queries.push(['table', table]);
      const query = { select() { return query; }, eq(key, value) { queries.push([key, value]); return query; }, single: async () => ({ data: loan, error: null }) };
      return query;
    } }) },
  };
  const { loadRepaymentDetails } = load('./repaymentDetailsData.ts', imports);
  const details = await loadRepaymentDetails('loan-test');
  assert.deepEqual(queries, [['ledger', 'loan-test'], ['table', 'loan_applications'], ['id', 'loan-test']]);
  assert.equal(details.loan.progress.monthsPaid, 3);
  assert.equal(details.ledger, ledger);
  const failure = load('./repaymentDetailsData.ts', { ...imports, './counterPayments': { loadPaymentLedger: async () => { throw new Error('Administrator access required'); } } });
  await assert.rejects(failure.loadRepaymentDetails('loan-test'), /Administrator access required/);
});
