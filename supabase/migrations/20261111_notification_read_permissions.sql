BEGIN;
-- Older Supabase defaults can leave a table-wide UPDATE grant despite UPDATE(read).
REVOKE ALL ON TABLE public.notifications FROM PUBLIC,anon,authenticated;
DO $$DECLARE columns text;BEGIN
 SELECT string_agg(quote_ident(column_name),',') INTO columns FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications';
 EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.notifications FROM PUBLIC,anon,authenticated',columns);
END$$;
GRANT SELECT,UPDATE(read) ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
COMMIT;
