import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const superId='11111111-1111-4111-8111-111111111111', adminId='22222222-2222-4222-8222-222222222222', memberId='33333333-3333-4333-8333-333333333333';
test('secure rejection SQL: lifecycle, authorization, private audit, replay, stale decisions and atomic notification', async t => {
 const db=new PGlite();
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const owner=()=>db.exec('reset role');
 const login=async(id,role='authenticated')=>{await owner();await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id})]);await db.exec(`set role ${role}`);};
 const reject=async(application='APP-pending', {actor=superId,reason='  Documents do not meet the application requirements.  ',request=crypto.randomUUID(),status='pending'}={}) => (await q('select public.reject_loan_application($1,$2,$3,$4,$5) as result',[actor,application,reason,request,status]))[0].result;
 try {
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb,banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
 grant usage on schema auth,public to authenticated,service_role,anon;
 create table public.members(id uuid primary key default gen_random_uuid(),user_id uuid,first_name text,last_name text,status text);
 create table public.loan_applications(id uuid primary key default gen_random_uuid(),application_id text unique,member_id uuid,amount numeric default 60000,status text,date_approved date,date_released date,date_completed date,updated_at timestamptz default now());
 create table public.admin_activity_logs(id uuid primary key default gen_random_uuid(),actor_id uuid,action_name text,target_id text,result text,details jsonb,created_at timestamptz default now());
 create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid,title text,message text,type text check(type in ('info','success','warning','error')),read boolean);
 revoke all on public.admin_activity_logs from public,authenticated,anon;
 `);
 const prerequisites=readFileSync(new URL('../../../coop_backend/supabase/migrations/013_secure_account_creation.sql',import.meta.url),'utf8');
 const active=prerequisites.match(/CREATE OR REPLACE FUNCTION public\.is_active_secure_admin[\s\S]*?\$\$;/)[0];
 await db.exec(active);
 for(const[id,role]of[[superId,'super_admin'],[adminId,'admin'],[memberId,'member']]){
 await q('insert into auth.users values($1,$2,null)',[id,JSON.stringify({role,account_status:'active'})]);
 await q("insert into public.members(id,user_id,first_name,last_name,status) values($1,$1,$2,'User','active')",[id,role]);}
 for(const status of ['pending','under review','approved','rejected','released','completed','overdue']) await q('insert into public.loan_applications(application_id,member_id,status) values($1,$2,$3)',[`APP-${status}`,memberId,status]);
 if(process.env.COOP_REJECTION_MIGRATION)await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);');
 const migration=readFileSync(process.env.COOP_REJECTION_MIGRATION??new URL('../migrations/20261110_secure_loan_rejection.sql',import.meta.url),'utf8');await db.exec(migration);
 if(process.env.COOP_REJECTION_MIGRATION){await assert.rejects(db.exec(migration),/baseline changed/);await db.exec('rollback');}else await db.exec(migration);
 await t.test('production notification type constraint gains rejection without losing existing types',async()=>{
 const constraint=(await q("select pg_get_constraintdef(oid) as definition from pg_constraint where conname='notifications_type_check'"))[0].definition;
 for(const type of ['info','success','warning','error','loan_rejection'])assert.ok(constraint.includes(type));
 });
 await t.test('browser roles cannot invoke mutation or capability; member cannot read private reasons',async()=>{
 for(const id of[superId,adminId,memberId,null]){await login(id);await assert.rejects(reject(),{code:'42501'});await assert.rejects(q('select public.loan_rejection_capability($1)',[superId]),{code:'42501'});}
 await login(memberId);await assert.rejects(q("select public.loan_rejection_details('APP-pending')"),{code:'42501'});await assert.rejects(q('select * from public.admin_activity_logs'),{code:'42501'});
 });
 await t.test('service rejects unauthenticated, ordinary Admin and blocked Super Admin actors',async()=>{
 await login(superId,'service_role');for(const actor of[null,adminId,memberId])await assert.rejects(reject('APP-pending',{actor}),{code:'42501'});
 await owner();await q("update public.members set status='blocked' where user_id=$1",[superId]);await login(superId,'service_role');await assert.rejects(reject(),{code:'42501'});await owner();await q("update public.members set status='active' where user_id=$1",[superId]);
 });
 await t.test('required reason, length and expected state enforced by SQL',async()=>{
 await login(superId,'service_role');for(const reason of[null,'',' \t\n ','x'.repeat(2001)])await assert.rejects(reject('APP-pending',{reason}),{code:'22023'});
 await assert.rejects(reject('APP-pending',{status:'approved'}),{code:'22023'});
 });
 await t.test('Pending and Under Review succeed; audit and notification are idempotent and reason remains private',async()=>{
 await login(superId,'service_role');const request=crypto.randomUUID();const first=await reject('APP-pending',{request});assert.equal(first.status,'rejected');assert.deepEqual(await reject('APP-pending',{request}),first);
 await assert.rejects(reject('APP-pending',{request,reason:'Different reason'}),{code:'23505'});
 await assert.rejects(reject('APP-pending'),{code:'40001'});
 await reject('APP-under review',{status:'under review'});
 await owner();assert.equal((await q("select count(*)::integer n from public.admin_activity_logs where result='success'"))[0].n,2);assert.equal((await q('select count(*)::integer n from public.notifications'))[0].n,2);
 assert.ok((await q('select message from public.notifications')).every(row=>!row.message.includes('Documents')));
 for(const id of[adminId,superId]){await login(id);const details=(await q("select public.loan_rejection_details('APP-pending') as result"))[0].result;assert.equal(details.reason,'Documents do not meet the application requirements.');assert.ok(details.rejected_at);assert.equal(details.rejected_by,'super_admin User');}
 });
 await t.test('Approved, Rejected, Released, Completed and Overdue cannot be rejected',async()=>{
 await login(superId,'service_role');for(const status of['approved','rejected','released','completed','overdue'])await assert.rejects(reject(`APP-${status}`),{code:'40001'});
 });
 await t.test('stale open review cannot overwrite another decision or changed review state',async()=>{
 await owner();await q("insert into public.loan_applications(application_id,member_id,status,date_approved) values('APP-stale',$1,'approved',current_date)",[memberId]);await login(superId,'service_role');await assert.rejects(reject('APP-stale'),{code:'40001'});
 await owner();await q("insert into public.loan_applications(application_id,member_id,status) values('APP-started-review',$1,'under review')",[memberId]);await login(superId,'service_role');await assert.rejects(reject('APP-started-review'),{code:'40001'});
 });
 await t.test('inconsistent release metadata blocks rejection even with an eligible status',async()=>{
 await owner();await q("insert into public.loan_applications(application_id,member_id,status,date_released) values('APP-disbursed',$1,'pending',current_date)",[memberId]);await login(superId,'service_role');await assert.rejects(reject('APP-disbursed'),{code:'40001'});
 });
 await t.test('notification failure rolls back both decision and success audit; no principal change',async()=>{
 await owner();await q("insert into public.loan_applications(application_id,member_id,status) values('APP-rollback',$1,'pending')",[memberId]);await db.exec("create function public.test_fail_notification() returns trigger language plpgsql as $$begin raise exception 'Synthetic failure';end$$;create trigger fail_notification before insert on public.notifications for each row execute function public.test_fail_notification();");
 await login(superId,'service_role');await assert.rejects(reject('APP-rollback'));await owner();const loan=(await q("select status,amount from public.loan_applications where application_id='APP-rollback'"))[0];assert.equal(loan.status,'pending');assert.equal(Number(loan.amount),60000);assert.equal((await q("select count(*)::integer n from public.admin_activity_logs where target_id='APP-rollback'"))[0].n,0);
 });
 } finally {await db.close();}
});
