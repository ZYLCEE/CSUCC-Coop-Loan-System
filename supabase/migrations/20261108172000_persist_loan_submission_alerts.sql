-- Persist the existing Super Admin loan submission alerts in the bell inbox.
begin;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'info', 'success', 'warning', 'error', 'loan_approval', 'loan_rejection', 'payment_reminder', 'loan_submitted'
));
grant select, update (read) on public.notifications to authenticated;

-- Keep loan submission alerts private even where older admin read policies
-- allow access to the rest of the notifications table.
drop policy if exists private_loan_submission_alerts on public.notifications;
create policy private_loan_submission_alerts on public.notifications as restrictive
  for all to authenticated using (
    type is distinct from 'loan_submitted' or (
      user_id = (select auth.uid())
      and (select public.portal_admin_role()) = 'super_admin'
      and (select public.is_coop_admin())
    )
  );

create or replace function public.notify_super_admins_of_loan_submission() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.notifications(user_id,title,message,type,read)
  select u.id,'New loan application',format('%s submitted application %s.',new.member_name,new.application_id),
    'loan_submitted',false
  from auth.users u
  where u.raw_app_meta_data->>'role'='super_admin'
    and coalesce(u.raw_app_meta_data->>'account_status','active')='active'
    and (u.banned_until is null or u.banned_until<now())
    and (
      u.raw_app_meta_data->>'account_status'='active'
      or exists(select 1 from public.members m where m.user_id=u.id and m.status='active')
    )
    and not exists(select 1 from public.members m where m.user_id=u.id and m.status is distinct from 'active');
  return new;
end $$;
revoke all on function public.notify_super_admins_of_loan_submission() from public,anon,authenticated;

drop trigger if exists notify_super_admins_of_loan_submission on public.loan_applications;
create trigger notify_super_admins_of_loan_submission after insert on public.loan_applications
  for each row when (new.status='pending') execute function public.notify_super_admins_of_loan_submission();

commit;
