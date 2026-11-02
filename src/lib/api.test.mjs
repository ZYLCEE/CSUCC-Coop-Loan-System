import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('./api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(rows) {
  const client = {
    from() {
      let result = rows;
      return {
        select() { return this; },
        in(column, values) { result = result.filter(row => values.includes(row[column])); return this; },
        eq(column, value) { result = result.filter(row => row[column] === value); return this; },
        async order() { return { data: result, error: null }; },
        async single() { return { data: result[0], error: null }; },
      };
    },
  };
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === '@/lib/supabase') return { getSupabaseClient: () => client };
    if (name === '@/lib/membership') return { normalizeMembershipType: value => value };
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return exports;
}

const loan = status => ({
  application_id: `APP-${status}`, member_name: 'Member', loan_type: 'Regular',
  amount: 1000, status, date_submitted: '2026-11-01', members: null,
});

test('Loan Applicants retains applications awaiting release and excludes post-release statuses', async () => {
  const api = setup(['pending', 'under review', 'approved', 'rejected', 'released', 'overdue', 'completed'].map(loan));
  assert.deepEqual((await api.fetchLoanApplications()).map(row => row.status),
    ['Pending', 'Under Review', 'Approved', 'Rejected']);
});

test('a released loan leaves Loan Applicants while its details remain available', async () => {
  const row = loan('approved');
  const api = setup([row]);
  assert.equal((await api.fetchLoanApplications()).length, 1);
  row.status = 'released';
  assert.deepEqual(await api.fetchLoanApplications(), []);
  assert.equal((await api.fetchLoanApplicationById(row.application_id)).status, 'Released');
});
