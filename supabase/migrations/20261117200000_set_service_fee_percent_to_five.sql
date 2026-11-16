-- Set the editable one-time loan service/retention fee to 5% for future
-- releases. Loans already released keep their saved fee rate and amount.
BEGIN;

ALTER TABLE public.loan_policy_settings
  ALTER COLUMN service_fee_percent SET DEFAULT 5;

UPDATE public.loan_policy_settings
SET service_fee_percent = 5,
    updated_at = now()
WHERE singleton = true;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.loan_policy_settings
    WHERE singleton = true
      AND service_fee_percent = 5
  ) THEN
    RAISE EXCEPTION 'Could not set the loan service fee to 5 percent.';
  END IF;
END;
$verify$;

COMMIT;
