-- The return workflow sets loan_applications.status to 'returned'.
-- Preserve the existing lifecycle values and admit that workflow state.
BEGIN;

ALTER TABLE public.loan_applications
  DROP CONSTRAINT IF EXISTS loan_applications_status_check;

ALTER TABLE public.loan_applications
  ADD CONSTRAINT loan_applications_status_check
  CHECK(status IN ('pending','under review','returned','approved','rejected','released','completed','overdue'));

NOTIFY pgrst,'reload schema';
COMMIT;
