BEGIN;
CREATE OR REPLACE FUNCTION public.committee_complete_setup(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 SELECT * INTO m FROM public.staff_memberships WHERE auth_user_id=u.id AND role=u.raw_app_meta_data->>'role' ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;
 IF m.id IS NULL OR NOT m.active OR m.ends_at<=now() OR u.email_confirmed_at IS NULL
  OR coalesce(u.raw_app_meta_data->>'account_status','active')<>'active' OR u.banned_until>now()
  OR (m.role='bod_member' AND NOT public.committee_bod_enabled()) OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id)
  OR (u.invited_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.committee_account_requests r
    WHERE r.id=m.invitation_request_id AND r.kind='invite' AND r.state='complete' AND r.auth_user_id=u.id AND r.membership_id=m.id
    AND r.payload->>'provisioningMode'='password' AND u.raw_app_meta_data->>'committee_invitation_request_id'=r.id::text)) OR length(coalesce(u.encrypted_password,''))=0 THEN RAISE EXCEPTION 'Complete a valid account invitation and password setup first.' USING ERRCODE='42501'; END IF;
 IF m.setup_completed_at IS NULL THEN
  UPDATE public.staff_memberships SET setup_completed_at=clock_timestamp(),revision=revision+1 WHERE id=m.id;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(u.id,'committee-own-setup',m.id::text,'success','{}');
 END IF;
 RETURN jsonb_build_object('success',true);
END;
$function$;

DO $test$
DECLARE actor uuid:=gen_random_uuid();reviewer uuid:=gen_random_uuid();req uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();membership uuid;payload jsonb;response jsonb;
BEGIN
 IF has_function_privilege('authenticated','public.committee_complete_setup(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Browser can bypass password setup';END IF;
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at)
 VALUES(actor,actor||'@setup-fixture.invalid','{"role":"crecom_member"}','{}',now(),now());
 UPDATE auth.users SET raw_app_meta_data='{"role":"super_admin","account_status":"active"}' WHERE id=actor;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 payload:=jsonb_build_object('name','Synthetic Setup Reviewer','email',reviewer||'@setup-fixture.invalid','role','crecom_member','committeeSeat','member','committeeMemberNumber',1,'title','','startsAt',now()-interval '1 day','endsAt',null,'provisioningMode','password');
 PERFORM public.committee_account_action(actor,'committee_reserve_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_payload',payload));
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at,encrypted_password)
 VALUES(reviewer,reviewer||'@setup-fixture.invalid',jsonb_build_object('role','crecom_member','account_status','active','committee_invitation_request_id',req),'{}',now(),now(),'synthetic-uncommitted-not-a-login-hash');
 response:=public.committee_account_action(actor,'committee_finish_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',attempt,'p_user_id',reviewer));membership:=(response->>'membershipId')::uuid;
 PERFORM set_config('request.jwt.claim.sub',reviewer::text,true);
 IF NOT (public.portal_session_access()->>'setupRequired')::boolean THEN RAISE EXCEPTION 'Personal setup was not required';END IF;
 UPDATE public.committee_account_requests SET state='pending' WHERE id=req;
 BEGIN PERFORM public.committee_complete_setup(reviewer);RAISE EXCEPTION 'Unfinished creation admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.committee_account_requests SET state='complete' WHERE id=req;
 UPDATE public.staff_memberships SET active=false WHERE id=membership;
 BEGIN PERFORM public.committee_complete_setup(reviewer);RAISE EXCEPTION 'Inactive membership admitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.staff_memberships SET active=true WHERE id=membership;
 PERFORM public.committee_complete_setup(reviewer);
 IF NOT (public.portal_session_access()->>'allowed')::boolean OR (public.portal_session_access()->>'setupRequired')::boolean THEN RAISE EXCEPTION 'Password setup did not open committee access';END IF;
 PERFORM public.committee_complete_setup(reviewer);
 IF (SELECT count(*) FROM public.admin_activity_logs WHERE actor_id=reviewer AND action_name='committee-own-setup')<>1 THEN RAISE EXCEPTION 'Setup retry duplicated completion activity';END IF;
END;
$test$;
SELECT 'PASS: service-only completion, completed password provisioning, inactive-member rejection, personal setup gate, portal access and idempotent completion' AS validation;
ROLLBACK;
