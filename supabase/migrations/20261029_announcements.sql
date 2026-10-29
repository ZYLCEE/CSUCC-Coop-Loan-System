-- Apply in the project's SQL Editor. Adds the announcement service expected by
-- the portal. Existing member, loan and notification records are preserved.
begin;
create or replace function public.portal_admin_role() returns text
language sql stable security definer set search_path = public, auth, pg_temp as $$
  select raw_app_meta_data->>'role' from auth.users
  where id=auth.uid() and coalesce(raw_app_meta_data->>'account_status','active')='active'
    and (banned_until is null or banned_until < now())
$$;
revoke all on function public.portal_admin_role() from public;
grant execute on function public.portal_admin_role() to authenticated;

create table if not exists public.announcement_categories (
  id uuid primary key default gen_random_uuid(), name text unique not null,
  sort_order integer not null default 0
);
insert into public.announcement_categories(name,sort_order) values
  ('General',1),('Loans',2),('Events',3),('Maintenance',4) on conflict(name) do nothing;
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(trim(title)) between 1 and 160),
  content text not null default '' check(length(content)<=20000),
  category_id uuid not null references public.announcement_categories(id),
  status text not null default 'draft' check(status in ('draft','published','scheduled','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  published_at timestamptz, scheduled_at timestamptz, author_name text,
  notify_members boolean not null default false,
  check(status <> 'published' or published_at is not null),
  check(status <> 'scheduled' or scheduled_at is not null)
);
alter table public.announcements enable row level security;
alter table public.announcement_categories enable row level security;
drop policy if exists portal_announcement_read on public.announcements;
create policy portal_announcement_read on public.announcements for select to authenticated
  using(public.portal_admin_role() in ('admin','coop_admin','super_admin') or status='published');
drop policy if exists portal_category_read on public.announcement_categories;
create policy portal_category_read on public.announcement_categories for select to authenticated using(true);
grant select on public.announcements,public.announcement_categories to authenticated,service_role;
revoke insert,update,delete on public.announcements,public.announcement_categories from authenticated,anon;

create or replace function public.announcement_service_status() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare enabled boolean := false;
begin
  if public.portal_admin_role() not in ('admin','coop_admin','super_admin') or public.portal_admin_role() is null then raise insufficient_privilege; end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute 'select exists(select 1 from cron.job where jobname=''coop-publish-announcements'' and active)' into enabled;
  end if;
  return jsonb_build_object('scheduling_enabled',enabled,'notifications_enabled',true);
end $$;

create or replace function public.manage_announcement(
  p_action text, p_id uuid, p_expected_updated_at timestamptz, p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare old public.announcements; next_status text; next_schedule timestamptz; stamp timestamptz:=clock_timestamp();
begin
  if public.portal_admin_role() is distinct from 'super_admin' then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtext('announcement:' || p_id::text));
  select * into old from public.announcements where id=p_id for update;
  if old.id is not null and (p_expected_updated_at is null or old.updated_at <> p_expected_updated_at) then raise exception 'Announcement changed; refresh first.' using errcode='40001'; end if;
  if old.id is null and (p_action <> 'save' or p_expected_updated_at is not null) then raise exception 'Announcement not found or removed.' using errcode='40001'; end if;
  if p_action='save' then
    next_status:=p_payload->>'status';
    if next_status not in ('draft','published','scheduled') or next_status is null then raise exception 'Invalid announcement status'; end if;
    if next_status <> 'draft' and length(trim(coalesce(p_payload->>'content','')))=0 then raise exception 'Content is required'; end if;
    if old.status='archived' then raise exception 'Restore the announcement before editing'; end if;
    if next_status='scheduled' then
      if not (public.announcement_service_status()->>'scheduling_enabled')::boolean then raise exception 'Scheduler unavailable' using errcode='55000'; end if;
      next_schedule:=(p_payload->>'scheduled_at')::timestamptz;
      if next_schedule is null or next_schedule<=stamp then raise exception 'Schedule must be in the future'; end if;
    end if;
    insert into public.announcements(id,title,content,category_id,status,updated_at,published_at,scheduled_at,author_name,notify_members)
    values(p_id,trim(p_payload->>'title'),coalesce(p_payload->>'content',''),(p_payload->>'category_id')::uuid,next_status,stamp,
      coalesce(old.published_at,case when next_status='published' then stamp end),next_schedule,
      coalesce(old.author_name,(select email from auth.users where id=auth.uid())),coalesce((p_payload->>'notify_members')::boolean,false))
    on conflict(id) do update set title=excluded.title,content=excluded.content,category_id=excluded.category_id,status=excluded.status,
      updated_at=excluded.updated_at,published_at=excluded.published_at,scheduled_at=excluded.scheduled_at,notify_members=excluded.notify_members;
    if next_status='published' and old.published_at is null and coalesce((p_payload->>'notify_members')::boolean,false) then
      insert into public.notifications(user_id,title,message,type)
        select distinct user_id,left(p_payload->>'title',200),p_payload->>'content','info'
        from public.members where user_id is not null and status='active' and role='member';
    end if;
  elsif p_action='delete' and old.status='draft' and old.published_at is null then
    delete from public.announcements where id=p_id;
  elsif p_action='archive' and old.status='published' then
    update public.announcements set status='archived',scheduled_at=null,updated_at=stamp where id=p_id;
  elsif p_action='restore' and old.status='archived' then
    update public.announcements set status='draft',scheduled_at=null,updated_at=stamp where id=p_id;
  elsif p_action='cancel_schedule' and old.status='scheduled' then
    update public.announcements set status='draft',scheduled_at=null,updated_at=stamp where id=p_id;
  else raise exception 'Unsupported announcement transition'; end if;
  return jsonb_build_object('id',p_id,'success',true);
end $$;

create or replace function public.publish_due_announcements() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.announcements; total integer:=0;
begin
  for item in select * from public.announcements where status='scheduled' and scheduled_at<=now() for update skip locked loop
    update public.announcements set status='published',published_at=coalesce(published_at,now()),scheduled_at=null,updated_at=clock_timestamp() where id=item.id;
    if item.notify_members and item.published_at is null then
      insert into public.notifications(user_id,title,message,type)
        select distinct user_id,left(item.title,200),item.content,'info'
        from public.members where user_id is not null and status='active' and role='member';
    end if;
    total:=total+1;
  end loop;
  return total;
end $$;
revoke all on function public.publish_due_announcements() from public,anon,authenticated;
grant execute on function public.publish_due_announcements() to service_role;
revoke all on function public.manage_announcement(text,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.manage_announcement(text,uuid,timestamptz,jsonb) to authenticated;
revoke all on function public.announcement_service_status() from public,anon;
grant execute on function public.announcement_service_status() to authenticated;

-- Existing pg_cron installations can publish schedules without a browser being open.
-- If pg_cron is not enabled, draft/publish/archive still work and scheduling is
-- explicitly unavailable until the extension is enabled and this script is rerun.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if not exists(select 1 from cron.job where jobname='coop-publish-announcements') then
      perform cron.schedule('coop-publish-announcements','* * * * *','select public.publish_due_announcements()');
    end if;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
