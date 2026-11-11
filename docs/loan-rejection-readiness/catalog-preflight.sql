-- PREPARATION ONLY. NOT EXECUTED AGAINST PRODUCTION.
-- Requires separate authorization for remote SQL inspection; the current audit forbids it.
-- Keep function/policy definitions private and redact any embedded secrets before sharing.
-- No rejection, grant, password, financial or notification RPC is invoked here.
begin transaction read only;

select current_database(), current_setting('server_version') as server_version;
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;
-- Only if that ledger exists, an authorized operator may separately inspect:
-- select version, name from supabase_migrations.schema_migrations order by version;
-- Do not export the statements column or mark migrations applied.

select table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default
from information_schema.columns
where (table_schema='public' and table_name in (
  'loan_applications','members','admin_activity_logs','admin_action_grants',
  'admin_security_attempts','notifications','loan_policy_settings','loan_documents'))
  or (table_schema='auth' and table_name='users' and column_name in (
    'id','email','raw_app_meta_data','banned_until'))
order by table_schema,table_name,ordinal_position;

select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,p.provolatile,p.proconfig,p.proacl,
  has_function_privilege('anon',p.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'execute') as service_execute,
  pg_get_functiondef(p.oid) as definition_for_private_review
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'loan_rejection_capability','reject_loan_application','loan_rejection_details',
  'is_active_secure_admin','issue_admin_action_grant','consume_admin_action_grant',
  'is_admin_security_rate_limited','record_admin_security_failure','clear_admin_security_failures',
  'release_loan','release_approved_loan','process_loan_approval','deliver_notification_outbox')
order by p.proname,identity_arguments;

select n.nspname,c.relname,pg_get_userbyid(c.relowner) as owner,
  c.relrowsecurity,c.relforcerowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'loan_applications','members','admin_activity_logs','admin_action_grants',
  'admin_security_attempts','notifications');

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in (
  'loan_applications','members','admin_activity_logs','admin_action_grants',
  'admin_security_attempts','notifications') order by tablename,policyname;

select c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid) as definition
from pg_constraint k join pg_class c on c.oid=k.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'loan_applications','members','admin_activity_logs','admin_action_grants','notifications')
order by c.relname,k.conname;

select c.relname as table_name,i.relname as index_name,x.indisunique,x.indisvalid,
  x.indisready,pg_get_indexdef(i.oid) as definition
from pg_index x join pg_class c on c.oid=x.indrelid
join pg_class i on i.oid=x.indexrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and (c.relname in ('loan_applications','members','admin_activity_logs')
  or i.relname='loan_rejection_request_unique') order by c.relname,i.relname;

select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition,
  pg_get_functiondef(t.tgfoid) as trigger_function_for_private_review
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal and c.relname in (
  'loan_applications','admin_activity_logs','notifications');

select evtname,evtevent,evtenabled,pg_get_functiondef(evtfoid) as definition_for_private_review
from pg_event_trigger;

select pg_get_userbyid(defaclrole) as owner,coalesce(n.nspname,'ALL') as schema_name,
  defaclobjtype,defaclacl from pg_default_acl d
  left join pg_namespace n on n.oid=d.defaclnamespace;
select has_schema_privilege('authenticated','public','create') as authenticated_can_create,
  has_schema_privilege('anon','public','create') as anon_can_create;

-- Aggregate integrity checks only; do not print reasons, actors, tokens or request IDs.
select count(*) as duplicate_rejection_request_groups from (
  select details->>'request_id' from public.admin_activity_logs
  where action_name='reject-loan' and result='success' and details ? 'request_id'
  group by details->>'request_id' having count(*)>1 and details->>'request_id' is not null
) duplicates;
select count(*) as duplicate_member_auth_link_groups from (
  select user_id from public.members where user_id is not null group by user_id having count(*)>1
) duplicates;
select count(*) as duplicate_application_id_groups from (
  select application_id from public.loan_applications group by application_id having count(*)>1
) duplicates;
select count(*) as linked_profile_status_conflicts from public.members m join auth.users u on u.id=m.user_id
where u.raw_app_meta_data->>'role' in ('admin','coop_admin','super_admin')
  and u.raw_app_meta_data->>'account_status' is not null
  and m.status is distinct from u.raw_app_meta_data->>'account_status';

commit;
