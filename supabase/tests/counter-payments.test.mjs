// Isolated database only. Never connects to Supabase or creates live receipts.
// Set COUNTER_PAYMENT_PG_MODULE to a locally installed @electric-sql/pglite path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.COUNTER_PAYMENT_PG_MODULE || '@electric-sql/pglite');
const superId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const loanId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const approvedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const legacyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('counter payment SQL: permissions, exact allocations, duplicate protection, balances and audited reversals', async () => {
  const db = new PGlite();
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const owner = () => db.exec('reset role');
  const login = async id => { await owner(); await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id })]); await db.exec('set role authenticated'); };
  const ledger = async (id = loanId) => (await query('select public.loan_payment_ledger($1) as result', [id]))[0].result;
  const record = async ({ id = loanId, requestId = crypto.randomUUID(), receipt = crypto.randomUUID(), date = '2026-01-02', principal = '100.00', interest = '10.00', penalty = '0', fee = '0', notes = '' } = {}) =>
    (await query('select public.record_counter_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) as result', [id, requestId, receipt, date, principal, interest, penalty, fee, notes]))[0].result;
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb, raw_user_meta_data jsonb default '{}', email text, banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
      grant usage on schema auth,public to authenticated,service_role;
      create table public.loan_applications(id uuid primary key, application_id text, member_name text, amount numeric, status text, date_released date);
      create table public.loan_payments(id uuid default gen_random_uuid() primary key, loan_application_id uuid not null references public.loan_applications(id), payment_amount numeric not null, payment_date date not null, payment_method varchar(50) default 'cash' constraint loan_payments_payment_method_check check(payment_method in ('cash')), notes text, created_at timestamptz default now());
      create table public.admin_activity_logs(id uuid default gen_random_uuid() primary key, actor_id uuid not null, action_name text not null, target_id text not null, result text not null, details jsonb not null, created_at timestamptz default now());
    `);
    for (const [id, role] of [[superId, 'super_admin'], [adminId, 'admin'], [memberId, 'member']]) await query('insert into auth.users(id,raw_app_meta_data,email) values($1,$2,$3)', [id, JSON.stringify({ role, account_status: 'active' }), `${role}@test.invalid`]);
    for (const [id, status] of [[loanId, 'released'], [approvedId, 'approved'], [legacyId, 'overdue']]) await query("insert into public.loan_applications values($1,$2,'Test Member',1000,$3,'2026-01-01')", [id, id, status]);
    await query("insert into public.loan_payments(loan_application_id,payment_amount,payment_date) values($1,50,'2026-01-02')", [legacyId]);
    const migration = readFileSync(new URL('../migrations/20261029_counter_payments.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Safe to reapply without duplicating schema or data.
    // Simulate the already installed function, then apply the incremental repair.
    await db.exec(migration.replace("p_date,'cash',coalesce", "p_date,'over_the_counter',coalesce"));
    await login(superId);
    await assert.rejects(record(), error => error.code === '23514' && error.message.includes('loan_payments_payment_method_check'));
    await owner();
    const fix = readFileSync(new URL('../migrations/20261029_fix_counter_payment_method.sql', import.meta.url), 'utf8');
    await db.exec(fix); await db.exec(fix);

    await login(memberId);
    await assert.rejects(ledger(), error => error.code === '42501');
    await assert.rejects(record(), error => error.code === '42501');
    await login(adminId);
    assert.equal((await ledger()).total_received, 0);
    await assert.rejects(record(), error => error.code === '42501');
    await login(superId);
    await assert.rejects(query("insert into public.loan_payments(loan_application_id,payment_amount,payment_date) values($1,100,'2026-01-02')", [loanId]), error => error.code === '42501');
    await assert.rejects(query('delete from public.loan_payments'), error => error.code === '42501');
    await assert.rejects(record({ id: approvedId }), /released or overdue/);
    await assert.rejects(record({ date: '2025-12-31' }), /earlier than/);
    await assert.rejects(record({ date: '2099-01-01' }), /future/);
    await assert.rejects(record({ principal: '-1' }), /nonnegative/);
    await assert.rejects(record({ principal: '0.001' }), /two decimal/);
    await assert.rejects(record({ principal: 'NaN' }), /nonnegative/);
    await assert.rejects(record({ principal: 'Infinity' }), /nonnegative/);
    await assert.rejects(record({ principal: '0', interest: '0' }), /greater than zero/);
    await assert.rejects(record({ principal: '1000.01' }), /exceeds/);
    await assert.rejects(record({ receipt: ' ' }), /receipt number/);
    await assert.rejects(record({ notes: 'x'.repeat(2001) }), /notes/);

    const payload = { requestId: crypto.randomUUID(), receipt: ' OR-001 ', principal: '200.10', interest: '12.15', penalty: '3.25', fee: '1.50' };
    const saved = await record(payload);
    assert.equal(saved.payment_amount, 217);
    assert.equal(saved.receipt_number, 'OR-001');
    assert.equal(saved.recorded_by, superId);
    assert.equal(saved.payment_method, 'cash');
    assert.equal((await ledger()).principal_remaining, 799.9);
    assert.equal((await record(payload)).id, saved.id);
    assert.equal((await ledger()).payments.length, 1);
    await assert.rejects(record({ ...payload, principal: '201' }), /different payment/);
    await assert.rejects(record({ receipt: 'or-001' }), error => error.code === '23505');
    await assert.rejects(record({ principal: '800' }), /exceeds/);

    await assert.rejects(record({ id: legacyId }), /reconciled/);
    assert.equal((await ledger(legacyId)).principal_remaining, null);
    assert.equal((await ledger(legacyId)).unallocated_payments, 1);

    await login(adminId);
    await assert.rejects(query('select public.reverse_counter_payment($1,$2)', [saved.id, 'Entered against wrong receipt']), error => error.code === '42501');
    await login(superId);
    await assert.rejects(query('select public.reverse_counter_payment($1,$2)', [saved.id, 'bad']), /5 to 1000/);
    await query('select public.reverse_counter_payment($1,$2)', [saved.id, 'Entered against wrong receipt']);
    await query('select public.reverse_counter_payment($1,$2)', [saved.id, 'Entered against wrong receipt']);
    const reversed = await ledger();
    assert.equal(reversed.total_received, 0); assert.equal(reversed.principal_remaining, 1000);
    assert.equal(reversed.payments[0].payment_status, 'reversed');
    assert.equal(reversed.payments[0].reversal_reason, 'Entered against wrong receipt');
    await assert.rejects(record({ receipt: 'OR-001' }), error => error.code === '23505');
    const final = await record({ principal: '1000', interest: '0' });
    assert.equal((await ledger()).principal_remaining, 0);
    assert.equal((await ledger()).status, 'released'); // No invented payoff decision.

    await owner();
    const audit = await query('select action_name,details from public.admin_activity_logs');
    assert.equal(audit.length, 3); assert.equal(audit.filter(row => row.action_name === 'reverse-counter-payment').length, 1);
    await query("update auth.users set raw_app_meta_data = raw_app_meta_data || '{\"account_status\":\"blocked\"}'::jsonb where id=$1", [superId]);
    await login(superId);
    await assert.rejects(ledger(), error => error.code === '42501');
    await assert.rejects(record(), error => error.code === '42501');
    await assert.rejects(query('select public.reverse_counter_payment($1,$2)', [final.id, 'Blocked administrator test']), error => error.code === '42501');
    await login(memberId);
    assert.equal((await query('select * from public.loan_payments')).length, 0);
  } finally { await db.close(); }
});
