-- Supabase Cron installation: https://supabase.com/docs/guides/cron/install
-- Run after both announcement and notification-delivery migrations.
-- Only the two named cooperative jobs are created or updated.
begin;
create extension if not exists pg_cron;
select cron.schedule('coop-publish-announcements', '* * * * *',
  'select public.publish_due_announcements()');
select cron.schedule('coop-deliver-notifications', '* * * * *',
  'select public.deliver_scheduled_notifications()');
commit;
select jobname, schedule, active from cron.job
where jobname in ('coop-publish-announcements','coop-deliver-notifications');
