-- Add member-owned read access to their own receipts, preserve receipt history,
-- use reducing-balance interest for new loans, and require the configured two
-- borrower-declared witnesses at the database boundary.
begin;

alter table public.loan_applications
  add column if not exists interest_calculation_method text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.loan_applications'::regclass
      and conname='loan_interest_calculation_method_check'
  ) then
    alter table public.loan_applications
      add constraint loan_interest_calculation_method_check
      check (interest_calculation_method is null or
        interest_calculation_method in ('diminishing_balance','contract_schedule'));
  end if;
end $$;

create or replace function public.set_new_loan_interest_method()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.interest_calculation_method is null then
    new.interest_calculation_method := 'diminishing_balance';
  end if;
  return new;
end;
$$;
revoke all on function public.set_new_loan_interest_method() from public,anon,authenticated;
drop trigger if exists set_new_loan_interest_method on public.loan_applications;
create trigger set_new_loan_interest_method
before insert on public.loan_applications
for each row execute function public.set_new_loan_interest_method();

-- Keep historical contracts on their recorded schedule. New loans calculate
-- period interest from principal still outstanding at each period boundary.
create or replace function public.counter_payment_interest(loan public.loan_applications,p_date date)
returns numeric language sql stable set search_path=pg_catalog,public as $$
  with due_dates as (
    select installment,
      (loan.date_released + make_interval(months => installment))::date as due_date
    from generate_series(1,greatest(least(
      (extract(year from p_date)::integer-extract(year from loan.date_released)::integer)*12
      + extract(month from p_date)::integer-extract(month from loan.date_released)::integer,
      loan.tenure_months),0)) installment
  ), rate_based_interest as (
    select coalesce(sum(round(greatest(loan.amount-coalesce((
      select sum(p.principal_amount) from public.loan_payments p
      where p.loan_application_id=loan.id and p.payment_status='posted'
        and p.payment_date<case when d.due_date>p_date then p_date else d.due_date end
    ),0),0)*coalesce(loan.interest_rate_at_release,0)/100,2)),0) as amount
    from due_dates d
  )
  select case
    when loan.interest_calculation_method='diminishing_balance'
      then rate_based_interest.amount
    when loan.monthly_payment is not null and loan.tenure_months between 1 and 600
      then greatest(round(loan.monthly_payment*loan.tenure_months-loan.amount,2),0)
    else rate_based_interest.amount
  end
  from rate_based_interest;
$$;
revoke all on function public.counter_payment_interest(public.loan_applications,date) from public,anon,authenticated;

-- Members may read receipts only when the linked member row owns the loan.
-- The policy is read-only and leaves administrator write controls unchanged.
create or replace function public.member_owns_loan(p_loan_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists (
    select 1
    from public.loan_applications a
    join public.members m on m.id=a.member_id
    where a.id=p_loan_id and m.user_id=auth.uid() and m.status='active'
  );
$$;
revoke all on function public.member_owns_loan(uuid) from public,anon;
grant execute on function public.member_owns_loan(uuid) to authenticated;

drop policy if exists member_read_own_loan_payments on public.loan_payments;
create policy member_read_own_loan_payments on public.loan_payments
for select to authenticated
using (public.member_owns_loan(loan_application_id));

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='loan_payments') then
    alter publication supabase_realtime add table public.loan_payments;
  end if;
end $$;

-- This matches the configured workflow: two distinct names are included in
-- the borrower's OTP-confirmed agreement. It does not assert witness identity.
create or replace function public.require_two_loan_witness_names()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare names_count integer;
begin
  if jsonb_typeof(new.witness_names) is distinct from 'array' then
    raise exception 'Please enter both witness names before proceeding.';
  end if;
  if jsonb_array_length(new.witness_names)<>2 then
    raise exception 'Please enter both witness names before proceeding.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.witness_names) n
    where jsonb_typeof(n)<>'string'
      or length(btrim(n#>>'{}')) not between 1 and 160
      or (n#>>'{}') ~ '[[:cntrl:]]'
  ) then
    raise exception 'Enter two valid witness names, each at most 160 characters.';
  end if;
  select count(distinct lower(btrim(n#>>'{}'))) into names_count
  from jsonb_array_elements(new.witness_names) n;
  if names_count<>2 then
    raise exception 'Enter two different witness names.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_two_loan_witness_names() from public,anon,authenticated;
drop trigger if exists require_two_loan_witness_names on public.loan_submission_agreements;
create trigger require_two_loan_witness_names
before insert or update of witness_names on public.loan_submission_agreements
for each row execute function public.require_two_loan_witness_names();

notify pgrst,'reload schema';
commit;
