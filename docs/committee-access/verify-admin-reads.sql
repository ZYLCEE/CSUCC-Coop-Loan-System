BEGIN READ ONLY;
DO $$
DECLARE actor uuid;
BEGIN
 SELECT id INTO STRICT actor FROM auth.users
 WHERE raw_app_meta_data->>'role'='super_admin'
 AND coalesce(raw_app_meta_data->>'account_status','active')='active' LIMIT 1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated',
  'app_metadata',jsonb_build_object('role','super_admin','account_status','active'))::text,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END$$;
SET LOCAL ROLE authenticated;
SELECT
 (SELECT count(*) FROM public.loan_applications l LEFT JOIN public.members m ON m.id=l.member_id
  WHERE l.status IN ('pending','under review','approved','rejected')) AS application_rows,
 jsonb_array_length(public.application_workflow_summaries()) AS summary_rows;
ROLLBACK;
