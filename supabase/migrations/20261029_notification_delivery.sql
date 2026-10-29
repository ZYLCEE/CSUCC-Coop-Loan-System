-- Adds the delivery ledger used by the existing protected notification sender.
-- Incoming user notifications remain scoped by the existing RLS policies.
begin;
alter table public.notifications
  add column if not exists send_to text,
  add column if not exists recipient_summary text,
  add column if not exists recipient_count integer,
  add column if not exists member_id text,
  add column if not exists member_name text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists status text;
grant select on public.notifications to authenticated,service_role;
grant select on public.announcements,public.announcement_categories to service_role;

create or replace function public.notification_service_status() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare enabled boolean:=false;
begin
  if public.portal_admin_role() is distinct from 'super_admin' then raise insufficient_privilege; end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute 'select exists(select 1 from cron.job where jobname=''coop-deliver-notifications'' and active)' into enabled;
  end if;
  return jsonb_build_object('scheduling_enabled',enabled,'delivery_enabled',true);
end $$;

create or replace function public.deliver_notification_outbox() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare recipients uuid[]; scheduler_enabled boolean:=false;
begin
  -- Inbox writes (including announcement delivery) do not re-enter the outbox.
  if new.user_id is not null or new.send_to is null then return new; end if;
  if tg_op='UPDATE' and old.status='sent' then return new; end if;
  if new.send_to not in ('allMembers','specificMember','activeLoanMembers') then raise exception 'Unsupported recipient target'; end if;
  if new.scheduled_at is not null and new.scheduled_at > now() then
    if exists(select 1 from pg_extension where extname='pg_cron') then
      execute 'select exists(select 1 from cron.job where jobname=''coop-deliver-notifications'' and active)' into scheduler_enabled;
    end if;
    if not scheduler_enabled then raise exception 'Enable the notification scheduler first'; end if;
    new.status:='scheduled';
    return new;
  end if;
  select array_agg(distinct m.user_id) into recipients from public.members m
    where m.user_id is not null and m.role='member' and m.status='active'
      and (new.send_to='allMembers'
        or (new.send_to='specificMember' and m.member_id=new.member_id)
        or (new.send_to='activeLoanMembers' and exists(select 1 from public.loan_applications l where l.member_id=m.id and l.status in ('approved','released','overdue'))));
  if coalesce(cardinality(recipients),0)=0 then raise exception 'No active linked member recipients'; end if;
  insert into public.notifications(user_id,title,message,type)
    select recipient,new.title,new.message,new.type from unnest(recipients) recipient;
  new.recipient_count:=cardinality(recipients);
  new.recipient_summary:=new.recipient_count::text || ' members';
  new.status:='sent';
  return new;
end $$;
drop trigger if exists portal_notification_outbox on public.notifications;
create trigger portal_notification_outbox before insert or update of status on public.notifications
  for each row execute function public.deliver_notification_outbox();

create or replace function public.deliver_scheduled_notifications() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare total integer;
begin
  -- Row locking makes concurrent workers deliver an outbox entry only once.
  with ready as (select id from public.notifications
    where user_id is null and send_to is not null and status='scheduled' and scheduled_at<=now()
    for update skip locked)
  update public.notifications set status='sent' where id in (select id from ready);
  get diagnostics total=row_count;
  return total;
end $$;
revoke all on function public.deliver_notification_outbox() from public,anon,authenticated;
revoke all on function public.deliver_scheduled_notifications() from public,anon,authenticated;
grant execute on function public.deliver_scheduled_notifications() to service_role;
revoke all on function public.notification_service_status() from public,anon;
grant execute on function public.notification_service_status() to authenticated;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if not exists(select 1 from cron.job where jobname='coop-deliver-notifications') then
      perform cron.schedule('coop-deliver-notifications','* * * * *','select public.deliver_scheduled_notifications()');
    end if;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
