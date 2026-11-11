-- Synthetic accounts and review packet only; the runner wraps this in ROLLBACK.
-- This helper override exists only inside the rolled-back test transaction.
CREATE OR REPLACE FUNCTION public.committee_bod_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(current_setting('coop.bod_test_enabled',true),'false')::boolean;
$$;
SELECT set_config('coop.bod_test_enabled','false',true);
DO $test$
DECLARE actor uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid();
 membership uuid; payload jsonb; response jsonb; borrower uuid:=gen_random_uuid(); member uuid:=gen_random_uuid();
 app uuid:=gen_random_uuid(); policy uuid:=gen_random_uuid(); cycle uuid:=gen_random_uuid(); assignment uuid:=gen_random_uuid(); access jsonb;
BEGIN
 IF has_function_privilege('authenticated','public.committee_complete_setup(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.committee_reserve_invite(uuid,uuid,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Account provisioning bypassed service-only protection';
 END IF;
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at)
 VALUES(actor,actor||'@bod-provision-fixture.invalid','{"role":"crecom_member"}','{}',now(),now());
 UPDATE auth.users SET raw_app_meta_data='{"role":"super_admin","account_status":"active"}' WHERE id=actor;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 payload:=jsonb_build_object('name','Synthetic BOD Chairperson','email',reviewer||'@bod-provision-fixture.invalid','role','bod_member',
  'committeeSeat','chairperson','committeeMemberNumber',null,'title','','startsAt',now()-interval '1 day','endsAt',null,'provisioningMode','password');
 PERFORM public.committee_account_action(actor,'committee_reserve_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_payload',payload));
 -- A saved request can be retried without creating a second membership.
 UPDATE public.committee_account_requests SET state='failed',lease_until=null WHERE id=req;
 PERFORM public.committee_account_action(actor,'committee_reserve_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_payload',payload));
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at,encrypted_password)
 VALUES(reviewer,reviewer||'@bod-provision-fixture.invalid',jsonb_build_object('role','bod_member','account_status','active','committee_invitation_request_id',req),'{}',now(),now(),'synthetic-uncommitted-not-a-login-hash');
 response:=public.committee_account_action(actor,'committee_finish_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_user_id',reviewer));
 membership:=(response->>'membershipId')::uuid;
 PERFORM public.committee_account_action(actor,'committee_finish_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_user_id',reviewer));
 IF (SELECT count(*) FROM public.staff_memberships WHERE auth_user_id=reviewer)<>1
 OR EXISTS(SELECT 1 FROM public.members WHERE user_id=reviewer) THEN RAISE EXCEPTION 'BOD creation duplicated or created a borrower profile';END IF;
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 access:=public.portal_session_access();
 IF NOT (access->>'setupRequired')::boolean OR (access->>'allowed')::boolean THEN RAISE EXCEPTION 'BOD bypassed personal password setup';END IF;
 -- Incomplete password creation and inactive membership still cannot finish setup.
 UPDATE public.committee_account_requests SET state='pending' WHERE id=req;
 BEGIN PERFORM public.committee_complete_setup(reviewer);RAISE EXCEPTION 'Unfinished account admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.committee_account_requests SET state='complete' WHERE id=req;
 UPDATE public.staff_memberships SET active=false WHERE id=membership;
 BEGIN PERFORM public.committee_complete_setup(reviewer);RAISE EXCEPTION 'Inactive account admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.staff_memberships SET active=true WHERE id=membership;
 PERFORM public.committee_complete_setup(reviewer);
 access:=public.portal_session_access();
 IF NOT (access->>'allowed')::boolean OR (access->>'setupRequired')::boolean OR (access->>'reviewEnabled')::boolean THEN
  RAISE EXCEPTION 'BOD account access was not separated from loan review activation';
 END IF;
 -- Membership management and setup links work before policy approval too.
 PERFORM public.committee_account_action(actor,'committee_change_membership',jsonb_build_object('p_id',membership,'p_revision',(SELECT revision FROM public.staff_memberships WHERE id=membership),'p_action','deactivate','p_payload',jsonb_build_object('reason','Synthetic term update'),'p_request_id',gen_random_uuid()));
 PERFORM public.committee_account_action(actor,'committee_change_membership',jsonb_build_object('p_id',membership,'p_revision',(SELECT revision FROM public.staff_memberships WHERE id=membership),'p_action','reactivate','p_payload',jsonb_build_object('reason','Synthetic term update'),'p_request_id',gen_random_uuid()));
 UPDATE public.staff_memberships SET last_invite_at=now()-interval '2 minutes' WHERE id=membership;
 PERFORM public.committee_account_action(actor,'committee_begin_link',jsonb_build_object('p_id',membership,'p_revision',(SELECT revision FROM public.staff_memberships WHERE id=membership),'p_request_id',gen_random_uuid(),'p_attempt_id',gen_random_uuid()));
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 IF (SELECT x->>'status' FROM jsonb_array_elements(public.committee_accounts()->'accounts') x WHERE x->>'id'=membership::text)<>'active' THEN
  RAISE EXCEPTION 'Roster still treats BOD policy activation as an account status';
 END IF;
 -- An isolated packet proves admission cannot expose BOD reviews while policy is disabled.
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at)
 VALUES(borrower,borrower||'@bod-provision-fixture.invalid','{"role":"crecom_member"}','{}',now(),now());
 UPDATE auth.users SET raw_app_meta_data='{"role":"member"}' WHERE id=borrower;
 INSERT INTO public.members(id,user_id,member_id,first_name,last_name,status,must_change_password)
 VALUES(member,borrower,'BOD-QA-'||member,'Synthetic','Borrower','active',false);
 INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted,tenure_months,monthly_payment)
 VALUES(app,'BOD-QA-'||app,member,'Synthetic Borrower','Business',1000,'pending',current_date,12,100);
 INSERT INTO public.approval_workflow_policies(id,version,name,config,created_by,created_by_name)
 VALUES(policy,-floor(extract(epoch FROM clock_timestamp())*1000)::bigint,'Synthetic BOD fixture','{}',actor,'Synthetic Admin');
 INSERT INTO public.application_review_cycles(id,application_id,cycle_no,stage,packet_version,packet_snapshot,policy_id,created_by)
 VALUES(cycle,app,1,'BOD',1,'{}',policy,actor);
 INSERT INTO public.review_assignments(id,review_cycle_id,reviewer_auth_id,membership_id,signatory_role)
 VALUES(assignment,cycle,reviewer,membership,'bod_chairperson');
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 IF public.committee_reviewer_available(membership,app,'BOD') OR public.committee_assignment_eligible(assignment) THEN
  RAISE EXCEPTION 'Disabled BOD policy exposed loan review access';
 END IF;
 BEGIN PERFORM public.committee_review_packet(assignment);RAISE EXCEPTION 'Disabled policy exposed packet';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('coop.bod_test_enabled','true',true);
 IF NOT public.committee_reviewer_available(membership,app,'BOD') OR NOT public.committee_assignment_eligible(assignment) THEN
  RAISE EXCEPTION 'Eligible BOD reviewer remains blocked after policy activation';
 END IF;
 UPDATE public.staff_memberships SET active=false WHERE id=membership;
 IF (public.portal_session_access()->>'allowed')::boolean OR public.committee_assignment_eligible(assignment) THEN
  RAISE EXCEPTION 'Inactive reviewer retained access';
 END IF;
END;
$test$;
SELECT 'PASS: BOD creation, retry, setup, roster, management and links before policy activation; personal setup and active-membership gates; packet and assignment policy protection' AS validation;
