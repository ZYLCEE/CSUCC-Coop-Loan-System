-- Assess this month's interest when a payment is made before the monthly due day.
begin;

create or replace function public.counter_payment_interest(loan public.loan_applications,p_date date)
returns numeric language sql stable set search_path=pg_catalog,public as $$
  with due_dates as (
    select installment,
      (loan.date_released + make_interval(months => installment))::date as due_date
    from generate_series(1,greatest(least(
      (extract(year from p_date)::integer-extract(year from loan.date_released)::integer)*12
      + extract(month from p_date)::integer-extract(month from loan.date_released)::integer,
      loan.tenure_months),0)) installment
  )
  select coalesce(sum(round(greatest(loan.amount-coalesce((
    select sum(p.principal_amount) from public.loan_payments p
    where p.loan_application_id=loan.id and p.payment_status='posted'
      and p.payment_date<case when d.due_date>p_date then p_date else d.due_date end
  ),0),0)*coalesce(loan.interest_rate_at_release,0)/100,2)),0)
  from due_dates d;
$$;
revoke all on function public.counter_payment_interest(public.loan_applications,date) from public,anon,authenticated;

-- The owner authorized the current policy rate for this legacy loan. New loans
-- continue to snapshot the rate at release; this update is limited to this row.
update public.loan_applications loan
set interest_rate_at_release=policy.base_interest_rate
from public.loan_policy_settings policy
where policy.singleton
  and loan.application_id='LA-2026-884764'
  and loan.interest_rate_at_release is null
  and policy.base_interest_rate is not null
  and policy.base_interest_rate>=0;

notify pgrst,'reload schema';
commit;
