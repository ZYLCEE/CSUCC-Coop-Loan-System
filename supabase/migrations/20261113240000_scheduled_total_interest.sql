-- For loans with a saved monthly installment and term, the installment
-- schedule defines the contract total. Include all scheduled interest in the
-- outstanding ledger instead of waiting until future installment due dates.
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
  ), rate_based_interest as (
    select coalesce(sum(round(greatest(loan.amount-coalesce((
      select sum(p.principal_amount) from public.loan_payments p
      where p.loan_application_id=loan.id and p.payment_status='posted'
        and p.payment_date<case when d.due_date>p_date then p_date else d.due_date end
    ),0),0)*coalesce(loan.interest_rate_at_release,0)/100,2)),0) as amount
    from due_dates d
  )
  select case
    when loan.monthly_payment is not null and loan.tenure_months between 1 and 600
      then greatest(round(loan.monthly_payment*loan.tenure_months-loan.amount,2),0)
    else rate_based_interest.amount
  end
  from rate_based_interest;
$$;
revoke all on function public.counter_payment_interest(public.loan_applications,date) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
