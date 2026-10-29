-- Repairs installed counter payment handlers to use the existing cash method.
-- No payment records or database check constraints are changed.
begin;
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
notify pgrst,'reload schema';
commit;
