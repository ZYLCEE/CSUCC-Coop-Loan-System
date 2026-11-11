-- Snapshot new loan terms at release, record one-time release fees, and
-- calculate repayment interest only for loans released with a rate snapshot.
begin;

alter table public.loan_applications
  add column if not exists interest_rate_at_release numeric,
  add column if not exists processing_fee_rate_at_release numeric,
  add column if not exists service_fee_rate_at_release numeric,
  add column if not exists processing_fee_amount_at_release numeric(14,2),
  add column if not exists service_fee_amount_at_release numeric(14,2);

create or replace function public.snapshot_loan_repayment_terms() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare policy public.loan_policy_settings;
begin
  if new.date_released is not null
    and (tg_op = 'INSERT' or old.date_released is null)
    and new.interest_rate_at_release is null then
    select * into policy from public.loan_policy_settings where singleton;
    if not found then raise exception 'Loan policy settings must be configured before releasing a loan.'; end if;
    if policy.base_interest_rate is null or policy.base_interest_rate < 0
      or policy.processing_fee_percent is null or policy.processing_fee_percent < 0
      or policy.service_fee_percent is null or policy.service_fee_percent < 0 then
      raise exception 'Loan policy rates must be valid and nonnegative before releasing a loan.';
    end if;
    new.interest_rate_at_release := policy.base_interest_rate;
    new.processing_fee_rate_at_release := policy.processing_fee_percent;
    new.service_fee_rate_at_release := policy.service_fee_percent;
    new.processing_fee_amount_at_release := round(new.amount * policy.processing_fee_percent / 100, 2);
    new.service_fee_amount_at_release := round(new.amount * policy.service_fee_percent / 100, 2);
  end if;
  return new;
end $$;
revoke all on function public.snapshot_loan_repayment_terms() from public,anon,authenticated;

drop trigger if exists snapshot_loan_repayment_terms on public.loan_applications;
create trigger snapshot_loan_repayment_terms before insert or update on public.loan_applications
for each row execute function public.snapshot_loan_repayment_terms();

-- Unknown periods before the first recorded rate are not back-charged.
-- Installments past the loan term are not assessed again.
create or replace function public.counter_payment_penalty(loan public.loan_applications,p_date date)
returns numeric language sql stable set search_path=pg_catalog,public as $$
  with due_dates as (
    select installment,
      (loan.date_released + make_interval(months => installment))::date as due_date
    from generate_series(1,greatest(least(
      (extract(year from p_date)::integer-extract(year from loan.date_released)::integer)*12
      + extract(month from p_date)::integer-extract(month from loan.date_released)::integer,
      loan.tenure_months),0)) installment
  ), assessments as (
    select greatest(round(loan.amount*least(d.installment,loan.tenure_months)/loan.tenure_months,2)
      - coalesce((select sum(p.principal_amount) from public.loan_payments p
        where p.loan_application_id=loan.id and p.payment_status='posted' and p.payment_date<=d.due_date),0),0) as overdue,
      (select rate from public.counter_payment_penalty_rates where effective_date<=d.due_date+1
        order by effective_date desc limit 1) as rate
    from due_dates d where d.due_date<p_date
  )
  select coalesce(sum(round(overdue*coalesce(rate,0)/100,2)),0)
  from assessments;
$$;
revoke all on function public.counter_payment_penalty(public.loan_applications,date) from public,anon,authenticated;

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
      and p.payment_date<d.due_date
  ),0),0)*coalesce(loan.interest_rate_at_release,0)/100,2)),0)
  from due_dates d where d.due_date<=p_date;
$$;
revoke all on function public.counter_payment_interest(public.loan_applications,date) from public,anon,authenticated;

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
  if loan.status in ('released','overdue') and loan.date_released is not null and loan.amount>0
    and loan.tenure_months between 1 and 600 and unallocated=0 then
    automatic_allocation := public.counter_payment_penalty(loan,(now() at time zone 'Asia/Manila')::date)>=penalty_paid
      and interest_due>=interest_paid;
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

create or replace function public.release_approved_loan(
  p_application_id text,p_request_id uuid,p_date date,p_reference text,
  p_expected_amount numeric,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare loan public.loan_applications; actor_name text; policy public.loan_policy_settings;
  processing_fee numeric; service_fee numeric; net_proceeds numeric;
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
  if loan.release_request_id=p_request_id then
    if loan.released_by<>auth.uid() or loan.date_released<>p_date or loan.release_reference<>btrim(p_reference)
      or coalesce(loan.release_notes,'')<>coalesce(p_notes,'') or p_expected_amount is null or loan.amount<>p_expected_amount
      then raise exception 'This request was already used for different release details.' using errcode='23505'; end if;
    return jsonb_build_object('id',loan.id,'application_id',loan.application_id,'status',loan.status,
      'date_released',loan.date_released,'release_reference',loan.release_reference,'amount',loan.amount,
      'interest_rate_at_release',loan.interest_rate_at_release,
      'processing_fee_amount_at_release',loan.processing_fee_amount_at_release,
      'service_fee_amount_at_release',loan.service_fee_amount_at_release,
      'net_proceeds',loan.amount-coalesce(loan.processing_fee_amount_at_release,0)
        -coalesce(loan.service_fee_amount_at_release,0));
  end if;
  if loan.status<>'approved' or loan.date_released is not null or loan.date_completed is not null
    then raise exception 'Only approved loans that have not been released or completed can be marked as released.'; end if;
  if loan.date_approved is null then raise exception 'The approval date must be recorded before releasing this loan.'; end if;
  if p_date<loan.date_approved or p_date<loan.date_submitted then raise exception 'Release date cannot be earlier than approval or submission.'; end if;
  if p_expected_amount is null or p_expected_amount<>loan.amount or loan.amount<=0
    then raise exception 'The loan amount changed or is invalid. Refresh the application and review it again.'; end if;
  select * into policy from public.loan_policy_settings where singleton;
  if not found or policy.base_interest_rate is null or policy.base_interest_rate<0
    or policy.processing_fee_percent is null or policy.processing_fee_percent<0
    or policy.service_fee_percent is null or policy.service_fee_percent<0 then
    raise exception 'Valid loan policy rates must be configured before releasing a loan.';
  end if;
  processing_fee:=round(loan.amount*policy.processing_fee_percent/100,2);
  service_fee:=round(loan.amount*policy.service_fee_percent/100,2);
  net_proceeds:=loan.amount-processing_fee-service_fee;
  if net_proceeds<0 then raise exception 'The release fees exceed the approved principal.'; end if;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,id::text) into actor_name from auth.users where id=auth.uid();
  update public.loan_applications set status='released',date_released=p_date,updated_at=clock_timestamp(),
    release_reference=btrim(p_reference),release_notes=coalesce(p_notes,''),released_by=auth.uid(),
    released_by_name=actor_name,release_request_id=p_request_id,
    interest_rate_at_release=policy.base_interest_rate,
    processing_fee_rate_at_release=policy.processing_fee_percent,
    service_fee_rate_at_release=policy.service_fee_percent,
    processing_fee_amount_at_release=processing_fee,
    service_fee_amount_at_release=service_fee where id=loan.id returning * into loan;
  insert into public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    values(auth.uid(),'release-loan',loan.application_id,'success',jsonb_build_object(
      'loan_id',loan.id,'amount',loan.amount,'release_date',p_date,'disbursement_reference',btrim(p_reference),
      'previous_status','approved','status','released','notes',coalesce(p_notes,''),
      'interest_rate_at_release',loan.interest_rate_at_release,
      'processing_fee_amount_at_release',processing_fee,'service_fee_amount_at_release',service_fee,
      'net_proceeds',net_proceeds));
  return jsonb_build_object('id',loan.id,'application_id',loan.application_id,'status','released',
    'date_released',loan.date_released,'release_reference',loan.release_reference,'amount',loan.amount,
    'interest_rate_at_release',loan.interest_rate_at_release,
    'processing_fee_amount_at_release',processing_fee,'service_fee_amount_at_release',service_fee,
    'net_proceeds',net_proceeds);
end $$;
revoke all on function public.release_approved_loan(text,uuid,date,text,numeric,text) from public,anon;
grant execute on function public.release_approved_loan(text,uuid,date,text,numeric,text) to authenticated;

notify pgrst,'reload schema';
commit;
