import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.COUNTER_PAYMENT_PG_MODULE || '@electric-sql/pglite');
const superId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const loanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const legacyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('automatic counter receipts use installment arrears and preserve the reviewed allocation', async () => {
  const db = new PGlite();
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const login = async id => {
    await db.exec('reset role');
    await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id })]);
    await db.exec('set role authenticated');
  };
  const preview = async (receipt, date, amount, loan = loanId) => (await query(
    'select public.preview_counter_payment($1,$2,$3,$4) as result', [loan, receipt, date, amount],
  ))[0].result;
  const record = async (request, receipt, date, amount, allocation) => (await query(
    'select public.record_allocated_counter_payment($1,$2,$3,$4,$5,$6) as result',
    [loanId, request, receipt, date, amount, JSON.stringify(allocation)],
  ))[0].result;
  const ledger = async loan => (await query('select public.loan_payment_ledger($1) as result', [loan]))[0].result;
  const allocation = (principal, penalty) => ({ principal, penalty, interest: 0, fee: 0 });

  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb, raw_user_meta_data jsonb default '{}', email text, banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
      grant usage on schema auth,public to authenticated,service_role;
      create table public.loan_applications(id uuid primary key, application_id text, member_name text, amount numeric, monthly_payment numeric, status text, date_released date, tenure_months integer, date_submitted date, date_approved date, date_completed date, updated_at timestamptz default now());
      create table public.loan_payments(id uuid default gen_random_uuid() primary key, loan_application_id uuid not null references public.loan_applications(id), payment_amount numeric not null, payment_date date not null, payment_method text check(payment_method in ('cash')), notes text, created_at timestamptz default now());
      create table public.admin_activity_logs(actor_id uuid not null, action_name text not null, target_id text not null, result text not null, details jsonb not null);
      create table public.loan_policy_settings(singleton boolean primary key, base_interest_rate numeric, processing_fee_percent numeric, service_fee_percent numeric, penalty_rate_percent numeric, updated_at timestamptz);
      insert into public.loan_policy_settings values(true,2,1,0.5,2,'2026-02-28T00:00:00Z');
    `);
    for (const [id, role] of [[superId, 'super_admin'], [adminId, 'admin']]) {
      await query('insert into auth.users(id,raw_app_meta_data,email) values($1,$2,$3)', [id, JSON.stringify({ role }), `${role}@test.invalid`]);
    }
    for (const [id, released] of [[loanId, '2026-01-31'], [legacyId, '2025-10-31']]) {
      await query("insert into public.loan_applications(id,application_id,member_name,amount,status,date_released,tenure_months) values($1,$2,'Test Member',1200,'released',$3,3)", [id, id, released]);
    }
    for (const file of ['20261029_loan_release.sql', '20261029_counter_payments.sql', '20261029_fix_counter_payment_method.sql', '20261108144000_automatic_counter_payments.sql', '20261108180000_counter_payment_interest.sql', '20261113190000_counter_payment_legacy_interest_baseline.sql', '20261113200000_current_month_counter_interest.sql', '20261113210000_legacy_contract_interest_balance.sql', '20261113220000_total_repayment_balance.sql', '20261113230000_auto_complete_settled_loans.sql', '20261113240000_scheduled_total_interest.sql']) {
      await db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    }
    await query("insert into public.loan_applications(id,application_id,member_name,amount,status,date_released,tenure_months) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','OR-NEW','Test Member',1000,'released','2026-03-01',6)");
    const contractLoanId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await query("insert into public.loan_applications(id,application_id,member_name,amount,monthly_payment,status,date_released,tenure_months) values($1,'OR-CONTRACT','Test Member',227000,22321.67,'released','2026-10-31',12)", [contractLoanId]);
    await query('update public.loan_applications set interest_rate_at_release=null where id=$1', [contractLoanId]);
    const scheduledLoanId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await query("insert into public.loan_applications(id,application_id,member_name,amount,monthly_payment,status,date_released,tenure_months) values($1,'OR-SCHEDULED','Test Member',50000,5166.67,'released','2026-11-13',12)", [scheduledLoanId]);
    const newLoan = (await query("select interest_rate_at_release,processing_fee_amount_at_release,service_fee_amount_at_release from public.loan_applications where application_id='OR-NEW'"))[0];
    assert.equal(Number(newLoan.interest_rate_at_release), 2);
    assert.equal(Number(newLoan.processing_fee_amount_at_release), 10);
    assert.equal(Number(newLoan.service_fee_amount_at_release), 5);
    await query('update public.loan_applications set interest_rate_at_release=2 where id=$1', [loanId]);
    await query(`insert into public.loan_payments(loan_application_id,payment_amount,payment_date,payment_method,notes,receipt_number,principal_amount,interest_amount,penalty_amount,fee_amount)
      values($1,102,'2026-02-28','cash','','LEGACY-OR-001',100,2,0,0)`, [legacyId]);
    await query(`insert into public.loan_payments(loan_application_id,payment_amount,payment_date,payment_method,notes,receipt_number,principal_amount,interest_amount,penalty_amount,fee_amount)
      values($1,227000,'2026-11-08','cash','','CONTRACT-OR-001',227000,0,0,0)`, [contractLoanId]);

    await login(adminId);
    await assert.rejects(preview('OR-001', '2026-03-01', 100), { code: '42501' });
    await assert.rejects(record(crypto.randomUUID(), 'OR-001', '2026-03-01', 100, allocation(92, 8)), { code: '42501' });
    await login(superId);
    assert.equal((await ledger(loanId)).automatic_allocation, true);
    assert.equal((await ledger(legacyId)).automatic_allocation, true);
    assert.equal(Number((await ledger(legacyId)).interest_paid), 2);
    assert.equal(Number((await ledger(legacyId)).interest_due), 2);
    assert.equal(Number((await ledger(contractLoanId)).interest_due), 40860.04);
    assert.equal((await ledger(contractLoanId)).automatic_allocation, true);
    assert.equal(Number((await ledger(contractLoanId)).total_remaining), 40860.04);
    assert.deepEqual(await preview('OR-CONTRACT-PARTIAL', '2026-11-13', 20000, contractLoanId), { principal: 0, interest: 20000, penalty: 0, fee: 0 });
    assert.equal(Number((await ledger(scheduledLoanId)).total_remaining), 62000.04);
    assert.deepEqual(await preview('OR-SCHEDULE-PARTIAL', '2026-11-13', 5166.67, scheduledLoanId), { principal: 0, interest: 5166.67, penalty: 0, fee: 0 });
    await db.exec('reset role');
    await query(`insert into public.loan_payments(loan_application_id,payment_amount,payment_date,payment_method,notes,receipt_number,principal_amount,interest_amount,penalty_amount,fee_amount)
      values($1,40000,'2026-11-13','cash','','CONTRACT-OR-002',0,40000,0,0)`, [contractLoanId]);
    await login(superId);
    assert.equal(Number((await ledger(contractLoanId)).total_remaining), 860.04);
    await db.exec('reset role');
    const finalPayment = (await query(`insert into public.loan_payments(loan_application_id,payment_amount,payment_date,payment_method,notes,receipt_number,principal_amount,interest_amount,penalty_amount,fee_amount,recorded_by,request_id)
      values($1,860.04,'2026-11-13','cash','','CONTRACT-OR-003',0,860.04,0,0,$2,$3) returning id`, [contractLoanId, superId, crypto.randomUUID()]))[0];
    await db.exec('reset role');
    assert.equal((await query('select status from public.loan_applications where id=$1', [contractLoanId]))[0].status, 'completed');
    assert.equal(new Date((await query('select date_completed from public.loan_applications where id=$1', [contractLoanId]))[0].date_completed).toISOString().slice(0, 10), '2026-11-13');
    await login(superId);
    await query('select public.reverse_counter_payment($1,$2)', [finalPayment.id, 'Testing loan reopening after receipt reversal']);
    await db.exec('reset role');
    assert.equal((await query('select status from public.loan_applications where id=$1', [contractLoanId]))[0].status, 'released');
    await login(superId);
    assert.deepEqual(await preview('OR-LEGACY', '2026-03-01', 100, legacyId), allocation(100, 0));
    await assert.rejects(preview('OR-001', '2026-01-30', 100), /release date through today/);
    await assert.rejects(preview('OR-001', '2026-03-01', 0.001), /two decimal places/);
    await assert.rejects(preview('OR-001', '2026-03-01', 1256.01), /exceeds/);
    assert.deepEqual(await preview('OR-EARLY', '2026-02-01', 100), { principal: 76, interest: 24, penalty: 0, fee: 0 });
    assert.deepEqual(await preview('OR-001', '2026-02-28', 100), { principal: 76, interest: 24, penalty: 0, fee: 0 });
    assert.deepEqual(await preview('OR-001', '2026-03-01', 3), allocation(0, 3));
    const reviewed = await preview('OR-001', '2026-03-01', 100);
    assert.deepEqual(reviewed, { principal: 44, interest: 48, penalty: 8, fee: 0 });
    assert.equal((await ledger(loanId)).payments.length, 0);

    const request = crypto.randomUUID();
    await assert.rejects(record(request, 'OR-001', '2026-03-01', 100, allocation(100, 0)), { code: '40001' });
    const saved = await record(request, 'OR-001', '2026-03-01', 100, reviewed);
    assert.equal(saved.payment_method, 'cash');
    assert.equal(saved.payment_amount, 100);
    assert.equal(saved.penalty_amount, 8);
    assert.equal((await record(request, 'OR-001', '2026-03-01', 100, reviewed)).id, saved.id);
    await assert.rejects(preview('or-001', '2026-03-01', 100), { code: '23505' });
    await assert.rejects(record(crypto.randomUUID(), 'OR-002', '2026-03-01', 100, reviewed), { code: '40001' });
    await assert.rejects(preview('OR-002', '2026-02-28', 100), /predates a posted payment/);
    assert.deepEqual(await preview('OR-002', '2026-04-01', 20), { principal: 0, interest: 4.88, penalty: 15.12, fee: 0 });
    await query('select public.reverse_counter_payment($1,$2)', [saved.id, 'Correcting receipt entry']);
    assert.deepEqual(await preview('OR-003', '2026-03-01', 100), { principal: 44, interest: 48, penalty: 8, fee: 0 });

    await db.exec('reset role');
    await query('update public.loan_policy_settings set penalty_rate_percent=3 where singleton');
    assert.deepEqual(await query("select rate::text from public.counter_payment_penalty_rates where effective_date=(now() at time zone 'Asia/Manila')::date+1"), [{ rate: '3.0000' }]);
    assert.equal((await query('select count(*)::integer as count from public.admin_activity_logs')).at(0).count, 3);
    await login(superId);
    assert.deepEqual(await preview('OR-003', '2026-03-01', 100), { principal: 44, interest: 48, penalty: 8, fee: 0 });
  } finally { await db.close(); }
});
