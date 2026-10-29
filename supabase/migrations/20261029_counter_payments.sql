-- Counter receipts are recorded by Super Admin. Apply once in Supabase SQL Editor.
-- Existing receipts remain intact and unallocated; they are never assumed to be principal.
begin;

alter table public.loan_payments
  add column if not exists receipt_number text,
  add column if not exists principal_amount numeric(14,2),
  add column if not exists interest_amount numeric(14,2),
  add column if not exists penalty_amount numeric(14,2),
  add column if not exists fee_amount numeric(14,2),
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_by_name text,
  add column if not exists request_id uuid,
  add column if not exists payment_status text not null default 'posted',
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id),
  add column if not exists reversal_reason text;

create unique index if not exists counter_payment_request_unique on public.loan_payments(request_id) where request_id is not null;
create unique index if not exists counter_payment_receipt_unique on public.loan_payments(lower(btrim(receipt_number))) where receipt_number is not null;
create index if not exists counter_payment_loan_index on public.loan_payments(loan_application_id);

alter table public.loan_payments drop constraint if exists counter_payment_allocation_check;
alter table public.loan_payments add constraint counter_payment_allocation_check check (
  (principal_amount is null and interest_amount is null and penalty_amount is null and fee_amount is null)
  or (principal_amount is not null and interest_amount is not null and penalty_amount is not null and fee_amount is not null
    and principal_amount >= 0 and interest_amount >= 0 and penalty_amount >= 0 and fee_amount >= 0
    and payment_amount > 0 and payment_amount = principal_amount + interest_amount + penalty_amount + fee_amount)
);
alter table public.loan_payments drop constraint if exists counter_payment_status_check;
alter table public.loan_payments add constraint counter_payment_status_check check (
  payment_status = 'posted' or (payment_status = 'reversed' and reversed_at is not null and reversed_by is not null and length(btrim(reversal_reason)) >= 5)
);
alter table public.loan_payments enable row level security;
grant select on public.loan_payments to authenticated,service_role;
revoke insert,update,delete on public.loan_payments from anon,authenticated;

-- Check current database metadata, rather than trusting a stale token's role.
create or replace function public.counter_payment_role() returns text
language sql stable security definer set search_path=public,auth,pg_temp as $$
  select raw_app_meta_data->>'role' from auth.users where id=auth.uid()
    and coalesce(raw_app_meta_data->>'account_status','active')='active'
    and (banned_until is null or banned_until < now())
$$;
revoke all on function public.counter_payment_role() from public,anon;
grant execute on function public.counter_payment_role() to authenticated;

drop policy if exists counter_payment_admin_read on public.loan_payments;
create policy counter_payment_admin_read on public.loan_payments for select to authenticated
  using(public.counter_payment_role() in ('super_admin','admin','coop_admin'));

create or replace function public.loan_payment_ledger(p_loan_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare loan public.loan_applications; paid numeric; principal_paid numeric; unallocated integer; entries jsonb;
begin
  if coalesce(public.counter_payment_role(),'') not in ('super_admin','admin','coop_admin') then raise exception 'Administrator access required.' using errcode='42501'; end if;
  select * into loan from public.loan_applications where id=p_loan_id;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  select coalesce(sum(payment_amount),0),coalesce(sum(principal_amount),0),count(*) filter(where principal_amount is null)
    into paid,principal_paid,unallocated from public.loan_payments where loan_application_id=p_loan_id and payment_status='posted';
  select coalesce(jsonb_agg(to_jsonb(p) order by payment_date desc,created_at desc,id),'[]'::jsonb)
    into entries from public.loan_payments p where loan_application_id=p_loan_id;
  return jsonb_build_object('loan_id',loan.id,'application_id',loan.application_id,'member_name',loan.member_name,
    'status',loan.status,'date_released',loan.date_released,'principal',loan.amount,'total_received',paid,
    'principal_paid',principal_paid,'unallocated_payments',unallocated,
    'principal_remaining',case when unallocated=0 then loan.amount-principal_paid else null end,'payments',entries);
end $$;
revoke all on function public.loan_payment_ledger(uuid) from public,anon;
grant execute on function public.loan_payment_ledger(uuid) to authenticated;

create or replace function public.record_counter_payment(
  p_loan_id uuid,p_request_id uuid,p_receipt text,p_date date,
  p_principal numeric,p_interest numeric,p_penalty numeric,p_fee numeric,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare loan public.loan_applications; existing public.loan_payments; saved public.loan_payments;
  paid numeric; unallocated integer; total numeric; actor_name text;
begin
  if coalesce(public.counter_payment_role(),'') <> 'super_admin' then raise exception 'Super Admin access required.' using errcode='42501'; end if;
  if p_request_id is null or p_receipt is null or length(btrim(p_receipt)) not between 1 and 80
    or coalesce(length(p_notes),0)>2000 then raise exception 'Enter a receipt number (up to 80 characters) and notes of up to 2000 characters.'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Payment date cannot be in the future.'; end if;
  if p_principal is null or p_interest is null or p_penalty is null or p_fee is null
    or not (p_principal between 0 and 999999999.99) or not (p_interest between 0 and 999999999.99)
    or not (p_penalty between 0 and 999999999.99) or not (p_fee between 0 and 999999999.99)
    or p_principal<>round(p_principal,2) or p_interest<>round(p_interest,2) or p_penalty<>round(p_penalty,2) or p_fee<>round(p_fee,2)
    then raise exception 'Enter nonnegative amounts with at most two decimal places.'; end if;
  total:=p_principal+p_interest+p_penalty+p_fee;
  if total<=0 then raise exception 'Payment total must be greater than zero.'; end if;
  -- Serialize record/reversal operations per loan to prevent concurrent overpayments.
  select * into loan from public.loan_applications where id=p_loan_id for update;
  if not found then raise exception 'Loan not found.' using errcode='P0002'; end if;
  select * into existing from public.loan_payments where request_id=p_request_id;
  if found then
    if existing.loan_application_id<>p_loan_id or existing.recorded_by<>auth.uid()
      or existing.receipt_number<>btrim(p_receipt) or existing.payment_date<>p_date
      or existing.principal_amount<>p_principal or existing.interest_amount<>p_interest
      or existing.penalty_amount<>p_penalty or existing.fee_amount<>p_fee or coalesce(existing.notes,'')<>coalesce(p_notes,'')
      then raise exception 'This request was already used for a different payment.' using errcode='23505'; end if;
    return to_jsonb(existing);
  end if;
  if loan.status not in ('released','overdue') or loan.date_released is null then raise exception 'Payments can only be recorded against released or overdue loans with a release date.'; end if;
  if p_date<loan.date_released then raise exception 'Payment date cannot be earlier than the loan release date.'; end if;
  select coalesce(sum(principal_amount),0),count(*) filter(where principal_amount is null) into paid,unallocated
    from public.loan_payments where loan_application_id=p_loan_id and payment_status='posted';
  if unallocated>0 then raise exception 'Existing payments need their principal allocation reconciled before recording more payments.'; end if;
  if p_principal>loan.amount-paid then raise exception 'Principal payment exceeds the remaining principal.'; end if;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,id::text) into actor_name from auth.users where id=auth.uid();
  insert into public.loan_payments(loan_application_id,payment_amount,payment_date,payment_method,notes,
    receipt_number,principal_amount,interest_amount,penalty_amount,fee_amount,recorded_by,recorded_by_name,request_id)
    values(p_loan_id,total,p_date,'cash',coalesce(p_notes,''),btrim(p_receipt),p_principal,p_interest,p_penalty,p_fee,auth.uid(),actor_name,p_request_id)
    returning * into saved;
  insert into public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    values(auth.uid(),'record-counter-payment',loan.application_id,'success',jsonb_build_object('payment_id',saved.id,'receipt_number',saved.receipt_number,'amount',total,'payment_date',p_date,'principal',p_principal,'interest',p_interest,'penalty',p_penalty,'fees',p_fee));
  return to_jsonb(saved);
end $$;
revoke all on function public.record_counter_payment(uuid,uuid,text,date,numeric,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.record_counter_payment(uuid,uuid,text,date,numeric,numeric,numeric,numeric,text) to authenticated;

create or replace function public.reverse_counter_payment(p_payment_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare payment public.loan_payments; loan_id uuid; application text;
begin
  if coalesce(public.counter_payment_role(),'') <> 'super_admin' then raise exception 'Super Admin access required.' using errcode='42501'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 1000 then raise exception 'Enter a reversal reason of 5 to 1000 characters.'; end if;
  select loan_application_id into loan_id from public.loan_payments where id=p_payment_id;
  if not found then raise exception 'Payment not found.' using errcode='P0002'; end if;
  select application_id into application from public.loan_applications where id=loan_id for update;
  select * into payment from public.loan_payments where id=p_payment_id for update;
  if payment.payment_status='reversed' then return to_jsonb(payment); end if;
  if payment.recorded_by is null then raise exception 'Legacy payments require reconciliation before reversal.'; end if;
  update public.loan_payments set payment_status='reversed',reversed_at=clock_timestamp(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason)
    where id=p_payment_id returning * into payment;
  insert into public.admin_activity_logs(actor_id,action_name,target_id,result,details)
    values(auth.uid(),'reverse-counter-payment',application,'success',jsonb_build_object('payment_id',payment.id,'receipt_number',payment.receipt_number,'amount',payment.payment_amount,'reason',btrim(p_reason)));
  return to_jsonb(payment);
end $$;
revoke all on function public.reverse_counter_payment(uuid,text) from public,anon;
grant execute on function public.reverse_counter_payment(uuid,text) to authenticated;
commit;
