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
        select(columns) {
          // PostgREST needs a relation hint once both borrower and co-maker FKs exist.
          assert.match(columns, /members:members!loan_applications_member_id_fkey\(/);
          return this;
        },
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
  const api = setup(['pending', 'under review', 'returned', 'approved', 'rejected', 'released', 'overdue', 'completed'].map(loan));
  assert.deepEqual((await api.fetchLoanApplications()).map(row => row.status),
    ['Pending', 'Pending', 'Returned', 'Approved', 'Rejected']);
});

test('a released loan leaves Loan Applicants while its details remain available', async () => {
  const row = loan('approved');
  const api = setup([row]);
  assert.equal((await api.fetchLoanApplications()).length, 1);
  row.status = 'released';
  assert.deepEqual(await api.fetchLoanApplications(), []);
  assert.equal((await api.fetchLoanApplicationById(row.application_id)).status, 'Released');
});

test('borrower identity and membership stay attached to applications with co-makers', async () => {
  const api = setup([{...loan('pending'),members:{
    id:'borrower-id',member_id:'BORROWER-001',first_name:'Synthetic',last_name:'Borrower',membership_type:'associate',
  },co_maker_member_id:'different-member-id'}]);
  const records=await api.fetchLoanApplications();
  assert.equal(records[0].member,'Synthetic Borrower');
  assert.equal(records[0].memberId,'BORROWER-001');
  assert.equal(records[0].membershipType,'associate');
  assert.equal((await api.fetchLoanApplicationById('APP-pending')).memberId,'BORROWER-001');
});
