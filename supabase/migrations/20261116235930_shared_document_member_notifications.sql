BEGIN;

-- Publish notifications only after the document and recipient assignments are
-- committed together. The email queue is already attached to notifications.
CREATE OR REPLACE FUNCTION public.notify_published_shared_document_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE published_document public.shared_documents%ROWTYPE;
BEGIN
  SELECT * INTO published_document
  FROM public.shared_documents
  WHERE id = NEW.id
    AND status = 'published'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.notifications(user_id, title, message, type, read, data)
  SELECT DISTINCT
    member.user_id,
    'New shared document available',
    left('A cooperative document, "' || published_document.title ||
      '", is available in the Documents section of the CSUCC app.', 2000),
    'info',
    false,
    jsonb_build_object(
      'activityEventId', published_document.id::text,
      'category', 'documents',
      'action', 'shared_document_published',
      'entityType', 'shared_document',
      'entityKey', published_document.id::text,
      'documentTitle', published_document.title
    )
  FROM public.members AS member
  JOIN auth.users AS account ON account.id = member.user_id
  WHERE member.user_id IS NOT NULL
    AND member.status = 'active'
    AND lower(member.role::text) = 'member'
    AND account.raw_app_meta_data->>'role' = 'member'
    AND coalesce(account.raw_app_meta_data->>'account_status', 'active') = 'active'
    AND (account.banned_until IS NULL OR account.banned_until <= now())
    AND (
      published_document.audience = 'all'
      OR EXISTS (
        SELECT 1
        FROM public.shared_document_recipients AS recipient
        WHERE recipient.document_id = published_document.id
          AND recipient.member_id = member.id
      )
    )
  ON CONFLICT ((data->>'activityEventId'), user_id)
    WHERE data->>'activityEventId' IS NOT NULL
    DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_published_shared_document_members()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS shared_document_member_notifications
  ON public.shared_documents;
CREATE CONSTRAINT TRIGGER shared_document_member_notifications
  AFTER INSERT OR UPDATE ON public.shared_documents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_published_shared_document_members();

NOTIFY pgrst, 'reload schema';
COMMIT;
