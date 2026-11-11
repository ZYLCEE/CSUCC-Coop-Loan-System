BEGIN READ ONLY;
SELECT
 EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') AS notification_realtime_enabled,
 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='activity_category') AS category_available,
 EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications' AND policyname='activity_recipient_boundary' AND permissive='RESTRICTIVE') AS recipient_boundary_installed,
 NOT has_function_privilege('authenticated','public.portal_emit_activity(text,text,text,text,text,text,text,uuid,uuid,text,boolean)','EXECUTE') AS browser_cannot_publish_activity,
 (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'portal_%_activity') AS activity_trigger_count,
 (SELECT count(*) FROM public.portal_activity_events) AS recorded_events;
DO $$DECLARE actor uuid;BEGIN
 SELECT id INTO STRICT actor FROM auth.users WHERE raw_app_meta_data->>'role'='super_admin' AND coalesce(raw_app_meta_data->>'account_status','active')='active' LIMIT 1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','app_metadata',jsonb_build_object('role','super_admin','account_status','active'))::text,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END$$;
SET LOCAL ROLE authenticated;
SELECT
 (SELECT count(*) FROM public.notifications WHERE user_id=auth.uid()) AS own_inbox_rows,
 (SELECT count(*) FROM public.notifications WHERE user_id<>auth.uid()) AS other_recipient_rows,
 (SELECT count(*) FROM public.portal_activity_events) AS visible_activity_history_rows,
 (SELECT count(*) FROM public.loan_applications WHERE status IN ('pending','under review','approved','rejected')) AS existing_application_rows;
ROLLBACK;
