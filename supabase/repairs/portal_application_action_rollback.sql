-- Roll back the focused portal_application_action repair only if no request has
-- been committed through it. Otherwise revoke execution and preserve the ledger.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.portal_action_requests') IS NULL THEN
  RAISE EXCEPTION 'public.portal_action_requests is absent; nothing to roll back.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.portal_action_requests) THEN
  RAISE EXCEPTION 'The action ledger contains committed requests. Preserve it; revoke service_role execution and investigate before rollback.';
 END IF;
 IF to_regprocedure('public.portal_application_action(uuid,text,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'public.portal_application_action is absent; inspect the installed objects before rollback.';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_application_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.portal_application_action(uuid,text,jsonb);
DROP TABLE public.portal_action_requests;
COMMIT;
