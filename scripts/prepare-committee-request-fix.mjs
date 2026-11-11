import {readFileSync,writeFileSync} from 'node:fs';
const prior=readFileSync('supabase/migrations/20261112001000_bod_account_provisioning.sql','utf8').replaceAll('\r\n','\n');
let reserve=prior.match(/CREATE OR REPLACE FUNCTION public\.committee_reserve_invite[\s\S]*?\n\$function\$;/)?.[0];
if(!reserve)throw Error('Missing deployed reserve definition');
const replace=(before,after)=>{if(reserve.split(before).length!==2)throw Error('Unexpected reserve definition');reserve=reserve.replace(before,after);};
replace(" PERFORM pg_advisory_xact_lock(hashtextextended('committee-invite:'||invite_email,0));",` IF NOT pg_try_advisory_xact_lock(hashtextextended('committee-invite:'||invite_email,0)) THEN
  RAISE EXCEPTION 'Another request is processing this email. Wait a moment, refresh Committee Accounts and retry the saved request.' USING ERRCODE='55P03';
 END IF;`);
replace('WHERE id=p_request_id FOR UPDATE;','WHERE id=p_request_id FOR UPDATE NOWAIT;');
const priorChecks=`  IF EXISTS(SELECT 1 FROM public.committee_account_requests q WHERE q.kind='invite' AND lower(q.email)=invite_email) THEN RAISE EXCEPTION 'This email already has a committee invitation. Use its Retry or Send setup link action.' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=invite_email) THEN RAISE EXCEPTION 'This email is already registered. Existing member or staff accounts cannot be converted through an invitation.'; END IF;`;
replace(priorChecks,`  SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;
  IF FOUND THEN
   RAISE EXCEPTION 'This email already belongs to a % account. Manage that account or use a different email for the % account.',
    CASE existing.raw_app_meta_data->>'role' WHEN 'crecom_member' THEN 'CRECOM' WHEN 'bod_member' THEN 'BOD' WHEN 'super_admin' THEN 'Super Admin' WHEN 'admin' THEN 'Admin' WHEN 'coop_admin' THEN 'Admin' ELSE 'member' END,
    CASE WHEN p_payload->>'role'='bod_member' THEN 'BOD' ELSE 'CRECOM' END USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.committee_account_requests q WHERE q.kind='invite' AND lower(q.email)=invite_email) THEN RAISE EXCEPTION 'This email already has a saved committee creation request. Refresh Committee Accounts and use Retry creation.' USING ERRCODE='40001'; END IF;`);
const migration=`-- Report existing-role conflicts and fail promptly for concurrent creation requests.\nBEGIN;\n${reserve}\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n`;
writeFileSync('supabase/migrations/20261112010000_committee_creation_request_feedback.sql',migration);
const cases=String.raw`
DO $test$
DECLARE actor uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); payload jsonb; rejected boolean:=false;
BEGIN
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,email_confirmed_at)
 VALUES(actor,actor||'@committee-feedback-fixture.invalid','{"role":"crecom_member"}','{}',now(),now()),
 (reviewer,reviewer||'@committee-feedback-fixture.invalid','{"role":"crecom_member"}','{}',now(),now());
 UPDATE auth.users SET raw_app_meta_data='{"role":"super_admin","account_status":"active"}' WHERE id=actor;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 payload:=jsonb_build_object('name','Synthetic BOD Chairperson','email',reviewer||'@committee-feedback-fixture.invalid','role','bod_member','committeeSeat','chairperson','committeeMemberNumber',null,'title','','startsAt',now()-interval '1 day','endsAt',null,'provisioningMode','password');
 BEGIN
  PERFORM public.committee_account_action(actor,'committee_reserve_invite',jsonb_build_object('p_request_id',req,'p_attempt_id',gen_random_uuid(),'p_payload',payload));
 EXCEPTION WHEN serialization_failure THEN
  IF SQLERRM NOT LIKE '%CRECOM account%different email for the BOD account%' THEN RAISE;END IF; rejected:=true;
 END;
 IF NOT rejected OR EXISTS(SELECT 1 FROM public.committee_account_requests WHERE id=req) THEN RAISE EXCEPTION 'Existing email did not fail before account creation';END IF;
 IF (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=reviewer)<>'crecom_member' THEN RAISE EXCEPTION 'Existing role changed';END IF;
 IF has_function_privilege('authenticated','public.committee_reserve_invite(uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Browser bypass admitted';END IF;
END;
$test$;
SELECT 'PASS: existing CRECOM email produces an actionable BOD conflict, without a new request or role change; service-only protection retained' AS validation;
ROLLBACK;
`;
writeFileSync('docs/bod-account-creation/request-feedback-rollback.sql',migration.replace(/COMMIT;\s*$/,'')+'\n'+cases);
console.log('Prepared account-conflict feedback and nonblocking reservation validation.');
