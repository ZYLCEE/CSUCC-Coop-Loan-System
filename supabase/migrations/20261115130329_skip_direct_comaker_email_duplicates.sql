-- Co-maker invitation and response emails are sent directly by the existing
-- co-maker-invitation Edge Function, which returns the SMTP result to the app.
-- Keep their in-app notifications while excluding them from the general queue
-- to avoid sending a duplicate email.
BEGIN;

DROP TRIGGER IF EXISTS portal_queue_notification_email ON public.notifications;
CREATE TRIGGER portal_queue_notification_email
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL AND coalesce(NEW.type,'') NOT IN ('co_maker_invitation','co_maker_response'))
  EXECUTE FUNCTION public.portal_queue_notification_email();

COMMIT;
