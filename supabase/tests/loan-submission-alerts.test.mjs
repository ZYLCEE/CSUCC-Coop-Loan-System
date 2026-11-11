import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.COUNTER_PAYMENT_PG_MODULE || '@electric-sql/pglite');

test('new loan submissions leave private inbox records with independent read state', async () => {
  const db = new PGlite();
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const owner = () => db.exec('reset role');
  const login = async (id) => {
    await owner();
    await query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id })]);
    await db.exec('set role authenticated');
  };
  const inbox = () => query("select user_id,title,message,read from public.notifications where type='loan_submitted' order by user_id");
  const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
  const [first, second, ordinaryAdmin, member, blocked, inactiveProfile, unlinked] = ids;

  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      grant usage on schema auth,public to authenticated;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb, banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$;
      create table public.members(user_id uuid, status text);
      create table public.loan_applications(application_id text primary key, member_name text, status text);
      grant insert on public.loan_applications to authenticated;
      create table public.notifications(id uuid default gen_random_uuid() primary key, user_id uuid, title text, message text, type text check(type='info'), read boolean default false);
      alter table public.notifications enable row level security;
      create policy own_read on public.notifications for select to authenticated using(user_id=auth.uid());
      create policy own_update on public.notifications for update to authenticated using(user_id=auth.uid());
      create function public.portal_admin_role() returns text language sql stable security definer as $$
        select raw_app_meta_data->>'role' from auth.users where id=auth.uid()
          and coalesce(raw_app_meta_data->>'account_status','active')='active' $$;
      create function public.is_coop_admin() returns boolean language sql stable security definer as $$
        select public.portal_admin_role() in ('admin','super_admin')
          and not exists(select 1 from public.members where user_id=auth.uid() and status<>'active') $$;
      create policy legacy_admin_read on public.notifications for select to authenticated using(public.is_coop_admin());
      insert into public.notifications(title,message,type) values('Existing info','Old record','info');
    `);
    for (const [id, role, status] of [
      [first, 'super_admin', 'active'], [second, 'super_admin'], [ordinaryAdmin, 'admin', 'active'],
      [member, 'member', 'active'], [blocked, 'super_admin', 'blocked'],
      [inactiveProfile, 'super_admin', 'active'], [unlinked, 'super_admin'],
    ]) {
      await query('insert into auth.users(id,raw_app_meta_data) values($1,$2)', [id, JSON.stringify({ role, account_status: status })]);
    }
    await query("insert into public.members values($1,'active'),($2,'inactive')", [second, inactiveProfile]);
    const migration = readFileSync(new URL('../migrations/20261108172000_persist_loan_submission_alerts.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);

    await login(member);
    await query("insert into public.loan_applications values('LA-2026-0001','Test Member','pending'),('LA-2026-0002','Test Member','approved')");
    await assert.rejects(query("insert into public.loan_applications values('LA-2026-0001','Test Member','pending')"), { code: '23505' });
    assert.deepEqual(await inbox(), []);

    await owner();
    assert.deepEqual((await inbox()).map(({ user_id }) => user_id), [first, second].sort());
    await login(ordinaryAdmin);
    assert.deepEqual(await inbox(), []);
    assert.equal((await query("select title from public.notifications where type='info'"))[0].title, 'Existing info');

    await login(first);
    assert.deepEqual(await inbox(), [{ user_id: first, title: 'New loan application', message: 'Test Member submitted application LA-2026-0001.', read: false }]);
    await assert.rejects(query("update public.notifications set message='changed'"), { code: '42501' });
    await query("update public.notifications set read=true where type='loan_submitted'");
    await login(second);
    assert.equal((await inbox())[0].read, false);
    await login(first);
    assert.equal((await inbox())[0].read, true);
  } finally { await db.close(); }
});
