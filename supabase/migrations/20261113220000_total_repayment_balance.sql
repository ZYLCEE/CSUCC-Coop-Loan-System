-- Expose the complete unpaid amount in repayment views: remaining principal,
-- contract interest, and accrued penalties. Release fees stay excluded since
-- they were deducted from proceeds and are not charged again at payment time.
begin;

create or replace function public.loan_payment_ledger(p_loan_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare loan public.loan_applications; paid numeric; principal_paid numeric; penalty_paid numeric;
  penalty_due numeric; interest_paid numeric; interest_due numeric; interest_remaining numeric;
  penalty_remaining numeric; principal_remaining numeric; total_remaining numeric;
  unallocated integer; entries jsonb; automatic_allocation boolean := false;
  as_of_date date := (now() at time zone 'Asia/Manila')::date;
begin
  if coalesce(public.counter_payment_role(),'') not in ('super_admin','admin','coop_admin') then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  select * into loan from public.loan_applications where id=p_loan_id;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  select coalesce(sum(payment_amount),0),coalesce(sum(principal_amount),0),
    coalesce(sum(penalty_amount),0),coalesce(sum(interest_amount),0),
    count(*) filter(where principal_amount is null)
    into paid,principal_paid,penalty_paid,interest_paid,unallocated
    from public.loan_payments where loan_application_id=p_loan_id and payment_status='posted';
  interest_due := public.counter_payment_interest(loan,as_of_date);
  if loan.interest_rate_at_release is null then
    interest_due := greatest(interest_due,interest_paid);
  end if;
  penalty_due := public.counter_payment_penalty(loan,as_of_date);
  interest_remaining := greatest(interest_due-interest_paid,0);
  penalty_remaining := greatest(penalty_due-penalty_paid,0);
  principal_remaining := loan.amount-principal_paid;
  if unallocated=0 then
    total_remaining := greatest(principal_remaining,0)+interest_remaining+penalty_remaining;
  end if;
  if loan.status in ('released','overdue') and loan.date_released is not null and loan.amount>0
    and loan.tenure_months between 1 and 600 and unallocated=0 then
    automatic_allocation := coalesce(penalty_due>=penalty_paid and interest_due>=interest_paid,false);
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by payment_date desc,created_at desc,id),'[]'::jsonb)
    into entries from public.loan_payments p where loan_application_id=p_loan_id;
  return jsonb_build_object('loan_id',loan.id,'application_id',loan.application_id,'member_name',loan.member_name,
    'status',loan.status,'date_released',loan.date_released,'principal',loan.amount,'total_received',paid,
    'principal_paid',principal_paid,'principal_remaining',case when unallocated=0 then principal_remaining else null end,
    'interest_paid',interest_paid,'interest_due',interest_due,'interest_remaining',interest_remaining,
    'penalty_paid',penalty_paid,'penalty_due',penalty_due,'penalty_remaining',penalty_remaining,
    'total_remaining',total_remaining,'interest_rate_at_release',loan.interest_rate_at_release,
    'processing_fee_amount_at_release',loan.processing_fee_amount_at_release,
    'service_fee_amount_at_release',loan.service_fee_amount_at_release,
    'unallocated_payments',unallocated,'automatic_allocation',automatic_allocation,'payments',entries);
end $$;
revoke all on function public.loan_payment_ledger(uuid) from public,anon;
grant execute on function public.loan_payment_ledger(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
