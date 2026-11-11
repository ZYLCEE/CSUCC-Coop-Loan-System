import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const membership = {};
new Function('exports', compile('../../lib/membership.ts'))(membership);
const presentation = {};
new Function('require', 'exports', compile('./loanDetailsPresentation.ts'))(name => name.endsWith('membership') ? membership : { pesos: value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value) }, presentation);
const record = { application_id: 'APP-1', member_name: 'Applicant', loan_type: 'Emergency', amount: '60000', income: '35000', purpose: 'Repairs', tenure_months: 12, date_submitted: '2026-10-02', date_approved: '2026-10-03', date_released: '2026-10-04', date_completed: '2026-11-01', monthly_payment: 5500.8, members: { member_id: 'CSUCC-1', membership_type: 'regular' }, release_reference: 'RELEASE-ONLY', release_notes: 'SECRET-METADATA', credit_score: 750, id: 'internal-uuid', member_id: 'internal-member-uuid' };
for (const status of ['pending', 'under review', 'rejected', 'approved', 'released', 'completed', 'overdue']) {
  test(`${status}: curated fields and lifecycle-specific information`, () => {
    const view = presentation.loanDetailsPresentation({ ...record, status }, 'APP-1');
    const fields = view.sections.flatMap(section => section.fields);
    const labels = fields.map(field => field.label);
    assert.ok(fields.some(field => field.value === '₱60,000.00'));
    assert.ok(!JSON.stringify(view).includes('internal-uuid'));
    assert.ok(!JSON.stringify(view).includes('SECRET-METADATA'));
    assert.ok(!labels.includes('Credit Score'));
    assert.equal(labels.includes('Date Approved'), status === 'approved');
    assert.equal(labels.includes('Date Completed'), status === 'completed');
    assert.equal(labels.includes('Release Date'), view.operational);
    assert.equal(labels.includes('Monthly Installment (Recorded)'), view.operational);
    if (!view.operational) assert.ok(!JSON.stringify(view).includes('RELEASE-ONLY'));
  });
}
test('missing, invalid and empty values never become fabricated money or dates', () => {
  const view = presentation.loanDetailsPresentation({ status: 'approved', amount: null, income: '', monthly_payment: undefined, tenure_months: null, date_approved: 'invalid', members: null }, 'APP-MISSING');
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('₱0.00'));
  assert.ok(!serialized.includes('1970'));
  assert.ok(serialized.includes('Not available'));
  assert.ok(!serialized.includes('Monthly Income'));
});
test('date-only values preserve calendar day and timestamp instants use Manila', () => {
  assert.equal(presentation.loanDetailDate('2026-10-02'), 'October 2, 2026');
  assert.equal(presentation.loanDetailDate('2026-10-02T23:00:00Z'), 'October 3, 2026');
  for (const value of [null, '', 'bad', '2026-02-30', '2026-10-02T23:00:00']) assert.equal(presentation.loanDetailDate(value), undefined);
});
test('existing status normalization handles spaces and underscores; unknown status grants no ledger entry', () => {
  assert.equal(presentation.loanDetailsPresentation({ status: ' UNDER_REVIEW ' }, 'APP-1').status, 'under review');
  assert.equal(presentation.loanDetailsPresentation({ status: 'unexpected' }, 'APP-1').operational, false);
});
test('member relationship supports array or null without exposing internal member UUID', () => {
  const view = presentation.loanDetailsPresentation({ ...record, members: [{ first_name: 'Maria', last_name: 'Cruz', member_id: 'CSUCC-2', membership_type: 'associate' }] }, 'APP-1');
  assert.ok(JSON.stringify(view).includes('Maria Cruz'));
  assert.ok(JSON.stringify(view).includes('Associate Member'));
  assert.ok(!JSON.stringify(view).includes('internal-member-uuid'));
});

test('actual private rejection metadata is shown only for rejected applications', () => {
  const decision = { reason: 'Actual recorded administrative reason', rejected_at: '2026-11-10T00:00:00Z', rejected_by: 'Recorded administrator' };
  const rejected = presentation.loanDetailsPresentation({ ...record, status: 'rejected' }, 'APP-1', decision);
  assert.ok(JSON.stringify(rejected).includes(decision.reason));
  assert.ok(JSON.stringify(rejected).includes('Asia/Manila'));
  for (const status of ['pending', 'under review', 'approved', 'released', 'completed', 'overdue']) assert.ok(!JSON.stringify(presentation.loanDetailsPresentation({ ...record, status }, 'APP-1', decision)).includes(decision.reason));
});
