-- Reconcile loans that were already settled before the payment status trigger
-- was installed. Use the same balances as the current repayment ledger.
begin;

do $$
declare
  loan public.loan_applications;
  principal_paid numeric;
  interest_paid numeric;
  interest_due numeric;
  penalty_paid numeric;
  penalty_due numeric;
  latest_payment_date date;
  unallocated integer;
  remaining numeric;
  as_of_date date := (now() at time zone 'Asia/Manila')::date;
begin
  for loan in
    select * from public.loan_applications
    where status in ('released','overdue','completed')
      and date_released is not null
      and amount > 0
      and tenure_months between 1 and 600
  loop
    select coalesce(sum(p.principal_amount),0),
      coalesce(sum(p.interest_amount),0),
      coalesce(sum(p.penalty_amount),0),
      max(p.payment_date),
      count(*) filter (where p.principal_amount is null)
    into principal_paid,interest_paid,penalty_paid,latest_payment_date,unallocated
    from public.loan_payments p
    where p.loan_application_id=loan.id and p.payment_status='posted';

    -- Leave uncertain histories untouched until their allocations are fixed.
    if unallocated > 0 then
      continue;
    end if;

    interest_due := public.counter_payment_interest(loan,as_of_date);
    if loan.interest_rate_at_release is null then
      interest_due := greatest(interest_due,interest_paid);
    end if;
    penalty_due := public.counter_payment_penalty(loan,as_of_date);
    if interest_due is null or penalty_due is null then
      continue;
    end if;

    remaining := greatest(loan.amount-principal_paid,0)
      + greatest(interest_due-interest_paid,0)
      + greatest(penalty_due-penalty_paid,0);

    if remaining <= 0 and (loan.status <> 'completed' or loan.date_completed is null) then
      update public.loan_applications
      set status='completed',
        date_completed=coalesce(loan.date_completed,latest_payment_date,as_of_date),
        updated_at=clock_timestamp()
      where id=loan.id;
    elsif remaining > 0 and loan.status='completed' then
      update public.loan_applications
      set status=case when penalty_due > penalty_paid then 'overdue' else 'released' end,
        date_completed=null,
        updated_at=clock_timestamp()
      where id=loan.id;
    end if;
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
