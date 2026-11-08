begin;

-- Account creation stores Member as the profile role. Keep existing
-- lowercase member profiles eligible for the same notification delivery.
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
    where m.user_id is not null and lower(btrim(m.role))='member' and m.status='active'
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

commit;
