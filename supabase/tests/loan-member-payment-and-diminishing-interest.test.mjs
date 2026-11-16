import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.COUNTER_PAYMENT_PG_MODULE || '@electric-sql/pglite');

test('new loans use reducing-balance interest while members can read only their own payment history and agreements require two witness names', async () => {
  const db = new PGlite();
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const migration = readFileSync(new URL('../migrations/20261117000000_loan_member_history_diminishing_interest_and_witnesses.sql', import.meta.url), 'utf8');
  const ownUser = '11111111-1111-4111-8111-111111111111';
  const otherUser = '22222222-2222-4222-8222-222222222222';
  const ownLoan = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherLoan = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
      create table public.members(id uuid primary key,user_id uuid,status text);
      create table public.loan_applications(id uuid primary key,member_id uuid,amount numeric,tenure_months integer,date_released date,interest_rate_at_release numeric,monthly_payment numeric);
      create table public.loan_payments(id uuid primary key default gen_random_uuid(),loan_application_id uuid,payment_amount numeric,payment_date date,principal_amount numeric,payment_status text);
      create table public.loan_submission_agreements(id uuid primary key default gen_random_uuid(),witness_names jsonb not null);
      alter table public.loan_payments enable row level security;
      grant usage on schema auth,public to authenticated,service_role;
      grant select on public.loan_payments to authenticated;
      insert into public.members values
        ('10000000-0000-4000-8000-000000000001','${ownUser}','active'),
        ('10000000-0000-4000-8000-000000000002','${otherUser}','active');
      insert into public.loan_applications values
        ('${ownLoan}','10000000-0000-4000-8000-000000000001',1000,3,'2026-01-01',2,346.75),
        ('${otherLoan}','10000000-0000-4000-8000-000000000002',1000,3,'2026-01-01',2,346.75);
      insert into public.loan_payments(loan_application_id,payment_amount,payment_date,principal_amount,payment_status) values
        ('${ownLoan}',326.75,'2026-02-01',306.75,'posted'),
        ('${otherLoan}',326.75,'2026-02-01',306.75,'posted');
    `);
    await db.exec(migration);
    const method = (await query('select interest_calculation_method from public.loan_applications where id=$1', [ownLoan]))[0];
    assert.equal(method.interest_calculation_method, null, 'existing loans retain their historical method');
    await query("insert into public.loan_applications(id,member_id,amount,tenure_months,date_released,interest_rate_at_release,monthly_payment) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','10000000-0000-4000-8000-000000000001',1000,3,'2026-01-01',2,346.75)");
    const newMethod = (await query("select interest_calculation_method from public.loan_applications where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'"))[0];
    assert.equal(newMethod.interest_calculation_method, 'diminishing_balance');
    const newLoanId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await query('insert into public.loan_payments(loan_application_id,payment_amount,payment_date,principal_amount,payment_status) values($1,326.75,$2,306.75,$3)', [newLoanId, '2026-02-01', 'posted']);
    const interest = (await query('select public.counter_payment_interest(a, $1) as amount from public.loan_applications a where a.id=$2', ['2026-03-01', newLoanId]))[0];
    assert.equal(Number(interest.amount), 33.87, 'interest falls after the first principal payment reduces the balance');

    await query("insert into public.loan_submission_agreements(witness_names) values('[\"Witness One\",\"Witness Two\"]'::jsonb)");
    await assert.rejects(query("insert into public.loan_submission_agreements(witness_names) values('[\"Witness One\"]'::jsonb)"), /both witness names/);
    await assert.rejects(query("insert into public.loan_submission_agreements(witness_names) values('{\"invalid\":true}'::jsonb)"), /both witness names/);
    await assert.rejects(query("insert into public.loan_submission_agreements(witness_names) values('[\"Same\",\" same \"]'::jsonb)"), /different witness names/);

    await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ownUser })]);
    await db.exec('set role authenticated');
    const visible = await query('select loan_application_id from public.loan_payments order by loan_application_id');
    assert.deepEqual(visible.map(row => row.loan_application_id), [ownLoan, newLoanId].sort());
  } finally {
    await db.close();
  }
});
