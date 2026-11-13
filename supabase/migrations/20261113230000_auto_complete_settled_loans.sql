-- Keep the loan status aligned with the full repayment balance. A loan is
-- completed only after principal, scheduled interest, and penalties are paid.
begin;

create or replace function public.sync_loan_payment_status()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare loan_id uuid; loan public.loan_applications; remaining numeric;
  principal_paid numeric; interest_paid numeric; interest_due numeric;
  penalty_paid numeric; penalty_due numeric; unallocated integer;
  as_of_date date := (now() at time zone 'Asia/Manila')::date;
begin
  loan_id := coalesce(new.loan_application_id,old.loan_application_id);
  select * into loan from public.loan_applications where id=loan_id for update;
  if not found or loan.status not in ('released','overdue','completed') then
    return coalesce(new,old);
  end if;

  select coalesce(sum(principal_amount),0),coalesce(sum(interest_amount),0),
    coalesce(sum(penalty_amount),0),count(*) filter(where principal_amount is null)
    into principal_paid,interest_paid,penalty_paid,unallocated
    from public.loan_payments where loan_application_id=loan_id and payment_status='posted';
  if unallocated>0 then
    return coalesce(new,old);
  end if;
  interest_due := public.counter_payment_interest(loan,as_of_date);
  if loan.interest_rate_at_release is null then
    interest_due := greatest(interest_due,interest_paid);
  end if;
  penalty_due := public.counter_payment_penalty(loan,as_of_date);
  if interest_due is null or penalty_due is null then
    return coalesce(new,old);
  end if;
  remaining := greatest(loan.amount-principal_paid,0)
    + greatest(interest_due-interest_paid,0)+greatest(penalty_due-penalty_paid,0);

  if remaining<=0 and loan.status<>'completed' then
    update public.loan_applications set status='completed',
      date_completed=coalesce(new.payment_date,as_of_date),updated_at=clock_timestamp()
    where id=loan_id;
  elsif remaining>0 and loan.status='completed' then
    update public.loan_applications set status=case
        when penalty_due>penalty_paid then 'overdue'
        else 'released' end,
      date_completed=null,updated_at=clock_timestamp()
    where id=loan_id;
  end if;
  return coalesce(new,old);
end $$;
revoke all on function public.sync_loan_payment_status() from public,anon,authenticated;

drop trigger if exists sync_loan_payment_status on public.loan_payments;
create trigger sync_loan_payment_status
after insert or update of payment_status, payment_amount, principal_amount, interest_amount, penalty_amount, fee_amount
on public.loan_payments for each row execute function public.sync_loan_payment_status();

notify pgrst,'reload schema';
commit;
