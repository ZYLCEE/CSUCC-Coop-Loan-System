BEGIN READ ONLY;
SELECT
 (SELECT count(*) FROM public.staff_memberships) AS reviewer_accounts,
 (SELECT count(*) FROM public.approval_workflow_policies WHERE status='approved') AS approved_policies,
 (SELECT count(*) FROM public.committee_policy_rules) AS activated_rules,
 (SELECT count(*) FROM public.review_assignments) AS assignments,
 (SELECT count(*) FROM public.individual_review_decisions) AS individual_decisions,
 (SELECT count(*) FROM public.application_final_decisions) AS final_decisions,
 (SELECT count(*)=4 FROM information_schema.columns WHERE table_schema='public' AND
  ((table_name='staff_memberships' AND column_name='committee_seat') OR (table_name IN ('review_assignments','individual_review_decisions') AND column_name='signatory_role') OR (table_name='committee_policy_rules' AND column_name='signatory_layout'))) AS signatory_columns_installed,
 NOT has_function_privilege('authenticated','public.committee_review_action(uuid,text,jsonb)','EXECUTE') AS browser_dispatch_blocked,
 has_function_privilege('service_role','public.committee_review_action(uuid,text,jsonb)','EXECUTE') AS server_dispatch_enabled;
DO $$
DECLARE actor uuid;
BEGIN
 SELECT id INTO STRICT actor FROM auth.users WHERE raw_app_meta_data->>'role'='super_admin' AND coalesce(raw_app_meta_data->>'account_status','active')='active' LIMIT 1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','app_metadata',jsonb_build_object('role','super_admin','account_status','active'))::text,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END$$;
SET LOCAL ROLE authenticated;
SELECT
 (SELECT count(*) FROM public.loan_applications WHERE status IN ('pending','under review','approved','rejected')) AS application_rows,
 jsonb_array_length(public.application_workflow_summaries()) AS workflow_summary_rows,
 jsonb_array_length(public.committee_accounts()->'accounts') AS committee_accounts_readable,
 coalesce((SELECT bool_and(state ? 'cycles' AND state ? 'stateHash') FROM
  (SELECT public.committee_review_state(a.application_id) AS state FROM public.loan_applications a
   JOIN public.application_verifications v ON v.application_id=a.id LIMIT 5)s),true) AS existing_review_states_readable;
ROLLBACK;
