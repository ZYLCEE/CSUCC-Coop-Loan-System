import{readFileSync,writeFileSync}from'node:fs';
const base=JSON.parse(readFileSync('docs/committee-creation/database-baseline.json','utf8')).find(x=>x.name==='committee_complete_setup').definition.replaceAll('\r\n','\n');
if(!base.includes('OR u.invited_at IS NULL'))throw Error('Unexpected setup procedure');
const fixed=base.replace('OR u.invited_at IS NULL',`OR (u.invited_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.committee_account_requests r
    WHERE r.id=m.invitation_request_id AND r.kind='invite' AND r.state='complete' AND r.auth_user_id=u.id AND r.membership_id=m.id
    AND r.payload->>'provisioningMode'='password' AND u.raw_app_meta_data->>'committee_invitation_request_id'=r.id::text))`);
writeFileSync('supabase/migrations/20261111233000_committee_password_setup.sql',`-- Temporary-password reviewers complete their own setup without requiring an email invitation.\nBEGIN;\n${fixed.trimEnd()};\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n`);
const test=String.raw`
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
`;
writeFileSync('docs/committee-creation/password-setup-rollback.sql',`BEGIN;\n${fixed.trimEnd()};\n${test}`);
