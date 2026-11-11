import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}
const helpers = load('./activeLoans.ts', { './membership': load('./membership.ts'), './loanTypeLabel': load('./loanTypeLabel.ts') });
const { toActiveLoan, filterActiveLoans, repaymentProgressLabel } = helpers;
const { fetchActiveLoanRecords } = load('./activeLoansData.ts', { './activeLoans': helpers });
const base = {
  id: 'loan-1', application_id: 'APP-1', member_name: 'Maria Dela Cruz',
  loan_type: 'Emergency', amount: '12000.00', monthly_payment: '1200.00', status: 'released',
  tenure_months: 12, date_submitted: '2026-01-01', members: { member_id: 'CSUCC-2026-0001', membership_type: 'regular' },
};
const receipt = (principal, extra = {}) => ({ payment_status: 'posted', principal_amount: principal, payment_amount: principal, ...extra });

test('deployed account membership values keep the original loans in the correct membership filter', () => {
  const filters = { search: '', status: 'All Status', loanType: 'All Loan Types', membershipType: 'All Members' };
  for (const [stored, normalized, label] of [
    ['Regular', 'regular', 'Regular Member'], ['Associate', 'associate', 'Associate Member'],
    [' REGULAR ', 'regular', 'Regular Member'], [' associate ', 'associate', 'Associate Member'],
  ]) {
    for (const relation of [{ member_id: 'CSUCC-2026-0008', membership_type: stored }, [{ member_id: 'CSUCC-2026-0008', membership_type: stored }]]) {
      const loan = toActiveLoan({ ...base, members: relation }, []);
      assert.equal(loan.membershipType, normalized, `${stored} is recognized`);
      assert.equal(filterActiveLoans([loan], { ...filters, membershipType: label })[0].applicationId, base.application_id);
      assert.deepEqual(filterActiveLoans([loan], { ...filters, membershipType: normalized === 'regular' ? 'Associate Member' : 'Regular Member' }), []);
    }
  }
  const unknown = toActiveLoan({ ...base, loan_type: 'Regular', members: { membership_type: null } }, []);
  assert.equal(unknown.membershipType, null, 'loan type does not determine membership');
  assert.deepEqual(filterActiveLoans([unknown], { ...filters, membershipType: 'Regular Member' }), []);
});

test('monthly progress counts covered principal, not receipts, interest, or fees', () => {
  const loan = toActiveLoan(base, [receipt(300), receipt(300), receipt(400)]);
  assert.equal(loan.status, 'Paid');
  assert.equal(repaymentProgressLabel(loan.progress), '1 of 12 months paid');
  assert.equal(toActiveLoan(base, [receipt(3000)]).progress.monthsPaid, 3, 'one advance receipt can cover three months');
  const partial = toActiveLoan(base, [receipt(800, { payment_amount: 1800 })]);
  assert.equal(partial.progress.monthsPaid, 0);
  assert.equal(partial.progress.partialMonthAmount, 800);
  assert.equal(partial.progress.principalRemaining, 11200);
  const feesOnly = toActiveLoan(base, [receipt(0, { payment_amount: 1000 })]);
  assert.equal(feesOnly.status, 'Paid');
  assert.equal(feesOnly.progress.monthsPaid, 0);
});

test('partial installments round against the cumulative schedule and never round a month upward', () => {
  const loan = { ...base, amount: 1000, tenure_months: 3 };
  for (const [paid, months] of [[333.32, 0], [333.33, 1], [666.66, 1], [666.67, 2], [1000, 3]]) {
    assert.equal(toActiveLoan(loan, [receipt(paid)]).progress.monthsPaid, months);
  }
  const progress = toActiveLoan(base, [receipt(3500)]).progress;
  assert.equal(progress.monthsPaid, 3);
  assert.equal(progress.partialMonthAmount, 500);
});

test('reversals do not count and Overdue takes priority over partial repayment', () => {
  const payments = [receipt(3000), receipt(5000, { payment_status: 'reversed' })];
  const loan = toActiveLoan({ ...base, status: 'overdue' }, payments);
  assert.equal(loan.status, 'Overdue');
  assert.equal(loan.progress.monthsPaid, 3);
  assert.equal(toActiveLoan(base, [receipt(3000, { payment_status: 'reversed' })]).status, 'Released');
});

test('unknown allocations and terms do not become invented paid-month totals', () => {
  const unknown = toActiveLoan(base, [receipt(null, { payment_amount: 1000 })]);
  assert.equal(unknown.status, 'Paid');
  assert.equal(repaymentProgressLabel(unknown.progress), 'Needs reconciliation');
  assert.equal(unknown.progress.monthsPaid, null);
  assert.equal(unknown.progress.principalPaid, null);
  assert.equal(unknown.progress.principalRemaining, null);
  assert.equal(repaymentProgressLabel(toActiveLoan({ ...base, tenure_months: null }, []).progress), 'Repayment term not recorded');
  for (const amount of [-1, '', ' ', 12001]) assert.equal(toActiveLoan(base, [receipt(amount)]).progress.reconciliationRequired, true);
});

test('Fully Paid requires recorded completion; principal coverage alone keeps settlement pending', () => {
  const pending = toActiveLoan(base, [receipt(12000)]);
  assert.equal(pending.status, 'Paid');
  assert.equal(pending.progress.monthsPaid, 12);
  assert.equal(pending.progress.settlementPending, true);
  const complete = toActiveLoan({ ...base, status: 'completed' }, [receipt(12000)]);
  assert.equal(complete.status, 'Fully Paid');
  assert.equal(complete.progress.monthsPaid, 12);
  assert.equal(complete.progress.settlementPending, false);
  const historical = toActiveLoan({ ...base, status: 'completed' }, []);
  assert.equal(historical.status, 'Fully Paid');
  assert.equal(historical.progress.monthsPaid, null);
  assert.equal(repaymentProgressLabel(historical.progress), 'Payment allocation unavailable');
  assert.equal(toActiveLoan({ ...base, status: 'completed' }, [receipt(1000)]).progress.reconciliationRequired, true);
});

test('search, all four statuses, loan type, and membership filters combine', () => {
  const loans = [
    toActiveLoan(base, []),
    toActiveLoan({ ...base, id: 'paid', application_id: 'APP-PAID' }, [receipt(3000)]),
    toActiveLoan({ ...base, id: 'late', status: 'overdue', loan_type: 'Regular', members: [{ member_id: 'CSUCC-2026-0002', membership_type: 'associate' }] }, [receipt(1000)]),
    toActiveLoan({ ...base, id: 'settled', status: 'completed' }, [receipt(12000)]),
  ];
  const filters = { search: '', status: 'All Status', loanType: 'All Loan Types', membershipType: 'All Members' };
  for (const status of ['Released', 'Overdue', 'Paid', 'Fully Paid']) assert.equal(filterActiveLoans(loans, { ...filters, status }).length, 1);
  assert.equal(filterActiveLoans(loans, { search: 'CSUCC-2026-0001', status: 'Paid', loanType: 'Emergency', membershipType: 'Regular Member' })[0].id, 'paid');
  assert.equal(filterActiveLoans(loans, { ...filters, membershipType: 'Associate Member' })[0].id, 'late');
  assert.equal(filterActiveLoans(loans, { ...filters, search: 'maria DELA' }).length, 4);
  assert.deepEqual(filterActiveLoans(loans, { ...filters, status: 'Paid', loanType: 'Regular' }), []);
});

function database(loans, payments, failTable) {
  const calls = [];
  return { calls, client: { from(table) {
    let rows = table === 'loan_applications' ? [...loans] : [...payments];
    const query = {
      select(columns) { calls.push({ table, columns }); return query; },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return query; },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return query; },
      order() { return query; },
      async range(start, end) { return { data: failTable === table ? null : rows.slice(start, end + 1), error: failTable === table ? new Error('Synthetic database failure') : null }; },
    };
    return query;
  } } };
}

test('bulk data loading includes completed loans and does not truncate large ledgers or loan lists', async () => {
  const loans = Array.from({ length: 501 }, (_, i) => ({ ...base, id: `loan-${i}`, status: i === 500 ? 'completed' : 'released' }));
  const payments = Array.from({ length: 1100 }, (_, i) => ({ ...receipt(10), id: `receipt-${i}`, loan_application_id: 'loan-0' }));
  payments.push({ ...receipt(1000, { payment_status: 'reversed' }), loan_application_id: 'loan-0' });
  const db = database([...loans, { ...base, id: 'pending', status: 'pending' }], payments);
  const results = await fetchActiveLoanRecords(db.client);
  assert.equal(results.length, 501);
  assert.equal(results[0].progress.monthsPaid, 11);
  assert.equal(results[0].progress.principalPaid, 11000);
  assert.equal(results.at(-1).status, 'Fully Paid');
  assert.ok(db.calls.length < 20, 'queries are batched rather than one per loan');
  await assert.rejects(fetchActiveLoanRecords(database(loans, payments, 'loan_payments').client), /database failure/);
});

test('active-loan endpoint retains authorization and never writes financial records', async () => {
  const privileges = load('./adminPrivileges.ts');
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
  try {
    for (const [role, status] of [['member', 403], ['admin', 200], ['super_admin', 200], ['coop_admin', 200]]) {
      const db = database([base], []);
      const routes = load('../app/api/admin/resources/route.ts', {
        '@supabase/supabase-js': { createClient: () => ({ ...db.client, auth: { getUser: async () => ({ data: { user: { app_metadata: { role, account_status: 'active' } } }, error: null }) } }) },
        '@/lib/adminPrivileges': privileges,
        '@/lib/activeLoansData': { fetchActiveLoanRecords },
        '@/lib/portalActivityServer': { portalActivityHeaders: () => ({}) },
      });
      const response = await routes.GET(new Request('https://synthetic.invalid/api/admin/resources?resource=active', { headers: { authorization: 'Bearer synthetic-token' } }));
      assert.equal(response.status, status);
      if (status === 200) {
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json())[0].status, 'Released');
      } else assert.equal(db.calls.length, 0);
      assert.equal((await routes.GET(new Request('https://synthetic.invalid/api/admin/resources?resource=active'))).status, 401);
    }
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
