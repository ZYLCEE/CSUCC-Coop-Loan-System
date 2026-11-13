-- Preserve already-posted interest for legacy loans without a release-time
-- rate snapshot. These loans do not accrue new interest automatically.
begin;

create or replace function public.calculate_counter_payment(
  loan public.loan_applications,p_date date,p_amount numeric
) returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare principal_paid numeric; penalty_paid numeric; interest_paid numeric;
  penalty_due numeric; interest_due numeric; latest_receipt date; unallocated integer;
  applied_penalty numeric; applied_interest numeric; applied_principal numeric;
begin
  if loan.status not in ('released','overdue') or loan.date_released is null then
    raise exception 'Payments can only be recorded against released or overdue loans with a release date.';
  end if;
  if p_date is null or not isfinite(p_date) or p_date<loan.date_released
    or p_date>(now() at time zone 'Asia/Manila')::date then
    raise exception 'Enter a payment date from the release date through today.';
  end if;
  if p_amount is null or not (p_amount between 0.01 and 999999999.99) or p_amount<>round(p_amount,2) then
    raise exception 'Enter a positive amount with at most two decimal places.';
  end if;
  if loan.tenure_months is null or loan.tenure_months not between 1 and 600 or loan.amount<=0 then
    raise exception 'The loan needs a recorded repayment term to calculate the payment.';
  end if;

  select coalesce(sum(principal_amount),0),coalesce(sum(penalty_amount),0),
    coalesce(sum(interest_amount),0),max(payment_date),
    count(*) filter(where principal_amount is null)
    into principal_paid,penalty_paid,interest_paid,latest_receipt,unallocated
    from public.loan_payments where loan_application_id=loan.id and payment_status='posted';
  if unallocated>0 then
    raise exception 'Existing payments need their principal allocation reconciled before recording more payments.';
  end if;
  if latest_receipt>p_date then
    raise exception 'This receipt predates a posted payment. Reconcile the ledger before recording it.';
  end if;

  penalty_due := public.counter_payment_penalty(loan,p_date);
  interest_due := public.counter_payment_interest(loan,p_date);
  -- With no rate snapshot, don't back-charge unknown periods. Keep any
  -- interest already posted as a satisfied baseline instead of rejecting it.
  if loan.interest_rate_at_release is null then
    interest_due := greatest(interest_due,interest_paid);
  end if;
  if penalty_due<penalty_paid then
    raise exception 'Recorded penalties exceed the calculated balance. Reconcile the ledger before recording this payment.';
  end if;
  if interest_due<interest_paid then
    raise exception 'Recorded interest exceeds the calculated balance. Reconcile the ledger before recording this payment.';
  end if;

  -- Existing penalty-first allocation is preserved; accrued interest is paid
  -- next, then the remaining amount reduces principal.
  applied_penalty := least(p_amount,penalty_due-penalty_paid);
  applied_interest := least(p_amount-applied_penalty,interest_due-interest_paid);
  applied_principal := p_amount-applied_penalty-applied_interest;
  if applied_principal>loan.amount-principal_paid then
    raise exception 'The amount exceeds the remaining principal and late charges.';
  end if;
  return jsonb_build_object('principal',applied_principal,'interest',applied_interest,
    'penalty',applied_penalty,'fee',0);
end $$;
revoke all on function public.calculate_counter_payment(public.loan_applications,date,numeric) from public,anon,authenticated;

create or replace function public.loan_payment_ledger(p_loan_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare loan public.loan_applications; paid numeric; principal_paid numeric; penalty_paid numeric;
  interest_paid numeric; interest_due numeric; unallocated integer; entries jsonb;
  automatic_allocation boolean := false;
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
  interest_due := public.counter_payment_interest(loan,(now() at time zone 'Asia/Manila')::date);
  -- Keep posted interest as satisfied for legacy loans whose rate is unknown.
  if loan.interest_rate_at_release is null then
    interest_due := greatest(interest_due,interest_paid);
  end if;
  if loan.status in ('released','overdue') and loan.date_released is not null and loan.amount>0
    and loan.tenure_months between 1 and 600 and unallocated=0 then
    automatic_allocation := coalesce(
      public.counter_payment_penalty(loan,(now() at time zone 'Asia/Manila')::date)>=penalty_paid
      and interest_due>=interest_paid,false);
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by payment_date desc,created_at desc,id),'[]'::jsonb)
    into entries from public.loan_payments p where loan_application_id=p_loan_id;
  return jsonb_build_object('loan_id',loan.id,'application_id',loan.application_id,'member_name',loan.member_name,
    'status',loan.status,'date_released',loan.date_released,'principal',loan.amount,'total_received',paid,
    'principal_paid',principal_paid,'interest_paid',interest_paid,'interest_due',interest_due,
    'interest_rate_at_release',loan.interest_rate_at_release,
    'processing_fee_amount_at_release',loan.processing_fee_amount_at_release,
    'service_fee_amount_at_release',loan.service_fee_amount_at_release,
    'unallocated_payments',unallocated,'automatic_allocation',automatic_allocation,
    'principal_remaining',case when unallocated=0 then loan.amount-principal_paid else null end,'payments',entries);
end $$;
revoke all on function public.loan_payment_ledger(uuid) from public,anon;
grant execute on function public.loan_payment_ledger(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
