BEGIN;

-- Keep the owner's confirmed 0220 baseline, but remove abandoned form previews
-- above it. Never delete reservations tied to a saved committee request.
DO $account_id_repair$
DECLARE highest_saved bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('csucc-shared-account-number-sequence', 0));

  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0)
  INTO highest_saved
  FROM (
    SELECT member_id AS account_number FROM public.members
    UNION ALL SELECT account_number FROM public.staff_memberships
    UNION ALL SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite' AND state = 'complete'
  ) saved_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$';

  IF highest_saved > 220 THEN
    RAISE EXCEPTION 'Account ID repair stopped: a saved account or committee request is above CSUCC-2026-0220.';
  END IF;

  DELETE FROM public.committee_account_number_reservations reservation
  WHERE reservation.account_number ~ '^CSUCC-2026-[0-9]+$'
    AND substring(reservation.account_number FROM 12)::bigint > 220
    AND NOT EXISTS (
      SELECT 1 FROM public.committee_account_requests request
      WHERE request.id = reservation.request_id
    );
END;
$account_id_repair$;

CREATE TABLE IF NOT EXISTS public.shared_account_number_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_number bigint NOT NULL CHECK (last_number >= 0)
);
ALTER TABLE public.shared_account_number_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_account_number_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shared_account_number_state TO service_role;

INSERT INTO public.shared_account_number_state(singleton, last_number)
VALUES (true, 220)
ON CONFLICT (singleton) DO UPDATE
SET last_number = greatest(public.shared_account_number_state.last_number, EXCLUDED.last_number);

-- This counter is a normal transactional row, not a PostgreSQL sequence.
-- Failed inserts roll back the increment, and the same lock serializes both
-- member and committee account creation.
CREATE OR REPLACE FUNCTION public.committee_claim_account_number(p_expected_number text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE next_number bigint; saved_max bigint; candidate text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('csucc-shared-account-number-sequence', 0));

  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0)
  INTO saved_max
  FROM (
    SELECT member_id AS account_number FROM public.members
    UNION ALL SELECT account_number FROM public.staff_memberships
    UNION ALL SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite' AND state = 'complete'
  ) saved_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$';

  SELECT greatest(last_number, 220, saved_max) + 1
  INTO next_number
  FROM public.shared_account_number_state WHERE singleton
  FOR UPDATE;

  IF next_number IS NULL THEN RAISE EXCEPTION 'The shared account ID counter is unavailable.'; END IF;
  candidate := 'CSUCC-2026-' || lpad(next_number::text, 4, '0');
  IF p_expected_number IS NOT NULL AND p_expected_number IS DISTINCT FROM candidate THEN
    RAISE EXCEPTION 'The next ID changed to %. Refresh the form and try again.', candidate USING ERRCODE = '40001';
  END IF;

  UPDATE public.shared_account_number_state
  SET last_number = next_number
  WHERE singleton
  RETURNING last_number INTO next_number;
  RETURN candidate;
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_claim_account_number(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.committee_next_account_number()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$ SELECT public.committee_claim_account_number(NULL) $function$;
REVOKE ALL ON FUNCTION public.committee_next_account_number() FROM PUBLIC, anon, authenticated;

-- A read-only preview; it does not reserve or consume the displayed ID.
CREATE OR REPLACE FUNCTION public.preview_shared_account_number(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE next_number bigint; saved_max bigint;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_actor_id
      AND u.raw_app_meta_data->>'role' IN ('super_admin', 'admin', 'coop_admin')
      AND coalesce(u.raw_app_meta_data->>'account_status', 'active') = 'active'
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('csucc-shared-account-number-sequence', 0));
  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0)
  INTO saved_max
  FROM (
    SELECT member_id AS account_number FROM public.members
    UNION ALL SELECT account_number FROM public.staff_memberships
    UNION ALL SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite' AND state = 'complete'
  ) saved_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$';

  SELECT greatest(last_number, 220, saved_max) + 1
  INTO next_number FROM public.shared_account_number_state WHERE singleton;
  IF next_number IS NULL THEN RAISE EXCEPTION 'The shared account ID counter is unavailable.'; END IF;
  RETURN jsonb_build_object('accountNumber', 'CSUCC-2026-' || lpad(next_number::text, 4, '0'));
END;
$function$;
REVOKE ALL ON FUNCTION public.preview_shared_account_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_shared_account_number(uuid) TO service_role;

-- Disable the old form-open reservation APIs. Account creation now calls the
-- same transactional allocator only when the actual database account is saved.
REVOKE ALL ON FUNCTION public.reserve_member_account_number(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.committee_reserve_account_number(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Every new member profile, including Auth-trigger-created profiles, receives
-- the shared ID at insertion. Existing legacy rows are left untouched.
CREATE OR REPLACE FUNCTION public.member_assign_shared_account_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users user_record
    WHERE user_record.id = NEW.user_id
      AND user_record.raw_user_meta_data->>'account_creation_pending' = 'true'
  ) THEN
    NEW.member_id := 'PENDING-' || replace(NEW.user_id::text, '-', '');
  ELSE
    NEW.member_id := public.committee_next_account_number();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_admin_member_account_creation(
  p_actor_id uuid,
  p_user_id uuid,
  p_expected_account_number text,
  p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE assigned_number text; target_role text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users actor
    WHERE actor.id = p_actor_id AND actor.raw_app_meta_data->>'role' = 'super_admin'
      AND coalesce(actor.raw_app_meta_data->>'account_status', 'active') = 'active'
      AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_account_number IS NULL OR p_expected_account_number !~ '^CSUCC-2026-[0-9]{4,}$'
    OR jsonb_typeof(p_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The account ID preview or account details are invalid.';
  END IF;

  SELECT raw_app_meta_data->>'role' INTO target_role
  FROM auth.users
  WHERE id = p_user_id AND raw_user_meta_data->>'account_creation_pending' = 'true'
  FOR UPDATE;
  IF target_role IS NULL OR target_role NOT IN ('member', 'coop_admin', 'super_admin') THEN
    RAISE EXCEPTION 'The account is not ready to be completed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.members member
    WHERE member.user_id = p_user_id AND member.member_id LIKE 'PENDING-%'
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'The pending account profile could not be verified.';
  END IF;

  assigned_number := public.committee_claim_account_number(p_expected_account_number);
  UPDATE public.members SET member_id = assigned_number WHERE user_id = p_user_id;
  INSERT INTO public.admin_activity_logs(actor_id, action_name, target_id, result, details)
  VALUES (p_actor_id, 'create-account', assigned_number, 'success', p_details);
  UPDATE auth.users
  SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'account_creation_pending'
  WHERE id = p_user_id;
  RETURN jsonb_build_object('accountNumber', assigned_number, 'member_id', assigned_number);
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_admin_member_account_creation(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_admin_member_account_creation(uuid, uuid, text, jsonb) TO service_role;

-- Committee requests may exist while Auth provisioning is underway, but they
-- do not consume an ID until committee_finish_invite saves the membership.
CREATE OR REPLACE FUNCTION public.committee_assign_account_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.kind = 'invite' THEN NEW.account_number := NULL; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.committee_finish_invite(
  p_request_id uuid, p_attempt_id uuid, p_user_id uuid, p_expected_account_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE r public.committee_account_requests%ROWTYPE; u auth.users%ROWTYPE; membership uuid;
BEGIN
  IF NOT public.document_staff_access('committee.accounts.manage') THEN
    RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id = p_request_id AND kind = 'invite' FOR UPDATE;
  IF r.actor_id <> auth.uid() THEN RAISE EXCEPTION 'This invitation belongs to another administrator.' USING ERRCODE = '42501'; END IF;
  IF r.state = 'complete' THEN RETURN r.result; END IF;
  IF r.attempt_id IS DISTINCT FROM p_attempt_id OR r.lease_until <= now() THEN
    RAISE EXCEPTION 'Invitation processing changed. Retry the saved request.' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO STRICT u FROM auth.users WHERE id = p_user_id;
  PERFORM public.committee_archive_auto_profile(p_user_id, r.id);
  IF lower(u.email) <> lower(r.email)
    OR (coalesce(r.payload->>'provisioningMode', 'invite') <> 'password' AND u.invited_at IS NULL)
    OR u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role'
    OR u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text
    OR EXISTS (SELECT 1 FROM public.members WHERE user_id = u.id)
    OR EXISTS (SELECT 1 FROM public.staff_memberships WHERE auth_user_id = u.id) THEN
    RAISE EXCEPTION 'The invited account could not be verified.';
  END IF;
  IF r.payload->>'role' = 'bod_member' AND NOT public.committee_bod_enabled() THEN
    RAISE EXCEPTION 'BOD access is not enabled.';
  END IF;
  IF coalesce(r.payload->>'committeeSeat', '') NOT IN ('member', 'chairperson')
    OR (r.payload->>'role' = 'bod_member' AND r.payload->>'committeeSeat' <> 'chairperson') THEN
    RAISE EXCEPTION 'The invitation needs a valid committee position.';
  END IF;

  IF r.account_number IS NULL THEN
    r.account_number := public.committee_claim_account_number(p_expected_account_number);
  ELSIF p_expected_account_number IS NOT NULL AND r.account_number IS DISTINCT FROM p_expected_account_number THEN
    RAISE EXCEPTION 'This request already has a different account ID. Refresh the committee account list.' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.staff_memberships(auth_user_id, role, active, starts_at, ends_at, assigned_by, title,
    committee_seat, member_number, invitation_request_id, last_invite_at, account_number)
  VALUES (u.id, r.payload->>'role', true, (r.payload->>'startsAt')::timestamptz,
    (r.payload->>'endsAt')::timestamptz, auth.uid(), coalesce(r.payload->>'title', ''),
    r.payload->>'committeeSeat',
    CASE WHEN r.payload->>'role' = 'crecom_member' AND r.payload->>'committeeSeat' = 'member'
      THEN (r.payload->>'committeeMemberNumber')::smallint END,
    r.id, clock_timestamp(), r.account_number)
  RETURNING id INTO membership;

  UPDATE public.committee_account_requests
  SET account_number = r.account_number, state = 'complete', auth_user_id = u.id,
    membership_id = membership,
    result = jsonb_build_object('membershipId', membership, 'accountNumber', r.account_number),
    lease_until = NULL
  WHERE id = r.id;
  INSERT INTO public.admin_activity_logs(actor_id, action_name, target_id, result, details)
  VALUES (auth.uid(), 'committee-invite-complete', membership::text, 'success',
    jsonb_build_object('requestId', r.id, 'role', r.payload->>'role',
      'committeeSeat', r.payload->>'committeeSeat',
      'committeeMemberNumber', (r.payload->>'committeeMemberNumber')::smallint,
      'accountNumber', r.account_number));
  RETURN jsonb_build_object('membershipId', membership, 'accountNumber', r.account_number);
END;
$function$;

-- Preserve the old signature for internal compatibility. New create flows use
-- the expected-number signature so a stale preview fails without consuming ID.
CREATE OR REPLACE FUNCTION public.committee_finish_invite(p_request_id uuid, p_attempt_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$ SELECT public.committee_finish_invite(p_request_id, p_attempt_id, p_user_id, NULL) $function$;

CREATE OR REPLACE FUNCTION public.committee_account_action(p_actor_id uuid, p_operation text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE previous_subject text := current_setting('request.jwt.claim.sub', true); result jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_actor_id AND raw_app_meta_data->>'role' = 'super_admin'
  ) THEN RAISE EXCEPTION 'Super Admin access is required.' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor_id::text, true);
  IF p_operation = 'committee_reserve_invite' THEN
    result := public.committee_reserve_invite((p_args->>'p_request_id')::uuid, (p_args->>'p_attempt_id')::uuid, p_args->'p_payload');
  ELSIF p_operation = 'committee_finish_invite' THEN
    result := public.committee_finish_invite((p_args->>'p_request_id')::uuid, (p_args->>'p_attempt_id')::uuid,
      (p_args->>'p_user_id')::uuid, p_args->>'p_expected_account_number');
  ELSIF p_operation = 'committee_request_failed' THEN
    PERFORM public.committee_request_failed((p_args->>'p_request_id')::uuid, (p_args->>'p_attempt_id')::uuid, p_args->>'p_message');
    result := '{}';
  ELSIF p_operation = 'committee_change_membership' THEN
    result := public.committee_change_membership((p_args->>'p_id')::uuid, (p_args->>'p_revision')::integer,
      p_args->>'p_action', p_args->'p_payload', (p_args->>'p_request_id')::uuid);
  ELSIF p_operation = 'committee_begin_link' THEN
    result := public.committee_begin_link((p_args->>'p_id')::uuid, (p_args->>'p_revision')::integer,
      (p_args->>'p_request_id')::uuid, (p_args->>'p_attempt_id')::uuid);
  ELSIF p_operation = 'committee_finish_link' THEN
    result := public.committee_finish_link((p_args->>'p_request_id')::uuid, (p_args->>'p_attempt_id')::uuid);
  ELSE RAISE EXCEPTION 'Unknown committee account operation.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_subject, ''), true);
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_subject, ''), true);
  RAISE;
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
