-- Return-specific delivery only. Existing queued messages are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.portal_enable_return_application_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.subject LIKE 'Loan application returned — %'
     AND EXISTS (
       SELECT 1
       FROM public.loan_applications AS a
       JOIN public.members AS m ON m.id = a.member_id
       JOIN auth.users AS u ON u.id = NEW.member_auth_id
       WHERE a.id = NEW.application_id
         AND m.user_id = NEW.member_auth_id
         AND m.status = 'active'
         AND lower(u.email) = lower(NEW.recipient_email)
         AND u.email_confirmed_at IS NOT NULL
         AND coalesce(u.raw_app_meta_data->>'account_status', 'active') = 'active'
         AND (u.banned_until IS NULL OR u.banned_until <= now())
         AND coalesce(u.raw_app_meta_data->>'role', 'member')
             NOT IN ('super_admin', 'admin', 'coop_admin', 'crecom_member', 'bod_member')
     ) THEN
    NEW.email_eligible := true;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_enable_return_application_email()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS portal_enable_return_application_email
  ON public.application_email_outbox;
CREATE TRIGGER portal_enable_return_application_email
  BEFORE INSERT ON public.application_email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.portal_enable_return_application_email();

CREATE OR REPLACE FUNCTION public.portal_suppress_duplicate_return_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.subject = 'Loan application returned'
     AND EXISTS (
       SELECT 1
       FROM public.notifications AS n
       JOIN public.loan_applications AS a
         ON left(n.message, length(a.application_id) + 2) = a.application_id || ': '
       JOIN public.members AS m ON m.id = a.member_id
       WHERE n.id = NEW.notification_id
         AND n.title = 'Loan application returned'
         AND m.user_id = NEW.recipient_user_id
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_suppress_duplicate_return_notification_email()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS portal_suppress_duplicate_return_notification_email
  ON public.notification_email_outbox;
CREATE TRIGGER portal_suppress_duplicate_return_notification_email
  BEFORE INSERT ON public.notification_email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.portal_suppress_duplicate_return_notification_email();

COMMIT;
