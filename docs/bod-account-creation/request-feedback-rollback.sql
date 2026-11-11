-- Report existing-role conflicts and fail promptly for concurrent creation requests.
BEGIN;
CREATE OR REPLACE FUNCTION public.committee_reserve_invite(p_request_id uuid, p_attempt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.committee_account_requests%ROWTYPE; existing auth.users%ROWTYPE; fingerprint text; invite_email text:=lower(btrim(p_payload->>'email')); start_date timestamptz; end_date timestamptz;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 OR length(coalesce(invite_email,'')) NOT BETWEEN 3 AND 254 OR invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  OR coalesce(p_payload->>'role','') NOT IN ('crecom_member','bod_member') OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Enter valid committee account details.'; END IF;

 IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;
 IF p_payload->>'role'='crecom_member' AND p_payload->>'committeeSeat'='member' AND coalesce(p_payload->>'committeeMemberNumber','') NOT IN ('1','2') THEN RAISE EXCEPTION 'Choose CRECOM Member 1 or CRECOM Member 2.';END IF;
 start_date:=(p_payload->>'startsAt')::timestamptz;end_date:=(p_payload->>'endsAt')::timestamptz;
 IF start_date IS NULL OR (end_date IS NOT NULL AND end_date<=start_date) THEN RAISE EXCEPTION 'Choose valid membership dates.'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'payload',p_payload)::text,'UTF8')),'hex');
 IF NOT pg_try_advisory_xact_lock(hashtextextended('committee-invite:'||invite_email,0)) THEN
  RAISE EXCEPTION 'Another request is processing this email. Wait a moment, refresh Committee Accounts and retry the saved request.' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id FOR UPDATE NOWAIT;
 IF FOUND THEN
  -- A failed legacy request may acquire its missing numbered position once.
  -- Every other detail, owner and the original request reference remain fixed.
  IF r.kind='invite' AND r.actor_id=auth.uid() AND r.state='failed' AND NOT (r.payload ? 'committeeMemberNumber') AND (r.payload-'committeeMemberNumber')=(p_payload-'committeeMemberNumber') THEN
   UPDATE public.committee_account_requests SET payload=p_payload,request_hash=fingerprint WHERE id=r.id RETURNING * INTO r;
  END IF;
  IF r.kind<>'invite' OR r.actor_id<>auth.uid() OR r.request_hash<>fingerprint THEN RAISE EXCEPTION 'This invitation reference was already used.' USING ERRCODE='40001'; END IF;
  IF r.state='complete' THEN RETURN jsonb_build_object('complete',true,'membershipId',r.membership_id); END IF;
  IF r.lease_until>now() THEN RAISE EXCEPTION 'Invitation processing is still pending. Wait a minute and retry.' USING ERRCODE='55P03'; END IF;
 ELSE
  SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;
  IF FOUND THEN
   RAISE EXCEPTION 'This email already belongs to a % account. Manage that account or use a different email for the % account.',
    CASE existing.raw_app_meta_data->>'role' WHEN 'crecom_member' THEN 'CRECOM' WHEN 'bod_member' THEN 'BOD' WHEN 'super_admin' THEN 'Super Admin' WHEN 'admin' THEN 'Admin' WHEN 'coop_admin' THEN 'Admin' ELSE 'member' END,
    CASE WHEN p_payload->>'role'='bod_member' THEN 'BOD' ELSE 'CRECOM' END USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.committee_account_requests q WHERE q.kind='invite' AND lower(q.email)=invite_email) THEN RAISE EXCEPTION 'This email already has a saved committee creation request. Refresh Committee Accounts and use Retry creation.' USING ERRCODE='40001'; END IF;
  INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash) VALUES(p_request_id,'invite',auth.uid(),invite_email,p_payload,fingerprint) RETURNING * INTO r;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-request',p_request_id::text,'success',jsonb_build_object('role',p_payload->>'role','email',invite_email,'committeeSeat',p_payload->>'committeeSeat'));
 END IF;
 SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;
 IF existing.id IS NOT NULL THEN PERFORM public.committee_archive_auto_profile(existing.id,r.id);END IF;
 IF FOUND AND ((coalesce(r.payload->>'provisioningMode','invite')<>'password' AND existing.invited_at IS NULL) OR (existing.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text
  AND (existing.raw_app_meta_data->>'role' IS NOT NULL OR existing.raw_user_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text))
  OR EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=existing.id)) THEN RAISE EXCEPTION 'The existing account does not match this invitation. Contact the system administrator.'; END IF;
 UPDATE public.committee_account_requests SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds',error=null,auth_user_id=existing.id WHERE id=r.id;
 RETURN jsonb_build_object('complete',false,'authUserId',existing.id,'payload',r.payload);
END;
$function$;
NOTIFY pgrst,'reload schema';


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
