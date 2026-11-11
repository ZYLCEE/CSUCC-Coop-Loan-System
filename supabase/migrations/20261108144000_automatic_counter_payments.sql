-- Apply after loan policy settings and both counter payment migrations.
begin;

create table if not exists public.counter_payment_penalty_rates (
  effective_date date primary key,
  rate numeric(7,4) not null check (rate between 0 and 100)
);
alter table public.counter_payment_penalty_rates enable row level security;
revoke all on public.counter_payment_penalty_rates from public,anon,authenticated;

-- The current policy is known from its last save. Earlier rates are unknown.
insert into public.counter_payment_penalty_rates(effective_date,rate)
select (updated_at at time zone 'Asia/Manila')::date + 1,penalty_rate_percent
from public.loan_policy_settings where singleton
  and not exists(select 1 from public.counter_payment_penalty_rates)
on conflict do nothing;

create or replace function public.capture_counter_payment_penalty_rate() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.counter_payment_penalty_rates(effective_date,rate)
  values ((clock_timestamp() at time zone 'Asia/Manila')::date + 1,new.penalty_rate_percent)
  on conflict (effective_date) do update set rate=excluded.rate;
  return new;
end $$;
revoke all on function public.capture_counter_payment_penalty_rate() from public,anon,authenticated;

drop trigger if exists capture_counter_payment_penalty_rate on public.loan_policy_settings;
create trigger capture_counter_payment_penalty_rate after update of penalty_rate_percent on public.loan_policy_settings
for each row when (old.penalty_rate_percent is distinct from new.penalty_rate_percent)
execute function public.capture_counter_payment_penalty_rate();

-- Installments fall on the release day each month, capped at month end.
-- The next day, assess the monthly rate on overdue principal. Previous
-- assessments are excluded from the base, and same-due-date receipts count.
create or replace function public.counter_payment_penalty(loan public.loan_applications,p_date date)
returns numeric language sql stable set search_path=pg_catalog,public as $$
  with due_dates as (
    select installment,
      (loan.date_released + make_interval(months => installment))::date as due_date
    from generate_series(1,
      (extract(year from p_date)::integer-extract(year from loan.date_released)::integer)*12
      + extract(month from p_date)::integer-extract(month from loan.date_released)::integer
    ) installment
  ), assessments as (
    select greatest(round(loan.amount*least(d.installment,loan.tenure_months)/loan.tenure_months,2)
      - coalesce((select sum(p.principal_amount) from public.loan_payments p
        where p.loan_application_id=loan.id and p.payment_status='posted' and p.payment_date<=d.due_date),0),0) as overdue,
      (select rate from public.counter_payment_penalty_rates where effective_date<=d.due_date+1
        order by effective_date desc limit 1) as rate
    from due_dates d where d.due_date<p_date
  )
  select case when bool_or(overdue>0 and rate is null) then null
    else coalesce(sum(round(overdue*rate/100,2)),0) end
  from assessments;
$$;
revoke all on function public.counter_payment_penalty(public.loan_applications,date) from public,anon,authenticated;

create or replace function public.calculate_counter_payment(
  loan public.loan_applications,p_date date,p_amount numeric
) returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare principal_paid numeric; penalty_paid numeric; penalty_due numeric;
  latest_receipt date; unallocated integer; applied_penalty numeric; applied_principal numeric;
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
    max(payment_date),count(*) filter(where principal_amount is null)
    into principal_paid,penalty_paid,latest_receipt,unallocated
    from public.loan_payments where loan_application_id=loan.id and payment_status='posted';
  if unallocated>0 then
    raise exception 'Existing payments need their principal allocation reconciled before recording more payments.';
  end if;
  if latest_receipt>p_date then
    raise exception 'This receipt predates a posted payment. Reconcile the ledger before recording it.';
  end if;
  penalty_due := public.counter_payment_penalty(loan,p_date);
  if penalty_due is null or penalty_due<penalty_paid then
    raise exception 'Historical late charges need reconciliation before this payment can be calculated.';
  end if;

  -- Interest, processing fees and service fees are deducted at release.
  applied_penalty := least(p_amount,penalty_due-penalty_paid);
  applied_principal := p_amount-applied_penalty;
  if applied_principal>loan.amount-principal_paid then
    raise exception 'The amount exceeds the remaining principal and late charges.';
  end if;
  return jsonb_build_object('principal',applied_principal,'interest',0,'penalty',applied_penalty,'fee',0);
end $$;
revoke all on function public.calculate_counter_payment(public.loan_applications,date,numeric) from public,anon,authenticated;

create or replace function public.loan_payment_ledger(p_loan_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare loan public.loan_applications; paid numeric; principal_paid numeric; penalty_paid numeric;
  unallocated integer; entries jsonb; automatic_allocation boolean := false;
begin
  if coalesce(public.counter_payment_role(),'') not in ('super_admin','admin','coop_admin') then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  select * into loan from public.loan_applications where id=p_loan_id;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  select coalesce(sum(payment_amount),0),coalesce(sum(principal_amount),0),coalesce(sum(penalty_amount),0),
    count(*) filter(where principal_amount is null) into paid,principal_paid,penalty_paid,unallocated
    from public.loan_payments where loan_application_id=p_loan_id and payment_status='posted';
  if loan.status in ('released','overdue') and loan.date_released is not null and loan.amount>0
    and loan.tenure_months between 1 and 600 and unallocated=0 then
    automatic_allocation := coalesce(public.counter_payment_penalty(loan,(now() at time zone 'Asia/Manila')::date)>=penalty_paid,false);
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by payment_date desc,created_at desc,id),'[]'::jsonb)
    into entries from public.loan_payments p where loan_application_id=p_loan_id;
  return jsonb_build_object('loan_id',loan.id,'application_id',loan.application_id,'member_name',loan.member_name,
    'status',loan.status,'date_released',loan.date_released,'principal',loan.amount,'total_received',paid,
    'principal_paid',principal_paid,'unallocated_payments',unallocated,'automatic_allocation',automatic_allocation,
    'principal_remaining',case when unallocated=0 then loan.amount-principal_paid else null end,'payments',entries);
end $$;

create or replace function public.preview_counter_payment(
  p_loan_id uuid, p_receipt text, p_date date, p_amount numeric
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare loan public.loan_applications;
begin
  if coalesce(public.counter_payment_role(),'') <> 'super_admin' then
    raise exception 'Super Admin access required.' using errcode='42501';
  end if;
  if p_receipt is null or length(btrim(p_receipt)) not between 1 and 80 then
    raise exception 'Enter an official receipt number of up to 80 characters.';
  end if;
  if exists(select 1 from public.loan_payments where lower(btrim(receipt_number))=lower(btrim(p_receipt))) then
    raise exception 'This receipt number has already been recorded.' using errcode='23505';
  end if;
  select * into loan from public.loan_applications where id=p_loan_id;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  return public.calculate_counter_payment(loan,p_date,p_amount);
end $$;

create or replace function public.record_allocated_counter_payment(
  p_loan_id uuid, p_request_id uuid, p_receipt text, p_date date, p_amount numeric,
  p_reviewed_allocation jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare loan public.loan_applications; existing public.loan_payments; allocation jsonb;
begin
  if coalesce(public.counter_payment_role(),'') <> 'super_admin' then
    raise exception 'Super Admin access required.' using errcode='42501';
  end if;
  if p_request_id is null or p_receipt is null or length(btrim(p_receipt)) not between 1 and 80 then
    raise exception 'Enter an official receipt number of up to 80 characters.';
  end if;

  -- Use the same lock as manual receipts and reversals so the confirmed quote
  -- is checked against the same ledger state that the receipt will be saved to.
  select * into loan from public.loan_applications where id=p_loan_id for update;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  select * into existing from public.loan_payments where request_id=p_request_id;
  if found then
    if existing.loan_application_id is distinct from p_loan_id
      or existing.recorded_by is distinct from auth.uid()
      or existing.receipt_number is distinct from btrim(p_receipt)
      or existing.payment_date is distinct from p_date
      or existing.payment_amount is distinct from p_amount
      or jsonb_build_object('principal',existing.principal_amount,'interest',existing.interest_amount,
        'penalty',existing.penalty_amount,'fee',existing.fee_amount) is distinct from p_reviewed_allocation then
      raise exception 'This request was already used for a different payment.' using errcode='23505';
    end if;
    return to_jsonb(existing);
  end if;

  allocation := public.calculate_counter_payment(loan,p_date,p_amount);
  if allocation is distinct from p_reviewed_allocation then
    raise exception 'The payment breakdown changed. Review the payment again before recording it.' using errcode='40001';
  end if;
  return public.record_counter_payment(p_loan_id,p_request_id,p_receipt,p_date,
    (allocation->>'principal')::numeric,(allocation->>'interest')::numeric,
    (allocation->>'penalty')::numeric,(allocation->>'fee')::numeric,'');
end $$;

revoke all on function public.preview_counter_payment(uuid,text,date,numeric) from public,anon;
grant execute on function public.preview_counter_payment(uuid,text,date,numeric) to authenticated;
revoke all on function public.record_allocated_counter_payment(uuid,uuid,text,date,numeric,jsonb) from public,anon;
grant execute on function public.record_allocated_counter_payment(uuid,uuid,text,date,numeric,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
