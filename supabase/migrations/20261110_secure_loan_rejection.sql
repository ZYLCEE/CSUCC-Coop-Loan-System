-- Forward-only addition. Requires the established secure-admin grants/audit schema.
-- Rejection reasons stay in the private audit store, not member-readable loan rows.
begin;

-- Retain every existing notification type while permitting the rejection inbox
-- message. Production currently allows only info/success/warning/error.
do $$
declare predicate text;
begin
  select pg_get_expr(conbin,conrelid) into predicate from pg_constraint
    where conrelid='public.notifications'::regclass
      and conname='notifications_type_check' and contype='c';
  if found and position(quote_literal('loan_rejection') in predicate)=0 then
    alter table public.notifications drop constraint notifications_type_check;
    execute format('alter table public.notifications add constraint notifications_type_check check ((%s) or type = %L)',predicate,'loan_rejection');
  end if;
end $$;

create unique index if not exists loan_rejection_request_unique
  on public.admin_activity_logs ((details->>'request_id'))
  where action_name='reject-loan' and result='success' and details ? 'request_id';

create or replace function public.loan_rejection_capability(p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not public.is_active_secure_admin(p_actor_id) then
    raise exception 'You do not have permission to reject this loan application.' using errcode='42501';
  end if;
  return jsonb_build_object('version',1,'reason_max_length',2000,'statuses',jsonb_build_array('pending','under review'));
end $$;

create or replace function public.reject_loan_application(
  p_actor_id uuid,p_application_id text,p_reason text,p_request_id uuid,p_expected_status text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  loan public.loan_applications;
  prior public.admin_activity_logs;
  decision public.admin_activity_logs;
  actor_name text;
  recipient uuid;
  reason text := regexp_replace(p_reason,'^\s+|\s+$','','g');
begin
  if not public.is_active_secure_admin(p_actor_id) then
    raise exception 'You do not have permission to reject this loan application.' using errcode='42501';
  end if;
  if reason is null or char_length(reason) not between 1 and 2000 then
    raise exception 'Enter a rejection reason of 1 to 2000 characters.' using errcode='22023';
  end if;
  if p_request_id is null or p_expected_status is null or p_expected_status not in ('pending','under review') then
    raise exception 'Invalid rejection request.' using errcode='22023';
  end if;
  select * into loan from public.loan_applications where application_id=p_application_id for update;
  if not found then raise exception 'Loan application not found.' using errcode='P0002'; end if;
  select * into prior from public.admin_activity_logs
    where action_name='reject-loan' and result='success' and details->>'request_id'=p_request_id::text;
  if found then
    if prior.actor_id<>p_actor_id or prior.target_id<>p_application_id
      or prior.details->>'reason' is distinct from reason
      or prior.details->>'previous_status' is distinct from p_expected_status then
      raise exception 'This rejection request was already used for different details.' using errcode='23505';
    end if;
    return jsonb_build_object('application_id',loan.application_id,'status','rejected','decision_id',prior.id);
  end if;
  if loan.status is distinct from p_expected_status or loan.status not in ('pending','under review')
    or loan.date_approved is not null or loan.date_released is not null or loan.date_completed is not null then
    raise exception 'This application has already been updated. Refresh the application details and try again.' using errcode='40001';
  end if;
  select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into actor_name
    from public.members where user_id=p_actor_id limit 1;
  update public.loan_applications set status='rejected',updated_at=clock_timestamp() where id=loan.id;
  insert into public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    values(p_actor_id,'reject-loan',loan.application_id,'success',jsonb_build_object(
      'request_id',p_request_id,'reason',reason,'previous_status',loan.status,'status','rejected','rejected_by_name',actor_name))
    returning * into decision;
  -- Existing member inbox contract: status only, never private administrative reasons.
  select user_id into recipient from public.members where id=loan.member_id;
  if recipient is not null then
    insert into public.notifications(user_id,title,message,type,read)
      values(recipient,'Loan application rejected',format('Your loan application %s has been rejected.',loan.application_id),'loan_rejection',false);
  end if;
  return jsonb_build_object('application_id',loan.application_id,'status','rejected','decision_id',decision.id);
end $$;

create or replace function public.loan_rejection_details(p_application_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare decision public.admin_activity_logs;
begin
  if not exists(select 1 from auth.users u where u.id=auth.uid()
    and u.raw_app_meta_data->>'role' in ('admin','coop_admin','super_admin')
    and coalesce(u.raw_app_meta_data->>'account_status','active')='active'
    and (u.banned_until is null or u.banned_until<now())
    and (u.raw_app_meta_data->>'account_status'='active' or exists(select 1 from public.members m where m.user_id=u.id and m.status='active'))
    and not exists(select 1 from public.members m where m.user_id=u.id and m.status is distinct from 'active')) then
    raise exception 'Administrative access required.' using errcode='42501';
  end if;
  select * into decision from public.admin_activity_logs
    where action_name='reject-loan' and result='success' and target_id=p_application_id and details ? 'reason'
    order by created_at desc,id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('reason',decision.details->>'reason','rejected_at',decision.created_at,
    'rejected_by',decision.details->>'rejected_by_name');
end $$;

revoke all on function public.loan_rejection_capability(uuid) from public,anon,authenticated;
revoke all on function public.reject_loan_application(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.loan_rejection_capability(uuid) to service_role;
grant execute on function public.reject_loan_application(uuid,text,text,uuid,text) to service_role;
revoke all on function public.loan_rejection_details(text) from public,anon;
grant execute on function public.loan_rejection_details(text) to authenticated;
commit;
