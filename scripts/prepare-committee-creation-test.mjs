import{readFileSync,writeFileSync}from'node:fs';
const migration=readFileSync('supabase/migrations/20261111223000_committee_account_creation.sql','utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const test=String.raw`
-- Synthetic Auth/profile/request rows remain uncommitted. No email is sent,
-- no real account is modified and no synthetic activity survives ROLLBACK.
CREATE TABLE public.committee_creation_test_dependency(member_id uuid REFERENCES public.members(id));
CREATE TEMP TABLE review_assignments(LIKE public.review_assignments INCLUDING DEFAULTS);
CREATE TRIGGER isolated_number_snapshot BEFORE INSERT ON pg_temp.review_assignments FOR EACH ROW EXECUTE FUNCTION public.committee_snapshot_member_number();
DO $test$
DECLARE actor uuid:=gen_random_uuid();admin_actor uuid:=gen_random_uuid();reviewer uuid:=gen_random_uuid();legacy uuid:=gen_random_uuid();req uuid:=gen_random_uuid();legacy_req uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();legacy_attempt uuid:=gen_random_uuid();invited uuid:=gen_random_uuid();invite_req uuid:=gen_random_uuid();invite_attempt uuid:=gen_random_uuid();borrower uuid:=gen_random_uuid();profile_id uuid;membership uuid;data jsonb;payload jsonb;original jsonb;response jsonb;n integer;
BEGIN
 IF has_function_privilege('authenticated','public.committee_account_action(uuid,text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.committee_archive_auto_profile(uuid,uuid)','EXECUTE') OR has_table_privilege('authenticated','public.committee_profile_archive','SELECT') THEN RAISE EXCEPTION 'Private provisioning interfaces exposed';END IF;
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at)
  VALUES(actor,actor||'@synthetic.invalid','{"role":"crecom_member"}','{}',now(),now()),(admin_actor,admin_actor||'@synthetic.invalid','{"role":"crecom_member"}','{}',now(),now());
 UPDATE auth.users SET raw_app_meta_data='{"role":"super_admin","account_status":"active"}' WHERE id=actor;
 UPDATE auth.users SET raw_app_meta_data='{"role":"admin","account_status":"active"}' WHERE id=admin_actor;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 BEGIN PERFORM public.committee_account_action(admin_actor,'committee_accounts','{}');RAISE EXCEPTION 'Unprivileged Admin admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{"admin_privileges":["committee.accounts.manage"]}'::jsonb WHERE id=admin_actor;
 PERFORM set_config('request.jwt.claim.sub',admin_actor::text,true);
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Assigned Admin privilege ignored';END IF;
 PERFORM public.committee_accounts();
 payload:=jsonb_build_object('name','Synthetic Reviewer','email',reviewer||'@synthetic.invalid','role','crecom_member','committeeSeat','member','committeeMemberNumber',1,'title','','startsAt',now()-interval '1 day','endsAt',null,'provisioningMode','password');
 response:=public.committee_account_action(admin_actor,'committee_reserve_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_payload',payload));
 IF (response->>'complete')::boolean THEN RAISE EXCEPTION 'Fresh reservation marked complete';END IF;
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at)
  VALUES(reviewer,reviewer||'@synthetic.invalid',jsonb_build_object('role','crecom_member','account_status','active','committee_invitation_request_id',req),'{}',now(),now());
 IF EXISTS(SELECT 1 FROM public.members WHERE user_id=reviewer) THEN RAISE EXCEPTION 'Committee Auth creation still creates a borrower';END IF;
 response:=public.committee_account_action(admin_actor,'committee_finish_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_user_id',reviewer));
 membership:=(response->>'membershipId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.staff_memberships WHERE id=membership AND member_number=1 AND setup_completed_at IS NULL) THEN RAISE EXCEPTION 'Membership or numbered position missing';END IF;
 PERFORM public.committee_account_action(admin_actor,'committee_finish_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_user_id',reviewer));
 SELECT count(*) INTO n FROM public.staff_memberships WHERE auth_user_id=reviewer;IF n<>1 THEN RAISE EXCEPTION 'Retry duplicated the reviewer';END IF;
 INSERT INTO pg_temp.review_assignments(review_cycle_id,reviewer_auth_id,membership_id,signatory_role) VALUES(gen_random_uuid(),reviewer,membership,'crecom_member');
 IF NOT EXISTS(SELECT 1 FROM pg_temp.review_assignments WHERE membership_id=membership AND member_number=1) THEN RAISE EXCEPTION 'Assignment did not snapshot Member 1';END IF;
 UPDATE public.staff_memberships SET member_number=2 WHERE id=membership;
 IF NOT EXISTS(SELECT 1 FROM pg_temp.review_assignments WHERE membership_id=membership AND member_number=1) THEN RAISE EXCEPTION 'Changing membership rewrote an assignment position';END IF;
 -- Simulate the old bug without invoking an external Auth provider.
 payload:=payload||jsonb_build_object('email',legacy||'@synthetic.invalid');payload:=payload-'committeeMemberNumber';
 INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,state) VALUES(legacy_req,'invite',actor,legacy||'@synthetic.invalid',payload,'legacy','failed');
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at)
  VALUES(legacy,legacy||'@synthetic.invalid',jsonb_build_object('role','crecom_member','account_status','active','committee_invitation_request_id',legacy_req),'{}',now(),now());
 INSERT INTO public.members(user_id,first_name,last_name,email,created_at) VALUES(legacy,legacy::text,'',legacy||'@synthetic.invalid',now()) RETURNING id,to_jsonb(members.*) INTO profile_id,original;
 INSERT INTO public.committee_creation_test_dependency VALUES(profile_id);
 BEGIN PERFORM public.committee_archive_auto_profile(legacy,legacy_req);RAISE EXCEPTION 'Linked profile was archived';EXCEPTION WHEN raise_exception THEN IF SQLERRM='Linked profile was archived' THEN RAISE;END IF;END;
 IF NOT EXISTS(SELECT 1 FROM public.members WHERE id=profile_id) THEN RAISE EXCEPTION 'Linked profile was changed';END IF;
 DELETE FROM public.committee_creation_test_dependency WHERE member_id=profile_id;
 UPDATE public.members SET role='member' WHERE id=profile_id;
 BEGIN PERFORM public.committee_archive_auto_profile(legacy,legacy_req);RAISE EXCEPTION 'Real member profile was archived';EXCEPTION WHEN raise_exception THEN IF SQLERRM='Real member profile was archived' THEN RAISE;END IF;END;
 UPDATE public.members SET role=null WHERE id=profile_id;
 response:=public.committee_account_action(actor,'committee_reserve_invite',jsonb_build_object('p_request_id',legacy_req,'p_attempt_id',legacy_attempt,'p_payload',payload||'{"committeeMemberNumber":2}'::jsonb));
 IF response->>'authUserId'<>legacy::text THEN RAISE EXCEPTION 'Retry lost the original Auth account';END IF;
 IF EXISTS(SELECT 1 FROM public.members WHERE id=profile_id) OR NOT EXISTS(SELECT 1 FROM public.committee_profile_archive ar WHERE ar.auth_user_id=legacy AND ar.request_id=legacy_req) THEN RAISE EXCEPTION 'Legacy automatic profile repair failed';END IF;
 IF EXISTS(SELECT 1 FROM public.portal_activity_events WHERE source_key LIKE 'members:'||profile_id::text||':delete:%') THEN RAISE EXCEPTION 'Repair produced a false activity event';END IF;
 response:=public.committee_account_action(actor,'committee_finish_invite',jsonb_build_object('p_request_id',legacy_req,'p_attempt_id',legacy_attempt,'p_user_id',legacy));
 IF NOT EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=legacy AND member_number=2) THEN RAISE EXCEPTION 'Legacy request did not complete in its selected position';END IF;
 payload:=payload||jsonb_build_object('email',invited||'@synthetic.invalid','committeeMemberNumber',2);payload:=payload-'provisioningMode';
 PERFORM public.committee_account_action(actor,'committee_reserve_invite',jsonb_build_object('p_request_id',invite_req,'p_attempt_id',invite_attempt,'p_payload',payload));
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at) VALUES(invited,invited||'@synthetic.invalid',jsonb_build_object('role','crecom_member','committee_invitation_request_id',invite_req),'{}',now(),now());
 BEGIN PERFORM public.committee_account_action(actor,'committee_finish_invite',jsonb_build_object('p_request_id',invite_req,'p_attempt_id',invite_attempt,'p_user_id',invited));RAISE EXCEPTION 'Invitation evidence bypassed';EXCEPTION WHEN raise_exception THEN IF SQLERRM='Invitation evidence bypassed' THEN RAISE;END IF;END;
 UPDATE auth.users SET invited_at=now() WHERE id=invited;
 PERFORM public.committee_account_action(actor,'committee_finish_invite',jsonb_build_object('p_request_id',invite_req,'p_attempt_id',invite_attempt,'p_user_id',invited));
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at) VALUES(borrower,borrower||'@synthetic.invalid','{"role":"member"}','{}',now());
 IF NOT EXISTS(SELECT 1 FROM public.members WHERE user_id=borrower) THEN RAISE EXCEPTION 'Normal borrower profile creation regressed';END IF;
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 IF (public.portal_session_access()->>'allowed')::boolean THEN RAISE EXCEPTION 'Reviewer bypassed personal setup';END IF;
END;
$test$;
SELECT 'PASS: trigger exclusion, assigned Admin permission, service-only provisioning, member positions, duplicate prevention, legacy retry repair, dependency protection, immutable snapshots and personal setup gate' AS validation;
ROLLBACK;
`;
writeFileSync('docs/committee-creation/rollback-validation.sql','BEGIN;\n'+migration+'\n'+test);
