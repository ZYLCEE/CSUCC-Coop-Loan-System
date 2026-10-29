-- Apply in Supabase SQL Editor. Records funds already disbursed at the counter.
-- This migration never releases an existing loan automatically.
begin;
alter table public.loan_applications
  add column if not exists release_reference text,
  add column if not exists release_notes text,
  add column if not exists released_by uuid references auth.users(id),
  add column if not exists released_by_name text,
  add column if not exists release_request_id uuid;

create unique index if not exists loan_release_request_unique
  on public.loan_applications(release_request_id) where release_request_id is not null;
create unique index if not exists loan_release_reference_unique
  on public.loan_applications(lower(btrim(release_reference))) where release_reference is not null;

create or replace function public.release_approved_loan(
  p_application_id text,p_request_id uuid,p_date date,p_reference text,
  p_expected_amount numeric,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare loan public.loan_applications; actor_name text;
begin
  if not exists(select 1 from auth.users where id=auth.uid()
    and raw_app_meta_data->>'role'='super_admin'
    and coalesce(raw_app_meta_data->>'account_status','active')='active'
    and (banned_until is null or banned_until < now()))
    then raise exception 'Super Admin access required.' using errcode='42501'; end if;
  if p_request_id is null or p_reference is null or length(btrim(p_reference)) not between 1 and 80
    or coalesce(length(p_notes),0)>2000 then raise exception 'Enter a disbursement reference of 1 to 80 characters and notes of up to 2000 characters.'; end if;
  if p_date is null or p_date>(now() at time zone 'Asia/Manila')::date then raise exception 'Release date cannot be in the future.'; end if;
  select * into loan from public.loan_applications where application_id=p_application_id for update;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  -- A retry of the same request returns the recorded release, without repeating audit entries.
  if loan.release_request_id=p_request_id then
    if loan.released_by<>auth.uid() or loan.date_released<>p_date or loan.release_reference<>btrim(p_reference)
      or coalesce(loan.release_notes,'')<>coalesce(p_notes,'') or p_expected_amount is null or loan.amount<>p_expected_amount
      then raise exception 'This request was already used for different release details.' using errcode='23505'; end if;
    return jsonb_build_object('id',loan.id,'application_id',loan.application_id,'status',loan.status,
      'date_released',loan.date_released,'release_reference',loan.release_reference,'amount',loan.amount);
  end if;
  if loan.status<>'approved' or loan.date_released is not null or loan.date_completed is not null
    then raise exception 'Only approved loans that have not been released or completed can be marked as released.'; end if;
  if loan.date_approved is null then raise exception 'The approval date must be recorded before releasing this loan.'; end if;
  if p_date<loan.date_approved or p_date<loan.date_submitted then raise exception 'Release date cannot be earlier than approval or submission.'; end if;
  if p_expected_amount is null or p_expected_amount<>loan.amount or loan.amount<=0
    then raise exception 'The loan amount changed or is invalid. Refresh the application and review it again.'; end if;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,id::text) into actor_name from auth.users where id=auth.uid();
  update public.loan_applications set status='released',date_released=p_date,updated_at=clock_timestamp(),
    release_reference=btrim(p_reference),release_notes=coalesce(p_notes,''),released_by=auth.uid(),
    released_by_name=actor_name,release_request_id=p_request_id where id=loan.id;
  insert into public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    values(auth.uid(),'release-loan',loan.application_id,'success',jsonb_build_object(
      'loan_id',loan.id,'amount',loan.amount,'release_date',p_date,'disbursement_reference',btrim(p_reference),
      'previous_status',loan.status,'status','released','notes',coalesce(p_notes,'')));
  return jsonb_build_object('id',loan.id,'application_id',loan.application_id,'status','released',
    'date_released',p_date,'release_reference',btrim(p_reference),'amount',loan.amount);
end $$;
revoke all on function public.release_approved_loan(text,uuid,date,text,numeric,text) from public,anon;
grant execute on function public.release_approved_loan(text,uuid,date,text,numeric,text) to authenticated;
commit;
