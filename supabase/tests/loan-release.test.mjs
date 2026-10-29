// Isolated PostgreSQL test. No live loans are released by this test.
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

test('loan release SQL: approval/date checks, authorization, retry safety, audit and counter-payment eligibility', async () => {
  const db = new PGlite();
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const owner = () => db.exec('reset role');
  const login = async id => { await owner(); await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id })]); await db.exec('set role authenticated'); };
  const release = async ({ application = 'APP-001', request = crypto.randomUUID(), date = '2026-01-03', reference = 'DV-001', amount = '1000', notes = '' } = {}) =>
    (await query('select public.release_approved_loan($1,$2,$3,$4,$5,$6) as result', [application, request, date, reference, amount, notes]))[0].result;
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb, raw_user_meta_data jsonb default '{}', email text, banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
      grant usage on schema auth,public to authenticated,service_role;
      create table public.loan_applications(id uuid default gen_random_uuid() primary key, application_id text unique, member_name text, amount numeric, status text, date_submitted date, date_approved date, date_released date, date_completed date, updated_at timestamptz default now());
      create table public.loan_payments(id uuid default gen_random_uuid() primary key, loan_application_id uuid not null references public.loan_applications(id), payment_amount numeric not null, payment_date date not null, payment_method varchar(50) default 'cash' constraint loan_payments_payment_method_check check(payment_method in ('cash')), notes text, created_at timestamptz default now());
      create table public.admin_activity_logs(id uuid default gen_random_uuid() primary key, actor_id uuid not null, action_name text not null, target_id text not null, result text not null, details jsonb not null, created_at timestamptz default now());
    `);
    for (const [id, role] of [[superId, 'super_admin'], [adminId, 'admin'], [memberId, 'member']]) await query('insert into auth.users(id,raw_app_meta_data,email) values($1,$2,$3)', [id, JSON.stringify({ role, account_status: 'active' }), `${role}@test.invalid`]);
    await query("insert into public.loan_applications(id,application_id,member_name,amount,status,date_submitted,date_approved) values($1,'APP-001','Member One',1000,'approved','2026-01-01','2026-01-02')", [loanId]);
    for (const [application, status] of [['APP-002', 'pending'], ['APP-003', 'under review'], ['APP-004', 'rejected'], ['APP-005', 'completed'], ['APP-006', 'overdue'], ['APP-007', 'approved']]) await query("insert into public.loan_applications(application_id,member_name,amount,status,date_submitted,date_approved) values($1,'Member',1000,$2,'2026-01-01','2026-01-02')", [application, status]);
    const migration = readFileSync(new URL('../migrations/20261029_loan_release.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    for (const id of [adminId, memberId]) { await login(id); await assert.rejects(release(), error => error.code === '42501'); }
    await owner(); await db.exec('set role anon');
    await assert.rejects(release(), error => error.code === '42501');
    await login(superId);
    for (const application of ['APP-002', 'APP-003', 'APP-004', 'APP-005', 'APP-006']) await assert.rejects(release({ application }), /Only approved/);
    await assert.rejects(release({ application: 'missing' }), /Loan not found/);
    await assert.rejects(release({ date: '2099-01-01' }), /future/);
    await assert.rejects(release({ date: '2026-01-01' }), /earlier than/);
    await assert.rejects(release({ reference: ' ' }), /disbursement reference/);
    await assert.rejects(release({ notes: 'x'.repeat(2001) }), /notes/);
    await assert.rejects(release({ amount: '999' }), /amount changed/);
    await assert.rejects(release({ amount: 'NaN' }), /amount changed/);
    await owner(); await db.exec("update public.loan_applications set date_approved=null where application_id='APP-007'");
    await login(superId); await assert.rejects(release({ application: 'APP-007' }), /approval date/);
    await owner(); await db.exec("update public.loan_applications set date_approved='2026-01-02' where application_id='APP-007'");
    await login(superId);
    const request = crypto.randomUUID();
    const saved = await release({ request, reference: ' DV-001 ', notes: 'Signed voucher checked' });
    assert.equal(saved.status, 'released'); assert.equal(saved.date_released, '2026-01-03'); assert.equal(saved.release_reference, 'DV-001');
    assert.deepEqual(await release({ request, notes: 'Signed voucher checked' }), saved);
    await assert.rejects(release({ request, reference: 'different' }), /different release/);
    await assert.rejects(release(), /Only approved/);
    await assert.rejects(release({ application: 'APP-007', reference: 'dv-001' }), error => error.code === '23505');
    await owner();
    const row = (await query('select * from public.loan_applications where id=$1', [loanId]))[0];
    assert.equal(row.released_by, superId); assert.equal(row.released_by_name, 'super_admin@test.invalid');
    assert.equal((await query("select status from public.loan_applications where application_id='APP-007'"))[0].status, 'approved');
    const audit = await query('select * from public.admin_activity_logs');
    assert.equal(audit.length, 1); assert.equal(audit[0].action_name, 'release-loan'); assert.equal(audit[0].details.disbursement_reference, 'DV-001');
    assert.equal(audit[0].details.amount, 1000);
    // Run both migrations and verify the released loan is immediately eligible for receipts.
    await db.exec(readFileSync(new URL('../migrations/20261029_counter_payments.sql', import.meta.url), 'utf8'));
    await login(superId);
    await query("select public.record_counter_payment($1,$2,'OR-001','2026-01-03',100,10,0,0,'')", [loanId, crypto.randomUUID()]);
    const ledger = (await query('select public.loan_payment_ledger($1) as result', [loanId]))[0].result;
    assert.equal(ledger.principal_remaining, 900); assert.equal(ledger.total_received, 110);
    await owner(); await query("update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"account_status\":\"blocked\"}'::jsonb where id=$1", [superId]);
    await login(superId); await assert.rejects(release({ application: 'APP-007', reference: 'DV-002' }), error => error.code === '42501');
    await owner(); await query("update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"account_status\":\"active\"}'::jsonb,banned_until=now()+interval '1 day' where id=$1", [superId]);
    await login(superId); await assert.rejects(release({ application: 'APP-007', reference: 'DV-002' }), error => error.code === '42501');
  } finally { await db.close(); }
});
