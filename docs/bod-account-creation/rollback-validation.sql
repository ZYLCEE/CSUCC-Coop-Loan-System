-- BOD account provisioning and personal setup do not require loan policy activation.
-- Review availability, routing and packet access retain the BOD policy gate.
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
 PERFORM pg_advisory_xact_lock(hashtextextended('committee-invite:'||invite_email,0));
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id FOR UPDATE;
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
  IF EXISTS(SELECT 1 FROM public.committee_account_requests q WHERE q.kind='invite' AND lower(q.email)=invite_email) THEN RAISE EXCEPTION 'This email already has a committee invitation. Use its Retry or Send setup link action.' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=invite_email) THEN RAISE EXCEPTION 'This email is already registered. Existing member or staff accounts cannot be converted through an invitation.'; END IF;
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

CREATE OR REPLACE FUNCTION public.committee_finish_invite(p_request_id uuid, p_attempt_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.committee_account_requests%ROWTYPE; u auth.users%ROWTYPE; membership uuid;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request_id AND kind='invite' FOR UPDATE;
 IF r.actor_id<>auth.uid() THEN RAISE EXCEPTION 'This invitation belongs to another administrator.' USING ERRCODE='42501'; END IF;
 IF r.state='complete' THEN RETURN r.result; END IF;
 IF r.attempt_id IS DISTINCT FROM p_attempt_id OR r.lease_until<=now() THEN RAISE EXCEPTION 'Invitation processing changed. Retry the saved request.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 PERFORM public.committee_archive_auto_profile(p_user_id,r.id);
 IF lower(u.email)<>lower(r.email) OR (coalesce(r.payload->>'provisioningMode','invite')<>'password' AND u.invited_at IS NULL) OR u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role'
  OR u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id)
  THEN RAISE EXCEPTION 'The invited account could not be verified.'; END IF;
 IF coalesce(r.payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (r.payload->>'role'='bod_member' AND r.payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'The invitation needs a valid committee position.'; END IF;
 INSERT INTO public.staff_memberships(auth_user_id,role,active,starts_at,ends_at,assigned_by,title,committee_seat,member_number,invitation_request_id,last_invite_at)
 VALUES(u.id,r.payload->>'role',true,(r.payload->>'startsAt')::timestamptz,(r.payload->>'endsAt')::timestamptz,auth.uid(),coalesce(r.payload->>'title',''),r.payload->>'committeeSeat',CASE WHEN r.payload->>'role'='crecom_member' AND r.payload->>'committeeSeat'='member' THEN (r.payload->>'committeeMemberNumber')::smallint END,r.id,clock_timestamp()) RETURNING id INTO membership;
 UPDATE public.committee_account_requests SET state='complete',auth_user_id=u.id,membership_id=membership,result=jsonb_build_object('membershipId',membership),lease_until=null WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-complete',membership::text,'success',jsonb_build_object('requestId',r.id,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','committeeMemberNumber',(r.payload->>'committeeMemberNumber')::smallint));
 RETURN jsonb_build_object('membershipId',membership);
END;
$function$;

CREATE OR REPLACE FUNCTION public.committee_change_membership(p_id uuid, p_revision integer, p_action text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text; next_role text; next_seat text; starts timestamptz; ends timestamptz; next_active boolean;next_number smallint; result jsonb;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_action IS NULL OR p_action NOT IN ('edit','deactivate','reactivate') OR p_payload IS NULL
  OR length(btrim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a reason for this membership change.'; END IF;
 SELECT * INTO STRICT m FROM public.staff_memberships WHERE id=p_id FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'action',p_action,'payload',p_payload,'actor',auth.uid())::text,'UTF8')),'hex');
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id;
 IF FOUND THEN IF r.request_hash=fingerprint AND r.actor_id=auth.uid() AND r.kind='membership' THEN RETURN r.result; END IF; RAISE EXCEPTION 'This request reference was already used.' USING ERRCODE='40001'; END IF;
 IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Membership changed. Reload before saving.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id FOR UPDATE;
 IF u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'This account requires manual membership reconciliation.'; END IF;
 next_number:=m.member_number;next_role:=m.role;next_seat:=m.committee_seat;starts:=m.starts_at;ends:=m.ends_at;next_active:=m.active;
 IF p_action='edit' THEN
  next_seat:=p_payload->>'committeeSeat';
  next_number:=CASE WHEN p_payload->>'role'='crecom_member' AND next_seat='member' THEN (p_payload->>'committeeMemberNumber')::smallint END;
  IF p_payload->>'role'='crecom_member' AND next_seat='member' AND (next_number IS NULL OR next_number NOT IN (1,2)) THEN RAISE EXCEPTION 'Choose CRECOM Member 1 or CRECOM Member 2.';END IF;
 IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;
  next_role:=p_payload->>'role';starts:=(p_payload->>'startsAt')::timestamptz;ends:=(p_payload->>'endsAt')::timestamptz;
  IF next_role IS NULL OR next_role NOT IN ('crecom_member','bod_member') OR starts IS NULL OR ends<=starts OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Choose valid membership details.'; END IF;
 ELSIF p_action='deactivate' THEN next_active:=false;
 ELSE next_active:=true; IF ends<=now() THEN RAISE EXCEPTION 'Update expired membership dates before reactivation.'; END IF;
 END IF;
 UPDATE public.staff_memberships SET role=next_role,committee_seat=next_seat,member_number=next_number,starts_at=starts,ends_at=ends,active=next_active,title=CASE WHEN p_action='edit' THEN coalesce(p_payload->>'title','') ELSE title END,revision=revision+1 WHERE id=m.id;
 IF next_role IS DISTINCT FROM m.role THEN UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}',to_jsonb(next_role)) WHERE id=u.id; END IF;
 result:=jsonb_build_object('id',m.id,'revision',m.revision+1);
 INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,state,auth_user_id,membership_id,result)
 VALUES(p_request_id,'membership',auth.uid(),u.email,p_payload,fingerprint,'complete',u.id,m.id,result);
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'committee-membership-'||p_action,m.id::text,'success',jsonb_build_object('reason',p_payload->>'reason','oldRole',m.role,'newRole',next_role,'oldSeat',m.committee_seat,'newSeat',next_seat,'oldMemberNumber',m.member_number,'newMemberNumber',next_number,'active',next_active,'requestId',p_request_id));
 RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.committee_begin_link(p_id uuid, p_revision integer, p_request_id uuid, p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT m FROM public.staff_memberships WHERE id=p_id FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'actor',auth.uid())::text,'UTF8')),'hex');
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.kind<>'link' OR r.actor_id<>auth.uid() OR r.request_hash<>fingerprint THEN RAISE EXCEPTION 'This link request reference was already used.' USING ERRCODE='40001'; END IF;
  IF r.state='complete' THEN RETURN jsonb_build_object('complete',true); END IF;
  IF r.lease_until>now() THEN RAISE EXCEPTION 'A setup link is being processed. Wait a minute before retrying.' USING ERRCODE='55P03'; END IF;
 ELSE
  IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Membership changed. Refresh first.' USING ERRCODE='40001'; END IF;
  IF m.last_invite_at>now()-interval '60 seconds' THEN RAISE EXCEPTION 'Wait a minute before requesting another setup link.' USING ERRCODE='55P03'; END IF;
 END IF;
 IF NOT m.active OR m.ends_at<=now() THEN RAISE EXCEPTION 'Activate a current eligible membership before sending a setup link.'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id;
 IF u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'The committee account could not be verified.'; END IF;
 IF r.id IS NULL THEN INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,auth_user_id,membership_id) VALUES(p_request_id,'link',auth.uid(),u.email,'{}',fingerprint,u.id,m.id); END IF;
 UPDATE public.committee_account_requests SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds',error=null WHERE id=p_request_id;
 UPDATE public.staff_memberships SET last_invite_at=clock_timestamp(),revision=revision+1 WHERE id=m.id;
 RETURN jsonb_build_object('complete',false,'userId',u.id,'email',u.email,'confirmed',u.email_confirmed_at IS NOT NULL);
END;
$function$;

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
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id)
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

CREATE OR REPLACE FUNCTION public.committee_membership_eligible(p_id uuid, p_allow_setup boolean DEFAULT false, p_allow_future boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.id=p_id AND m.auth_user_id=auth.uid() AND m.active
  AND (p_allow_future OR m.starts_at<=now()) AND (m.ends_at IS NULL OR m.ends_at>now())
  AND (p_allow_setup OR m.setup_completed_at IS NOT NULL)
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
  AND (m.role='crecom_member' OR (m.role='bod_member' AND m.committee_seat='chairperson'))
  AND NOT EXISTS(SELECT 1 FROM public.members b WHERE b.user_id=u.id));
$function$;

CREATE OR REPLACE FUNCTION public.committee_accounts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'email'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('id',m.id,'requestId',m.invitation_request_id,'userId',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'email',u.email,'role',m.role,'committeeSeat',m.committee_seat,'committeeMemberNumber',m.member_number,'title',m.title,'startsAt',m.starts_at,'endsAt',m.ends_at,'active',m.active,'revision',m.revision,'setupCompletedAt',m.setup_completed_at,
   'status',CASE WHEN NOT m.active THEN 'inactive' WHEN m.ends_at<=now() THEN 'expired' WHEN m.setup_completed_at IS NULL THEN 'invited' WHEN m.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'lastSignInAt',u.last_sign_in_at,'assignedCount',(SELECT count(*) FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE a.membership_id=m.id AND c.status='open' AND a.state IN ('assigned','awaiting_clarification')),
   'lastInviteAt',m.last_invite_at,'error',null) AS row FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  UNION ALL
  SELECT jsonb_build_object('id',r.id,'requestId',r.id,'creationMode',coalesce(r.payload->>'provisioningMode','invite'),'userId',r.auth_user_id,'name',r.payload->>'name','email',r.email,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','committeeMemberNumber',(r.payload->>'committeeMemberNumber')::smallint,'title',r.payload->>'title',
   'startsAt',r.payload->>'startsAt','endsAt',r.payload->>'endsAt','active',false,'revision',0,'setupCompletedAt',null,
   'status',CASE WHEN r.state='failed' THEN 'failed' ELSE 'provisioning' END,'lastSignInAt',null,'assignedCount',0,'lastInviteAt',r.created_at,'error',r.error)
   FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state<>'complete'
 )records;
 RETURN jsonb_build_object('accounts',rows,'bodEnabled',public.committee_bod_enabled());
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_session_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u auth.users%ROWTYPE; m public.staff_memberships%ROWTYPE; portal_role_value text; eligible boolean;
BEGIN
 SELECT * INTO u FROM auth.users WHERE id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Sign in to continue.' USING ERRCODE='42501'; END IF;
 portal_role_value:=u.raw_app_meta_data->>'role';
 IF portal_role_value IN ('super_admin','admin','coop_admin') THEN
  RETURN jsonb_build_object('allowed',public.document_staff_access(),'role',CASE WHEN portal_role_value='super_admin' THEN portal_role_value ELSE 'admin' END,'setupRequired',false,'reason',CASE WHEN public.document_staff_access() THEN NULL ELSE 'This account is inactive.' END,'membershipId',null,'name',public.document_actor_label(),'email',u.email);
 END IF;
 IF portal_role_value NOT IN ('crecom_member','bod_member') OR portal_role_value IS NULL THEN
  RETURN jsonb_build_object('allowed',false,'role',null,'setupRequired',false,'reason','This account does not have administrative or committee access.','membershipId',null,'name','','email','');
 END IF;
 SELECT * INTO m FROM public.staff_memberships WHERE auth_user_id=u.id AND staff_memberships.role=portal_role_value ORDER BY active DESC,starts_at DESC,id LIMIT 1;
 eligible:=public.committee_membership_eligible(m.id);
 RETURN jsonb_build_object('allowed',eligible,'role',portal_role_value,'reviewEnabled',portal_role_value<>'bod_member' OR public.committee_bod_enabled(),'setupRequired',m.setup_completed_at IS NULL AND public.committee_membership_eligible(m.id,true,true),
  'reason',CASE WHEN eligible THEN NULL
    WHEN m.active AND m.starts_at>now() THEN 'Your committee membership has not started yet.'
    ELSE 'Your committee membership is inactive, expired, or not available.' END,
  'membershipId',m.id,'committeeSeat',m.committee_seat,'committeeMemberNumber',m.member_number,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'email',u.email,'startsAt',m.starts_at,'endsAt',m.ends_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.committee_assignment_eligible(p_assignment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 JOIN public.staff_memberships m ON m.id=a.membership_id WHERE a.id=p_assignment_id AND a.reviewer_auth_id=auth.uid()
 AND m.auth_user_id=a.reviewer_auth_id AND public.committee_membership_eligible(m.id)
 AND (m.role<>'bod_member' OR public.committee_bod_enabled())
 AND a.signatory_role=CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='member' THEN 'crecom_member' END
 AND (a.member_number IS NULL OR a.member_number IS NOT DISTINCT FROM m.member_number)
 AND m.role=CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
 AND a.state NOT IN ('cancelled','reassigned') AND c.status IN ('open','completed'));
$function$;
NOTIFY pgrst,'reload schema';

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

ROLLBACK;
