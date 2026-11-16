-- Snapshot the published LPPI term factor and deduct its one-time premium
-- from release proceeds. Existing releases remain unchanged at zero.
BEGIN;

ALTER TABLE public.loan_applications
  ADD COLUMN IF NOT EXISTS loan_lppi_factor_percent_at_release numeric(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loan_insurance_premium_at_release numeric(14,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.loan_applications'::regclass
      AND conname='loan_lppi_factor_percent_at_release_check'
  ) THEN
    ALTER TABLE public.loan_applications
      ADD CONSTRAINT loan_lppi_factor_percent_at_release_check
      CHECK (loan_lppi_factor_percent_at_release BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.loan_applications'::regclass
      AND conname='loan_insurance_premium_at_release_check'
  ) THEN
    ALTER TABLE public.loan_applications
      ADD CONSTRAINT loan_insurance_premium_at_release_check
      CHECK (loan_insurance_premium_at_release >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.loan_lppi_factor_percent(p_months integer)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog
AS $$
BEGIN
  RETURN CASE p_months
    WHEN 1 THEN 0.1629 WHEN 2 THEN 0.1629
    WHEN 3 THEN 0.2444 WHEN 4 THEN 0.3259
    WHEN 5 THEN 0.4073 WHEN 6 THEN 0.4888
    WHEN 7 THEN 0.5703 WHEN 8 THEN 0.6518
    WHEN 9 THEN 0.7332 WHEN 10 THEN 0.8147
    WHEN 11 THEN 0.8962 WHEN 12 THEN 0.9750
    WHEN 13 THEN 1.0519 WHEN 14 THEN 1.1406
    WHEN 15 THEN 1.2221 WHEN 16 THEN 1.3036
    WHEN 17 THEN 1.3850 WHEN 18 THEN 1.4665
    WHEN 19 THEN 1.5430 WHEN 20 THEN 1.6295
    WHEN 21 THEN 1.7110 WHEN 22 THEN 1.7924
    WHEN 23 THEN 1.8739 WHEN 24 THEN 1.9500
    ELSE NULL
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.loan_lppi_factor_percent(integer)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.release_approved_loan(
  p_application_id text,p_request_id uuid,p_date date,p_reference text,
  p_expected_amount numeric,p_notes text default ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth,pg_temp
AS $$
DECLARE
  loan public.loan_applications;
  actor_name text;
  policy public.loan_policy_settings;
  processing_fee numeric;
  service_fee numeric;
  lppi_factor numeric;
  lppi_premium numeric;
  net_proceeds numeric;
BEGIN
  IF NOT public.document_staff_access('loans.release') THEN
    RAISE EXCEPTION 'Loan release permission is required.' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_reference IS NULL
    OR length(btrim(p_reference)) NOT BETWEEN 1 AND 80
    OR coalesce(length(p_notes),0)>2000 THEN
    RAISE EXCEPTION 'Enter a disbursement reference of 1 to 80 characters and notes of up to 2000 characters.';
  END IF;
  IF p_date IS NULL OR p_date>(now() AT TIME ZONE 'Asia/Manila')::date THEN
    RAISE EXCEPTION 'Release date cannot be in the future.';
  END IF;

  SELECT * INTO loan FROM public.loan_applications
  WHERE application_id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loan not found.' USING ERRCODE='P0002'; END IF;

  IF loan.release_request_id=p_request_id THEN
    IF loan.released_by<>auth.uid() OR loan.date_released<>p_date
      OR loan.release_reference<>btrim(p_reference)
      OR coalesce(loan.release_notes,'')<>coalesce(p_notes,'')
      OR p_expected_amount IS NULL OR loan.amount<>p_expected_amount THEN
      RAISE EXCEPTION 'This request was already used for different release details.' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'id',loan.id,'application_id',loan.application_id,'status',loan.status,
      'date_released',loan.date_released,'release_reference',loan.release_reference,
      'amount',loan.amount,'interest_rate_at_release',loan.interest_rate_at_release,
      'processing_fee_amount_at_release',loan.processing_fee_amount_at_release,
      'service_fee_amount_at_release',loan.service_fee_amount_at_release,
      'loan_lppi_factor_percent_at_release',loan.loan_lppi_factor_percent_at_release,
      'loan_insurance_premium_at_release',loan.loan_insurance_premium_at_release,
      'net_proceeds',loan.amount-coalesce(loan.processing_fee_amount_at_release,0)
        -coalesce(loan.service_fee_amount_at_release,0)
        -coalesce(loan.loan_insurance_premium_at_release,0));
  END IF;

  IF loan.status<>'approved' OR loan.date_released IS NOT NULL OR loan.date_completed IS NOT NULL THEN
    RAISE EXCEPTION 'Only approved loans that have not been released or completed can be marked as released.';
  END IF;
  IF loan.date_approved IS NULL THEN
    RAISE EXCEPTION 'The approval date must be recorded before releasing this loan.';
  END IF;
  IF p_date<loan.date_approved OR p_date<loan.date_submitted THEN
    RAISE EXCEPTION 'Release date cannot be earlier than approval or submission.';
  END IF;
  IF p_expected_amount IS NULL OR p_expected_amount<>loan.amount OR loan.amount<=0 THEN
    RAISE EXCEPTION 'The loan amount changed or is invalid. Refresh the application and review it again.';
  END IF;

  lppi_factor:=public.loan_lppi_factor_percent(loan.tenure_months);
  IF lppi_factor IS NULL THEN
    RAISE EXCEPTION 'The loan term has no configured LPPI factor. Review the loan term before release.';
  END IF;
  SELECT * INTO policy FROM public.loan_policy_settings WHERE singleton;
  IF NOT FOUND OR policy.base_interest_rate IS NULL OR policy.base_interest_rate<0
    OR policy.processing_fee_percent IS NULL OR policy.processing_fee_percent<0
    OR policy.service_fee_percent IS NULL OR policy.service_fee_percent<0 THEN
    RAISE EXCEPTION 'Valid loan policy rates must be configured before releasing a loan.';
  END IF;

  processing_fee:=round(loan.amount*policy.processing_fee_percent/100,2);
  service_fee:=round(loan.amount*policy.service_fee_percent/100,2);
  lppi_premium:=round(loan.amount*lppi_factor/100,2);
  net_proceeds:=loan.amount-processing_fee-service_fee-lppi_premium;
  IF net_proceeds<0 THEN RAISE EXCEPTION 'The release fees exceed the approved principal.'; END IF;

  SELECT coalesce(nullif(raw_user_meta_data->>'full_name',''),email,id::text)
  INTO actor_name FROM auth.users WHERE id=auth.uid();
  UPDATE public.loan_applications SET
    status='released',date_released=p_date,updated_at=clock_timestamp(),
    release_reference=btrim(p_reference),release_notes=coalesce(p_notes,''),
    released_by=auth.uid(),released_by_name=actor_name,release_request_id=p_request_id,
    interest_rate_at_release=policy.base_interest_rate,
    processing_fee_rate_at_release=policy.processing_fee_percent,
    service_fee_rate_at_release=policy.service_fee_percent,
    processing_fee_amount_at_release=processing_fee,
    service_fee_amount_at_release=service_fee,
    loan_lppi_factor_percent_at_release=lppi_factor,
    loan_insurance_premium_at_release=lppi_premium
  WHERE id=loan.id RETURNING * INTO loan;

  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
  VALUES(auth.uid(),'release-loan',loan.application_id,'success',jsonb_build_object(
    'loan_id',loan.id,'amount',loan.amount,'release_date',p_date,
    'disbursement_reference',btrim(p_reference),'previous_status','approved',
    'status','released','notes',coalesce(p_notes,''),
    'interest_rate_at_release',loan.interest_rate_at_release,
    'processing_fee_amount_at_release',processing_fee,
    'service_fee_amount_at_release',service_fee,
    'loan_lppi_factor_percent_at_release',lppi_factor,
    'loan_insurance_premium_at_release',lppi_premium,'net_proceeds',net_proceeds));

  RETURN jsonb_build_object(
    'id',loan.id,'application_id',loan.application_id,'status','released',
    'date_released',loan.date_released,'release_reference',loan.release_reference,
    'amount',loan.amount,'interest_rate_at_release',loan.interest_rate_at_release,
    'processing_fee_amount_at_release',processing_fee,
    'service_fee_amount_at_release',service_fee,
    'loan_lppi_factor_percent_at_release',lppi_factor,
    'loan_insurance_premium_at_release',lppi_premium,'net_proceeds',net_proceeds);
END;
$$;
REVOKE ALL ON FUNCTION public.release_approved_loan(text,uuid,date,text,numeric,text)
  FROM PUBLIC,anon,authenticated;

-- The in-app release notice and its linked email must show the amount after LPPI.
CREATE OR REPLACE FUNCTION public.portal_set_release_notice_net_proceeds()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=''
AS $$
DECLARE loan public.loan_applications%ROWTYPE;
BEGIN
  IF coalesce(NEW.data->>'event',NEW.data->>'action') IS DISTINCT FROM 'loan_released'
    OR NEW.data->>'entityKey' IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO loan FROM public.loan_applications
  WHERE application_id=NEW.data->>'entityKey';
  IF NOT FOUND THEN RETURN NEW; END IF;
  NEW.message:=format(
    'Your loan under application %s was released on %s. Net proceeds: ₱%s. View your release details and repayment schedule in the app.',
    loan.application_id,loan.date_released,
    to_char(loan.amount-coalesce(loan.processing_fee_amount_at_release,0)
      -coalesce(loan.service_fee_amount_at_release,0)
      -coalesce(loan.loan_insurance_premium_at_release,0),'FM999999999990.00'));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_set_release_notice_net_proceeds()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS portal_set_release_notice_net_proceeds ON public.notifications;
CREATE TRIGGER portal_set_release_notice_net_proceeds
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.portal_set_release_notice_net_proceeds();

-- Include the LPPI deduction in the trusted database dashboard total.
CREATE OR REPLACE FUNCTION public.portal_dashboard_totals(p_start date,p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE collections numeric; disbursement numeric; missing boolean; pending integer;
BEGIN
  IF NOT public.document_staff_access() THEN
    RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>366 THEN
    RAISE EXCEPTION 'Choose a valid reporting period.';
  END IF;
  SELECT count(*)::integer INTO pending FROM public.loan_applications a
  LEFT JOIN public.application_verifications w ON w.application_id=a.id
  WHERE a.status='pending' AND w.application_id IS NULL;
  SELECT coalesce(sum(payment_amount),0) INTO collections FROM public.loan_payments
  WHERE payment_status='posted' AND payment_date>=p_start AND payment_date<p_end;
  SELECT coalesce(sum(amount-processing_fee_amount_at_release-service_fee_amount_at_release
      -loan_insurance_premium_at_release),0),
    coalesce(bool_or(processing_fee_amount_at_release IS NULL
      OR service_fee_amount_at_release IS NULL
      OR loan_insurance_premium_at_release IS NULL),false)
  INTO disbursement,missing FROM public.loan_applications
  WHERE date_released>=p_start AND date_released<p_end
    AND status IN ('released','overdue','completed');
  missing:=missing OR EXISTS(SELECT 1 FROM public.loan_applications
    WHERE status IN ('released','overdue','completed') AND date_released IS NULL);
  RETURN jsonb_build_object('pending',pending,'collections',collections,
    'disbursement',CASE WHEN missing THEN NULL ELSE disbursement END);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_dashboard_totals(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_dashboard_totals(date,date) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
