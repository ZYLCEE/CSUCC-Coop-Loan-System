-- Phase 2: named committee accounts and scoped read access. No votes or forwarding.
BEGIN;
ALTER TABLE public.staff_memberships ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz,
 ADD COLUMN IF NOT EXISTS invitation_request_id uuid,ADD COLUMN IF NOT EXISTS last_invite_at timestamptz;
CREATE TABLE IF NOT EXISTS public.committee_account_requests(
 id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('invite','link','membership')),actor_id uuid NOT NULL REFERENCES auth.users(id),
 email text NOT NULL,payload jsonb NOT NULL,request_hash text NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','failed')),
 auth_user_id uuid REFERENCES auth.users(id),membership_id uuid REFERENCES public.staff_memberships(id),
 attempt_id uuid,lease_until timestamptz,error text,result jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS committee_unique_invite_email ON public.committee_account_requests(lower(email)) WHERE kind='invite';
ALTER TABLE public.staff_memberships DROP CONSTRAINT IF EXISTS staff_membership_invitation_fk;
ALTER TABLE public.staff_memberships ADD CONSTRAINT staff_membership_invitation_fk FOREIGN KEY(invitation_request_id) REFERENCES public.committee_account_requests(id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_membership_invitation_unique ON public.staff_memberships(invitation_request_id) WHERE invitation_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.application_review_cycles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES public.loan_applications(id),
 cycle_no integer NOT NULL CHECK(cycle_no>0),stage text NOT NULL CHECK(stage IN ('CRECOM','BOD')),packet_version integer NOT NULL CHECK(packet_version>0),
 packet_snapshot jsonb NOT NULL CHECK(jsonb_typeof(packet_snapshot)='object'),policy_id uuid NOT NULL REFERENCES public.approval_workflow_policies(id),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','superseded')),
 created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(application_id,cycle_no,stage)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_committee_stage ON public.application_review_cycles(application_id,stage) WHERE status='open';
CREATE TABLE IF NOT EXISTS public.review_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_cycle_id uuid NOT NULL REFERENCES public.application_review_cycles(id),
 reviewer_auth_id uuid NOT NULL REFERENCES auth.users(id),membership_id uuid NOT NULL REFERENCES public.staff_memberships(id),
 state text NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','decision_recorded','awaiting_clarification','recused','cancelled','reassigned')),
 assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),due_at timestamptz,UNIQUE(review_cycle_id,reviewer_auth_id),UNIQUE(id,reviewer_auth_id)
);
CREATE INDEX IF NOT EXISTS review_assignment_recipient_idx ON public.review_assignments(reviewer_auth_id,review_cycle_id);
CREATE TABLE IF NOT EXISTS public.individual_review_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL UNIQUE REFERENCES public.review_assignments(id),
 reviewer_auth_id uuid NOT NULL REFERENCES auth.users(id),packet_version integer NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approve','reject')),reason text CHECK(length(reason)<=2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(assignment_id,reviewer_auth_id) REFERENCES public.review_assignments(id,reviewer_auth_id)
);
CREATE TABLE IF NOT EXISTS public.committee_notification_links(
 notification_id uuid PRIMARY KEY REFERENCES public.notifications(id),assignment_id uuid NOT NULL REFERENCES public.review_assignments(id)
);
CREATE OR REPLACE FUNCTION public.committee_decision_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$BEGIN RAISE EXCEPTION 'Committee decision history is immutable. Use a new authorized review cycle.' USING ERRCODE='42501'; END$$;
DROP TRIGGER IF EXISTS committee_decision_immutable ON public.individual_review_decisions;
CREATE TRIGGER committee_decision_immutable BEFORE UPDATE OR DELETE ON public.individual_review_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_decision_immutable();

CREATE OR REPLACE FUNCTION public.committee_identity()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND raw_app_meta_data->>'role' IN ('crecom_member','bod_member'));
$$;
CREATE OR REPLACE FUNCTION public.committee_bod_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT config->>'bodMode' IN ('conditional','required') FROM public.approval_workflow_policies
 WHERE status='approved' AND effective_at<=now() ORDER BY version DESC LIMIT 1),false);
$$;
CREATE OR REPLACE FUNCTION public.committee_membership_eligible(p_id uuid,p_allow_setup boolean DEFAULT false,p_allow_future boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  WHERE m.id=p_id AND m.auth_user_id=auth.uid() AND m.active
  AND (p_allow_future OR m.starts_at<=now()) AND (m.ends_at IS NULL OR m.ends_at>now())
  AND (p_allow_setup OR m.setup_completed_at IS NOT NULL)
  AND u.raw_app_meta_data->>'role'=m.role AND coalesce(u.raw_app_meta_data->>'account_status','active')='active'
  AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL
  AND (m.role='crecom_member' OR public.committee_bod_enabled())
  AND NOT EXISTS(SELECT 1 FROM public.members b WHERE b.user_id=u.id));
$$;
CREATE OR REPLACE FUNCTION public.portal_session_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
 RETURN jsonb_build_object('allowed',eligible,'role',portal_role_value,'setupRequired',m.setup_completed_at IS NULL AND public.committee_membership_eligible(m.id,true,true),
  'reason',CASE WHEN eligible THEN NULL WHEN portal_role_value='bod_member' AND NOT public.committee_bod_enabled() THEN 'BOD access is not enabled by an approved workflow policy.'
    WHEN m.active AND m.starts_at>now() THEN 'Your committee membership has not started yet.'
    ELSE 'Your committee membership is inactive, expired, or not available.' END,
  'membershipId',m.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),'email',u.email,'startsAt',m.starts_at,'endsAt',m.ends_at);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_assignment_eligible(p_assignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 JOIN public.staff_memberships m ON m.id=a.membership_id WHERE a.id=p_assignment_id AND a.reviewer_auth_id=auth.uid()
 AND m.auth_user_id=a.reviewer_auth_id AND public.committee_membership_eligible(m.id)
 AND m.role=CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END
 AND a.state NOT IN ('cancelled','reassigned') AND c.status IN ('open','completed'));
$$;

ALTER TABLE public.committee_account_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.individual_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committee_notification_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_account_requests,public.application_review_cycles,public.review_assignments,public.individual_review_decisions,public.committee_notification_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.application_review_cycles,public.review_assignments,public.individual_review_decisions TO authenticated;
GRANT ALL ON public.committee_account_requests,public.application_review_cycles,public.review_assignments,public.individual_review_decisions,public.committee_notification_links TO service_role;
DROP POLICY IF EXISTS "Scoped committee assignments" ON public.review_assignments;
CREATE POLICY "Scoped committee assignments" ON public.review_assignments FOR SELECT TO authenticated USING(public.document_staff_access() OR public.committee_assignment_eligible(id));
DROP POLICY IF EXISTS "Scoped committee cycles" ON public.application_review_cycles;
CREATE POLICY "Scoped committee cycles" ON public.application_review_cycles FOR SELECT TO authenticated USING(public.document_staff_access() OR EXISTS(SELECT 1 FROM public.review_assignments a WHERE a.review_cycle_id=application_review_cycles.id AND public.committee_assignment_eligible(a.id)));
DROP POLICY IF EXISTS "Own committee decision history" ON public.individual_review_decisions;
CREATE POLICY "Own committee decision history" ON public.individual_review_decisions FOR SELECT TO authenticated USING(public.document_staff_access() OR (reviewer_auth_id=auth.uid() AND public.committee_assignment_eligible(assignment_id)));
-- Legacy administrative/member tables remain unavailable to committee identities.
DO $$DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['members','loan_applications','loan_documents','loan_document_versions','loan_document_reviews','loan_payments','admin_activity_logs','shared_documents','shared_document_recipients','approval_workflow_policies','application_verifications','application_consent_evidence','application_workflow_events'] LOOP
  IF to_regclass('public.'||table_name) IS NOT NULL THEN
   EXECUTE format('DROP POLICY IF EXISTS committee_legacy_boundary ON public.%I',table_name);
   EXECUTE format('CREATE POLICY committee_legacy_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(NOT public.committee_identity()) WITH CHECK(NOT public.committee_identity())',table_name);
  END IF;
 END LOOP;
END$$;
DROP POLICY IF EXISTS committee_inbox_boundary ON public.notifications;
CREATE POLICY committee_inbox_boundary ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated
 USING(NOT public.committee_identity() OR (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.staff_memberships m WHERE m.auth_user_id=auth.uid() AND public.committee_membership_eligible(m.id))))
 WITH CHECK(NOT public.committee_identity() OR (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.staff_memberships m WHERE m.auth_user_id=auth.uid() AND public.committee_membership_eligible(m.id))));

CREATE OR REPLACE FUNCTION public.committee_accounts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin'
  THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'email'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('id',m.id,'requestId',m.invitation_request_id,'userId',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'email',u.email,'role',m.role,'title',m.title,'startsAt',m.starts_at,'endsAt',m.ends_at,'active',m.active,'revision',m.revision,'setupCompletedAt',m.setup_completed_at,
   'status',CASE WHEN NOT m.active THEN 'inactive' WHEN m.ends_at<=now() THEN 'expired' WHEN m.role='bod_member' AND NOT public.committee_bod_enabled() THEN 'policy_disabled' WHEN m.setup_completed_at IS NULL THEN 'invited' WHEN m.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'lastSignInAt',u.last_sign_in_at,'assignedCount',(SELECT count(*) FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE a.membership_id=m.id AND c.status='open' AND a.state IN ('assigned','awaiting_clarification')),
   'lastInviteAt',m.last_invite_at,'error',null) AS row FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  UNION ALL
  SELECT jsonb_build_object('id',r.id,'requestId',r.id,'userId',r.auth_user_id,'name',r.payload->>'name','email',r.email,'role',r.payload->>'role','title',r.payload->>'title',
   'startsAt',r.payload->>'startsAt','endsAt',r.payload->>'endsAt','active',false,'revision',0,'setupCompletedAt',null,
   'status',CASE WHEN r.state='failed' THEN 'failed' ELSE 'provisioning' END,'lastSignInAt',null,'assignedCount',0,'lastInviteAt',r.created_at,'error',r.error)
   FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state<>'complete'
 )records;
 RETURN jsonb_build_object('accounts',rows,'bodEnabled',public.committee_bod_enabled());
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_account_assignments(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'stage',c.stage,'cycle',c.cycle_no,'state',a.state,'assignedAt',a.assigned_at,'dueAt',a.due_at,
  'needsReassignment',c.status='open' AND a.state IN ('assigned','awaiting_clarification') AND
    (NOT m.active OR m.starts_at>now() OR m.ends_at<=now() OR m.role<>CASE WHEN c.stage='CRECOM' THEN 'crecom_member' ELSE 'bod_member' END))
  ORDER BY a.assigned_at DESC),'[]') INTO rows FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
  JOIN public.staff_memberships m ON m.id=a.membership_id WHERE m.id=p_id;
 RETURN rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_reserve_invite(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.committee_account_requests%ROWTYPE; existing auth.users%ROWTYPE; fingerprint text; invite_email text:=lower(btrim(p_payload->>'email')); start_date timestamptz; end_date timestamptz;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_attempt_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
  OR length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 OR length(coalesce(invite_email,'')) NOT BETWEEN 3 AND 254 OR invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  OR coalesce(p_payload->>'role','') NOT IN ('crecom_member','bod_member') OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Enter valid committee account details.'; END IF;
 IF p_payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD membership requires an approved policy enabling the BOD stage.'; END IF;
 start_date:=(p_payload->>'startsAt')::timestamptz;end_date:=(p_payload->>'endsAt')::timestamptz;
 IF start_date IS NULL OR (end_date IS NOT NULL AND end_date<=start_date) THEN RAISE EXCEPTION 'Choose valid membership dates.'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'payload',p_payload)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('committee-invite:'||invite_email,0));
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.kind<>'invite' OR r.actor_id<>auth.uid() OR r.request_hash<>fingerprint THEN RAISE EXCEPTION 'This invitation reference was already used.' USING ERRCODE='40001'; END IF;
  IF r.state='complete' THEN RETURN jsonb_build_object('complete',true,'membershipId',r.membership_id); END IF;
  IF r.lease_until>now() THEN RAISE EXCEPTION 'Invitation processing is still pending. Wait a minute and retry.' USING ERRCODE='55P03'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.committee_account_requests q WHERE q.kind='invite' AND lower(q.email)=invite_email) THEN RAISE EXCEPTION 'This email already has a committee invitation. Use its Retry or Send setup link action.' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=invite_email) THEN RAISE EXCEPTION 'This email is already registered. Existing member or staff accounts cannot be converted through an invitation.'; END IF;
  INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash) VALUES(p_request_id,'invite',auth.uid(),invite_email,p_payload,fingerprint) RETURNING * INTO r;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-request',p_request_id::text,'success',jsonb_build_object('role',p_payload->>'role','email',invite_email));
 END IF;
 SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;
 IF FOUND AND (existing.invited_at IS NULL OR (existing.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text
  AND (existing.raw_app_meta_data->>'role' IS NOT NULL OR existing.raw_user_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM p_request_id::text))
  OR EXISTS(SELECT 1 FROM public.members m WHERE m.user_id=existing.id)) THEN RAISE EXCEPTION 'The existing account does not match this invitation. Contact the system administrator.'; END IF;
 UPDATE public.committee_account_requests SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds',error=null,auth_user_id=existing.id WHERE id=r.id;
 RETURN jsonb_build_object('complete',false,'authUserId',existing.id,'payload',r.payload);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_finish_invite(p_request_id uuid,p_attempt_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.committee_account_requests%ROWTYPE; u auth.users%ROWTYPE; membership uuid;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request_id AND kind='invite' FOR UPDATE;
 IF r.actor_id<>auth.uid() THEN RAISE EXCEPTION 'This invitation belongs to another administrator.' USING ERRCODE='42501'; END IF;
 IF r.state='complete' THEN RETURN r.result; END IF;
 IF r.attempt_id IS DISTINCT FROM p_attempt_id OR r.lease_until<=now() THEN RAISE EXCEPTION 'Invitation processing changed. Retry the saved request.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 IF lower(u.email)<>lower(r.email) OR u.invited_at IS NULL OR u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role'
  OR u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id)
  THEN RAISE EXCEPTION 'The invited account could not be verified.'; END IF;
 IF r.payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD access is not enabled.'; END IF;
 INSERT INTO public.staff_memberships(auth_user_id,role,active,starts_at,ends_at,assigned_by,title,invitation_request_id,last_invite_at)
 VALUES(u.id,r.payload->>'role',true,(r.payload->>'startsAt')::timestamptz,(r.payload->>'endsAt')::timestamptz,auth.uid(),coalesce(r.payload->>'title',''),r.id,clock_timestamp()) RETURNING id INTO membership;
 UPDATE public.committee_account_requests SET state='complete',auth_user_id=u.id,membership_id=membership,result=jsonb_build_object('membershipId',membership),lease_until=null WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-complete',membership::text,'success',jsonb_build_object('requestId',r.id,'role',r.payload->>'role'));
 RETURN jsonb_build_object('membershipId',membership);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_request_failed(p_request_id uuid,p_attempt_id uuid,p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 UPDATE public.committee_account_requests SET state='failed',error=left(p_message,500),lease_until=null WHERE id=p_request_id AND actor_id=auth.uid() AND attempt_id=p_attempt_id AND state<>'complete';
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_change_membership(p_id uuid,p_revision integer,p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text; next_role text; starts timestamptz; ends timestamptz; next_active boolean; result jsonb;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_action IS NULL OR p_action NOT IN ('edit','deactivate','reactivate') OR p_payload IS NULL
  OR length(btrim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Enter a reason for this membership change.'; END IF;
 SELECT * INTO STRICT m FROM public.staff_memberships WHERE id=p_id FOR UPDATE;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'action',p_action,'payload',p_payload,'actor',auth.uid())::text,'UTF8')),'hex');
 SELECT * INTO r FROM public.committee_account_requests WHERE id=p_request_id;
 IF FOUND THEN IF r.request_hash=fingerprint AND r.actor_id=auth.uid() AND r.kind='membership' THEN RETURN r.result; END IF; RAISE EXCEPTION 'This request reference was already used.' USING ERRCODE='40001'; END IF;
 IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Membership changed. Reload before saving.' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id FOR UPDATE;
 IF u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'This account requires manual membership reconciliation.'; END IF;
 next_role:=m.role;starts:=m.starts_at;ends:=m.ends_at;next_active:=m.active;
 IF p_action='edit' THEN
  next_role:=p_payload->>'role';starts:=(p_payload->>'startsAt')::timestamptz;ends:=(p_payload->>'endsAt')::timestamptz;
  IF next_role IS NULL OR next_role NOT IN ('crecom_member','bod_member') OR starts IS NULL OR ends<=starts OR length(coalesce(p_payload->>'title',''))>100 THEN RAISE EXCEPTION 'Choose valid membership details.'; END IF;
 ELSIF p_action='deactivate' THEN next_active:=false;
 ELSE next_active:=true; IF ends<=now() THEN RAISE EXCEPTION 'Update expired membership dates before reactivation.'; END IF;
 END IF;
 IF next_role='bod_member' AND next_active AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'An approved policy must enable BOD access first.'; END IF;
 UPDATE public.staff_memberships SET role=next_role,starts_at=starts,ends_at=ends,active=next_active,title=CASE WHEN p_action='edit' THEN coalesce(p_payload->>'title','') ELSE title END,revision=revision+1 WHERE id=m.id;
 IF next_role IS DISTINCT FROM m.role THEN UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{role}',to_jsonb(next_role)) WHERE id=u.id; END IF;
 result:=jsonb_build_object('id',m.id,'revision',m.revision+1);
 INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,state,auth_user_id,membership_id,result)
 VALUES(p_request_id,'membership',auth.uid(),u.email,p_payload,fingerprint,'complete',u.id,m.id,result);
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),'committee-membership-'||p_action,m.id::text,'success',jsonb_build_object('reason',p_payload->>'reason','oldRole',m.role,'newRole',next_role,'active',next_active,'requestId',p_request_id));
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_begin_link(p_id uuid,p_revision integer,p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE; r public.committee_account_requests%ROWTYPE; fingerprint text;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
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
 IF NOT m.active OR m.ends_at<=now() OR (m.role='bod_member' AND NOT public.committee_bod_enabled()) THEN RAISE EXCEPTION 'Activate a current eligible membership before sending a setup link.'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id;
 IF u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'The committee account could not be verified.'; END IF;
 IF r.id IS NULL THEN INSERT INTO public.committee_account_requests(id,kind,actor_id,email,payload,request_hash,auth_user_id,membership_id) VALUES(p_request_id,'link',auth.uid(),u.email,'{}',fingerprint,u.id,m.id); END IF;
 UPDATE public.committee_account_requests SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds',error=null WHERE id=p_request_id;
 UPDATE public.staff_memberships SET last_invite_at=clock_timestamp(),revision=revision+1 WHERE id=m.id;
 RETURN jsonb_build_object('complete',false,'userId',u.id,'email',u.email,'confirmed',u.email_confirmed_at IS NOT NULL);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_finish_link(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.committee_account_requests%ROWTYPE;
BEGIN
 IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request_id AND kind='link' FOR UPDATE;
 IF r.actor_id<>auth.uid() OR r.attempt_id IS DISTINCT FROM p_attempt_id THEN RAISE EXCEPTION 'This setup link request changed.' USING ERRCODE='40001'; END IF;
 IF r.state='complete' THEN RETURN jsonb_build_object('success',true); END IF;
 UPDATE public.committee_account_requests SET state='complete',lease_until=null,result='{"success":true}' WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-setup-link',r.membership_id::text,'success',jsonb_build_object('requestId',r.id));
 RETURN jsonb_build_object('success',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_complete_setup(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 SELECT * INTO m FROM public.staff_memberships WHERE auth_user_id=u.id AND role=u.raw_app_meta_data->>'role' ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;
 IF m.id IS NULL OR NOT m.active OR m.ends_at<=now() OR u.email_confirmed_at IS NULL
  OR coalesce(u.raw_app_meta_data->>'account_status','active')<>'active' OR u.banned_until>now()
  OR (m.role='bod_member' AND NOT public.committee_bod_enabled()) OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id)
  OR u.invited_at IS NULL OR length(coalesce(u.encrypted_password,''))=0 THEN RAISE EXCEPTION 'Complete a valid account invitation and password setup first.' USING ERRCODE='42501'; END IF;
 IF m.setup_completed_at IS NULL THEN
  UPDATE public.staff_memberships SET setup_completed_at=clock_timestamp(),revision=revision+1 WHERE id=m.id;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(u.id,'committee-own-setup',m.id::text,'success','{}');
 END IF;
 RETURN jsonb_build_object('success',true);
END;
$$;
-- Only the server may invoke membership mutations, after verifying the
-- Super Admin's current password. A browser session alone cannot bypass that step.
CREATE OR REPLACE FUNCTION public.committee_account_action(p_actor_id uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true); result jsonb;
BEGIN
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_id AND raw_app_meta_data->>'role'='super_admin') THEN
  RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE='42501';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF p_operation='committee_reserve_invite' THEN
  result:=public.committee_reserve_invite((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid,p_args->'p_payload');
 ELSIF p_operation='committee_finish_invite' THEN
  result:=public.committee_finish_invite((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid,(p_args->>'p_user_id')::uuid);
 ELSIF p_operation='committee_request_failed' THEN
  PERFORM public.committee_request_failed((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid,p_args->>'p_message');
  result:='{}';
 ELSIF p_operation='committee_change_membership' THEN
  result:=public.committee_change_membership((p_args->>'p_id')::uuid,(p_args->>'p_revision')::integer,p_args->>'p_action',p_args->'p_payload',(p_args->>'p_request_id')::uuid);
 ELSIF p_operation='committee_begin_link' THEN
  result:=public.committee_begin_link((p_args->>'p_id')::uuid,(p_args->>'p_revision')::integer,(p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid);
 ELSIF p_operation='committee_finish_link' THEN
  result:=public.committee_finish_link((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid);
 ELSE RAISE EXCEPTION 'Unknown committee account operation.';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 RAISE;
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_self_activity(p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() OR p_action IS NULL OR p_action NOT IN ('profile','password') THEN RAISE EXCEPTION 'Active committee access is required.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-own-'||p_action,auth.uid()::text,'success','{}');
END;
$$;

CREATE OR REPLACE FUNCTION public.committee_workspace()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE assignments jsonb; history jsonb; access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() THEN RAISE EXCEPTION 'Active committee membership is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'applicant',c.packet_snapshot->'summary'->>'applicant','memberNumber',c.packet_snapshot->'summary'->>'memberNumber','loanType',c.packet_snapshot->'summary'->>'loanType',
  'amount',(c.packet_snapshot->'summary'->>'amount')::numeric,'stage',c.stage,'cycle',c.cycle_no,'packetVersion',c.packet_version,'assignedAt',a.assigned_at,'dueAt',a.due_at,'state',a.state,
  'responded',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state='decision_recorded'),
  'assigned',(SELECT count(*) FROM public.review_assignments x WHERE x.review_cycle_id=c.id AND x.state NOT IN ('cancelled','reassigned'))) ORDER BY a.assigned_at DESC),'[]')
 INTO assignments FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE public.committee_assignment_eligible(a.id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'assignmentId',d.assignment_id,'applicationId',c.packet_snapshot->'summary'->>'applicationId',
  'cycle',c.cycle_no,'packetVersion',d.packet_version,'decision',d.decision,'reason',d.reason,'createdAt',d.created_at) ORDER BY d.created_at DESC),'[]')
 INTO history FROM public.individual_review_decisions d JOIN public.review_assignments a ON a.id=d.assignment_id JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 WHERE d.reviewer_auth_id=auth.uid() AND public.committee_assignment_eligible(a.id);
 RETURN jsonb_build_object('assignments',assignments,'history',history,'counts',jsonb_build_object('assigned',jsonb_array_length(assignments),
  'pending',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='assigned'),
  'waiting',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='decision_recorded' AND (x->>'responded')::integer<(x->>'assigned')::integer),
  'clarification',(SELECT count(*) FROM jsonb_array_elements(assignments) x WHERE x->>'state'='awaiting_clarification'),'completed',jsonb_array_length(history)));
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_review_packet(p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; assignment jsonb; documents jsonb;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned case.' USING ERRCODE='42501'; END IF;
 SELECT c1.* INTO STRICT c FROM public.review_assignments a JOIN public.application_review_cycles c1 ON c1.id=a.review_cycle_id WHERE a.id=p_assignment_id;
 SELECT x INTO assignment FROM jsonb_array_elements(public.committee_workspace()->'assignments') x WHERE x->>'id'=p_assignment_id::text;
 SELECT coalesce(jsonb_agg(jsonb_build_object('documentId',x->>'documentId','versionId',x->>'versionId','kind',x->>'kind','name',x->>'name')),'[]') INTO documents FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]')) x;
 RETURN jsonb_build_object('assignment',assignment,'summary',c.packet_snapshot->'summary','findings',coalesce(c.packet_snapshot->>'staffFindings',''),
  'consentSummary',coalesce(c.packet_snapshot->>'consentSummary',''),'documents',documents);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_document_location(p_assignment_id uuid,p_document_id uuid,p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.application_review_cycles%ROWTYPE; d public.loan_documents%ROWTYPE; v public.loan_document_versions%ROWTYPE;
BEGIN
 IF NOT public.committee_assignment_eligible(p_assignment_id) THEN RAISE EXCEPTION 'Access is no longer available for this assigned document.' USING ERRCODE='42501'; END IF;
 SELECT c1.* INTO STRICT c FROM public.review_assignments a JOIN public.application_review_cycles c1 ON c1.id=a.review_cycle_id WHERE a.id=p_assignment_id;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]')) x WHERE x->>'documentId'=p_document_id::text AND (x->>'versionId')::uuid IS NOT DISTINCT FROM p_version_id) THEN RAISE EXCEPTION 'This file version is not part of your assigned packet.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT d FROM public.loan_documents WHERE id=p_document_id AND loan_application_id=c.application_id;
 IF p_version_id IS NULL THEN RETURN jsonb_build_object('path',d.storage_path,'name',d.original_name,'contentType',d.content_type); END IF;
 SELECT * INTO STRICT v FROM public.loan_document_versions WHERE id=p_version_id AND document_id=d.id;
 RETURN jsonb_build_object('path',v.storage_path,'name',v.original_name,'contentType',v.content_type);
END;
$$;
CREATE OR REPLACE FUNCTION public.committee_can_read_loan_object(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.packet_snapshot->'documents','[]')) x
 JOIN public.loan_documents d ON d.id=(x->>'documentId')::uuid AND d.loan_application_id=c.application_id
 LEFT JOIN public.loan_document_versions v ON v.id=(x->>'versionId')::uuid AND v.document_id=d.id
 WHERE public.committee_assignment_eligible(a.id)
 AND (CASE WHEN x->>'versionId' IS NULL THEN d.storage_path ELSE v.storage_path END)=p_name);
$$;
DROP POLICY IF EXISTS "Scoped committee packet files" ON storage.objects;
CREATE POLICY "Scoped committee packet files" ON storage.objects FOR SELECT TO authenticated USING(bucket_id='loan-documents' AND public.committee_can_read_loan_object(name));
DROP POLICY IF EXISTS committee_storage_read_boundary ON storage.objects;
CREATE POLICY committee_storage_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(NOT public.committee_identity() OR (bucket_id='loan-documents' AND public.committee_can_read_loan_object(name)));
DROP POLICY IF EXISTS committee_storage_insert_boundary ON storage.objects;
CREATE POLICY committee_storage_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(NOT public.committee_identity());
DROP POLICY IF EXISTS committee_storage_update_boundary ON storage.objects;
CREATE POLICY committee_storage_update_boundary ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING(NOT public.committee_identity()) WITH CHECK(NOT public.committee_identity());
DROP POLICY IF EXISTS committee_storage_delete_boundary ON storage.objects;
CREATE POLICY committee_storage_delete_boundary ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(NOT public.committee_identity());

CREATE OR REPLACE FUNCTION public.committee_inbox(p_read_id uuid DEFAULT NULL,p_all boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb; access jsonb;
BEGIN
 access:=public.portal_session_access();
 IF NOT coalesce((access->>'allowed')::boolean,false) OR NOT public.committee_identity() THEN RAISE EXCEPTION 'Active committee access is required.' USING ERRCODE='42501'; END IF;
 IF p_all THEN UPDATE public.notifications SET read=true WHERE user_id=auth.uid() AND read=false;
 ELSIF p_read_id IS NOT NULL THEN UPDATE public.notifications SET read=true WHERE user_id=auth.uid() AND id=p_read_id; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'message',n.message,'read',n.read,'createdAt',n.created_at,'assignmentId',l.assignment_id,
  'accessAvailable',CASE WHEN l.assignment_id IS NULL THEN false ELSE public.committee_assignment_eligible(l.assignment_id) END) ORDER BY n.created_at DESC,n.id DESC),'[]') INTO rows
 FROM public.notifications n LEFT JOIN public.committee_notification_links l ON l.notification_id=n.id WHERE n.user_id=auth.uid();
 RETURN rows;
END;
$$;

REVOKE ALL ON FUNCTION public.committee_identity(),public.committee_bod_enabled(),public.committee_membership_eligible(uuid,boolean,boolean),
 public.committee_account_assignments(uuid),public.committee_self_activity(text),
 public.portal_session_access(),public.committee_assignment_eligible(uuid),public.committee_accounts(),public.committee_reserve_invite(uuid,uuid,jsonb),
 public.committee_finish_invite(uuid,uuid,uuid),public.committee_request_failed(uuid,uuid,text),public.committee_change_membership(uuid,integer,text,jsonb,uuid),
 public.committee_begin_link(uuid,integer,uuid,uuid),public.committee_finish_link(uuid,uuid),
 public.committee_workspace(),public.committee_review_packet(uuid),public.committee_document_location(uuid,uuid,uuid),public.committee_can_read_loan_object(text),public.committee_inbox(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.committee_identity(),public.committee_bod_enabled(),public.committee_membership_eligible(uuid,boolean,boolean),
 public.committee_account_assignments(uuid),public.committee_self_activity(text),
 public.portal_session_access(),public.committee_assignment_eligible(uuid),public.committee_accounts(),public.committee_reserve_invite(uuid,uuid,jsonb),
 public.committee_finish_invite(uuid,uuid,uuid),public.committee_request_failed(uuid,uuid,text),public.committee_change_membership(uuid,integer,text,jsonb,uuid),
 public.committee_begin_link(uuid,integer,uuid,uuid),public.committee_finish_link(uuid,uuid),
 public.committee_workspace(),public.committee_review_packet(uuid),public.committee_document_location(uuid,uuid,uuid),public.committee_can_read_loan_object(text),public.committee_inbox(uuid,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.committee_complete_setup(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.committee_complete_setup(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.committee_reserve_invite(uuid,uuid,jsonb),public.committee_finish_invite(uuid,uuid,uuid),
 public.committee_request_failed(uuid,uuid,text),public.committee_change_membership(uuid,integer,text,jsonb,uuid),
 public.committee_begin_link(uuid,integer,uuid,uuid),public.committee_finish_link(uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.committee_account_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.committee_account_action(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.committee_decision_immutable() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
