BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.committee_account_number_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
ALTER TABLE public.staff_memberships ADD COLUMN IF NOT EXISTS account_number text;
ALTER TABLE public.committee_account_requests ADD COLUMN IF NOT EXISTS account_number text;

-- Give every existing account request a permanent ID in its original creation
-- order. Completed memberships inherit the request ID; legacy memberships
-- without a request receive the next numbers in membership creation order.
WITH base AS (
  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0) AS number
  FROM (
    SELECT member_id AS account_number FROM public.members
    UNION ALL SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite'
    UNION ALL SELECT account_number FROM public.staff_memberships
  ) current_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$'
), numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS number
  FROM public.committee_account_requests
  WHERE kind = 'invite' AND account_number IS NULL
)
UPDATE public.committee_account_requests request
SET account_number = 'CSUCC-2026-' || lpad((base.number + numbered.number)::text, 4, '0')
FROM numbered CROSS JOIN base
WHERE request.id = numbered.id;

UPDATE public.staff_memberships membership
SET account_number = request.account_number
FROM public.committee_account_requests request
WHERE membership.invitation_request_id = request.id
  AND request.kind = 'invite';

WITH base AS (
  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0) AS number
  FROM (
    SELECT member_id AS account_number FROM public.members
    UNION ALL SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite'
    UNION ALL SELECT account_number FROM public.staff_memberships
  ) current_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$'
), numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS number
  FROM public.staff_memberships
  WHERE account_number IS NULL
)
UPDATE public.staff_memberships membership
SET account_number = 'CSUCC-2026-' || lpad((base.number + numbered.number + (
  SELECT count(*) FROM public.committee_account_requests WHERE kind = 'invite' AND account_number IS NOT NULL
))::text, 4, '0')
FROM numbered CROSS JOIN base
WHERE membership.id = numbered.id;

DO $sequence$
DECLARE maximum_number bigint;
BEGIN
  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0)
  INTO maximum_number
  FROM (
    SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite'
    UNION ALL
    SELECT account_number FROM public.staff_memberships
    UNION ALL
    SELECT member_id FROM public.members
  ) ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$';
  PERFORM setval('public.committee_account_number_seq', greatest(maximum_number, 1), maximum_number > 0);
END;
$sequence$;

ALTER TABLE public.staff_memberships ALTER COLUMN account_number SET NOT NULL;
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.staff_memberships'::regclass AND conname='committee_account_number_format') THEN
    ALTER TABLE public.staff_memberships ADD CONSTRAINT committee_account_number_format
      CHECK (account_number ~ '^CSUCC-2026-[0-9]{4,}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.committee_account_requests'::regclass AND conname='committee_request_account_number_format') THEN
    ALTER TABLE public.committee_account_requests ADD CONSTRAINT committee_request_account_number_format
      CHECK (account_number IS NULL OR account_number ~ '^CSUCC-2026-[0-9]{4,}$');
  END IF;
END;
$constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS committee_membership_account_number_unique
  ON public.staff_memberships(account_number);
CREATE UNIQUE INDEX IF NOT EXISTS committee_request_account_number_unique
  ON public.committee_account_requests(account_number) WHERE account_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.committee_assign_account_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.kind = 'invite' AND NEW.account_number IS NULL THEN
    NEW.account_number := 'CSUCC-2026-' || lpad(nextval('public.committee_account_number_seq'::regclass)::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_assign_account_number() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS committee_assign_account_number ON public.committee_account_requests;
CREATE TRIGGER committee_assign_account_number
BEFORE INSERT ON public.committee_account_requests
FOR EACH ROW EXECUTE FUNCTION public.committee_assign_account_number();

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
 IF r.account_number IS NULL THEN RAISE EXCEPTION 'The committee account ID could not be assigned. Retry this request.'; END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 PERFORM public.committee_archive_auto_profile(p_user_id,r.id);
 IF lower(u.email)<>lower(r.email) OR (coalesce(r.payload->>'provisioningMode','invite')<>'password' AND u.invited_at IS NULL) OR u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role'
  OR u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id)
  THEN RAISE EXCEPTION 'The invited account could not be verified.'; END IF;
 IF r.payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD access is not enabled.'; END IF;
 IF coalesce(r.payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (r.payload->>'role'='bod_member' AND r.payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'The invitation needs a valid committee position.'; END IF;
 INSERT INTO public.staff_memberships(auth_user_id,role,active,starts_at,ends_at,assigned_by,title,committee_seat,member_number,invitation_request_id,last_invite_at,account_number)
 VALUES(u.id,r.payload->>'role',true,(r.payload->>'startsAt')::timestamptz,(r.payload->>'endsAt')::timestamptz,auth.uid(),coalesce(r.payload->>'title',''),r.payload->>'committeeSeat',CASE WHEN r.payload->>'role'='crecom_member' AND r.payload->>'committeeSeat'='member' THEN (r.payload->>'committeeMemberNumber')::smallint END,r.id,clock_timestamp(),r.account_number) RETURNING id INTO membership;
 UPDATE public.committee_account_requests SET state='complete',auth_user_id=u.id,membership_id=membership,result=jsonb_build_object('membershipId',membership,'accountNumber',r.account_number),lease_until=null WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(auth.uid(),'committee-invite-complete',membership::text,'success',jsonb_build_object('requestId',r.id,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','committeeMemberNumber',(r.payload->>'committeeMemberNumber')::smallint,'accountNumber',r.account_number));
 RETURN jsonb_build_object('membershipId',membership,'accountNumber',r.account_number);
END;
$function$;

CREATE OR REPLACE FUNCTION public.committee_accounts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE rows jsonb;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'email'),'[]') INTO rows FROM (
  SELECT jsonb_build_object('id',m.id,'requestId',m.invitation_request_id,'accountNumber',m.account_number,'userId',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),
   'email',u.email,'role',m.role,'committeeSeat',m.committee_seat,'committeeMemberNumber',m.member_number,'title',m.title,'startsAt',m.starts_at,'endsAt',m.ends_at,'active',m.active,'revision',m.revision,'setupCompletedAt',m.setup_completed_at,
   'status',CASE WHEN NOT m.active THEN 'inactive' WHEN m.ends_at<=now() THEN 'expired' WHEN m.role='bod_member' AND NOT public.committee_bod_enabled() THEN 'policy_disabled' WHEN m.setup_completed_at IS NULL THEN 'invited' WHEN m.starts_at>now() THEN 'scheduled' ELSE 'active' END,
   'lastSignInAt',u.last_sign_in_at,'assignedCount',(SELECT count(*) FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id WHERE a.membership_id=m.id AND c.status='open' AND a.state IN ('assigned','awaiting_clarification')),
   'lastInviteAt',m.last_invite_at,'error',null) AS row FROM public.staff_memberships m JOIN auth.users u ON u.id=m.auth_user_id
  UNION ALL
  SELECT jsonb_build_object('id',r.id,'requestId',r.id,'accountNumber',r.account_number,'creationMode',coalesce(r.payload->>'provisioningMode','invite'),'userId',r.auth_user_id,'name',r.payload->>'name','email',r.email,'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','committeeMemberNumber',(r.payload->>'committeeMemberNumber')::smallint,'title',r.payload->>'title',
   'startsAt',r.payload->>'startsAt','endsAt',r.payload->>'endsAt','active',false,'revision',0,'setupCompletedAt',null,
   'status',CASE WHEN r.state='failed' THEN 'failed' ELSE 'provisioning' END,'lastSignInAt',null,'assignedCount',0,'lastInviteAt',r.created_at,'error',r.error)
   FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state<>'complete'
 ) records;
 RETURN jsonb_build_object('accounts',rows,'bodEnabled',public.committee_bod_enabled());
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
