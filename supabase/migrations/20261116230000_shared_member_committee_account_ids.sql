BEGIN;

-- All CSUCC-2026 IDs, whether member or committee, use one sequence and one
-- transaction-level lock. This prevents two concurrent account forms from
-- reserving the same next number.
ALTER TABLE public.committee_account_number_reservations
  ADD COLUMN IF NOT EXISTS reservation_kind text NOT NULL DEFAULT 'committee';
DO $reservation_kind_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.committee_account_number_reservations'::regclass
      AND conname = 'committee_account_number_reservation_kind_check'
  ) THEN
    ALTER TABLE public.committee_account_number_reservations
      ADD CONSTRAINT committee_account_number_reservation_kind_check
      CHECK (reservation_kind IN ('member', 'committee'));
  END IF;
END;
$reservation_kind_check$;

CREATE OR REPLACE FUNCTION public.committee_sync_account_number_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE existing_max bigint; sequence_value bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('csucc-shared-account-number-sequence', 0));
  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0)
  INTO existing_max
  FROM (
    SELECT member_id AS account_number FROM public.members
    UNION ALL SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite'
    UNION ALL SELECT account_number FROM public.staff_memberships
    UNION ALL SELECT account_number FROM public.committee_account_number_reservations
  ) current_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$';
  SELECT last_value INTO sequence_value FROM public.committee_account_number_seq;
  IF existing_max > sequence_value THEN
    PERFORM setval('public.committee_account_number_seq'::regclass, existing_max, true);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_sync_account_number_sequence() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.committee_next_account_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('csucc-shared-account-number-sequence', 0));
  PERFORM public.committee_sync_account_number_sequence();
  RETURN 'CSUCC-2026-' || lpad(nextval('public.committee_account_number_seq'::regclass)::text, 4, '0');
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_next_account_number() FROM PUBLIC, anon, authenticated;

-- Reserve the member ID on the server before the create form can be submitted.
-- This RPC is service-role only; the Edge Function validates the current admin
-- session and passes its user ID explicitly.
CREATE OR REPLACE FUNCTION public.reserve_member_account_number(p_request_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE assigned_number text;
BEGIN
  IF p_request_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Reopen the account form and retry.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_actor_id
      AND u.raw_app_meta_data->>'role' IN ('super_admin', 'admin', 'coop_admin')
      AND coalesce(u.raw_app_meta_data->>'account_status', 'active') = 'active'
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('member-account-id-reservation:' || p_request_id::text, 0));
  SELECT account_number INTO assigned_number
  FROM public.committee_account_number_reservations
  WHERE request_id = p_request_id AND actor_id = p_actor_id AND reservation_kind = 'member';
  IF assigned_number IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.committee_account_number_reservations WHERE request_id = p_request_id)
       OR EXISTS (SELECT 1 FROM public.committee_account_requests WHERE id = p_request_id) THEN
      RAISE EXCEPTION 'This ID reservation belongs to another account form.' USING ERRCODE = '42501';
    END IF;
    assigned_number := public.committee_next_account_number();
    INSERT INTO public.committee_account_number_reservations(request_id, actor_id, account_number, reservation_kind)
    VALUES (p_request_id, p_actor_id, assigned_number, 'member');
  END IF;
  RETURN jsonb_build_object('accountNumber', assigned_number);
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_member_account_number(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_member_account_number(uuid, uuid) TO service_role;

-- Keep the existing committee reservation contract and authorization. Its
-- allocation now goes through the shared sequence lock used by member IDs.
CREATE OR REPLACE FUNCTION public.committee_reserve_account_number(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE assigned_number text; existing_request public.committee_account_requests%ROWTYPE;
BEGIN
  IF NOT public.document_staff_access('committee.accounts.manage') THEN
    RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Reopen the account form and retry.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('committee-account-number:' || p_request_id::text, 0));
  SELECT * INTO existing_request
  FROM public.committee_account_requests
  WHERE id = p_request_id;
  IF existing_request.id IS NOT NULL THEN
    IF existing_request.kind <> 'invite' OR existing_request.actor_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'This account ID belongs to another administrator.' USING ERRCODE = '42501';
    END IF;
    assigned_number := existing_request.account_number;
  ELSE
    SELECT account_number INTO assigned_number
    FROM public.committee_account_number_reservations
    WHERE request_id = p_request_id AND actor_id = auth.uid() AND reservation_kind = 'committee';
    IF assigned_number IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.committee_account_number_reservations WHERE request_id = p_request_id) THEN
        RAISE EXCEPTION 'This account ID belongs to another administrator.' USING ERRCODE = '42501';
      END IF;
      assigned_number := public.committee_next_account_number();
      INSERT INTO public.committee_account_number_reservations(request_id, actor_id, account_number, reservation_kind)
      VALUES (p_request_id, auth.uid(), assigned_number, 'committee');
    END IF;
  END IF;
  IF assigned_number IS NULL THEN RAISE EXCEPTION 'The account ID could not be recovered. Refresh and retry.'; END IF;
  RETURN jsonb_build_object('accountNumber', assigned_number);
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_reserve_account_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.committee_reserve_account_number(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.committee_assign_account_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE reserved_number text;
BEGIN
  IF NEW.kind = 'invite' AND NEW.account_number IS NULL THEN
    SELECT account_number INTO reserved_number
    FROM public.committee_account_number_reservations
    WHERE request_id = NEW.id AND actor_id = NEW.actor_id AND reservation_kind = 'committee';
    NEW.account_number := coalesce(reserved_number, public.committee_next_account_number());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_assign_account_number() FROM PUBLIC, anon, authenticated;

-- Redeem a member reservation on insert. If an older create path supplies a
-- formatted ID without a matching reservation, replace it with a safe number.
CREATE OR REPLACE FUNCTION public.member_assign_shared_account_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE reserved_number text;
BEGIN
  IF NEW.member_id ~ '^CSUCC-2026-[0-9]+$' THEN
    DELETE FROM public.committee_account_number_reservations
    WHERE account_number = NEW.member_id
      AND reservation_kind = 'member'
      AND (auth.uid() IS NULL OR actor_id = auth.uid())
    RETURNING account_number INTO reserved_number;
    IF reserved_number IS NOT NULL THEN RETURN NEW; END IF;
    NEW.member_id := public.committee_next_account_number();
  ELSIF NEW.member_id IS NULL OR btrim(NEW.member_id) = '' THEN
    NEW.member_id := public.committee_next_account_number();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.member_assign_shared_account_number() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS member_assign_shared_account_number ON public.members;
CREATE TRIGGER member_assign_shared_account_number
BEFORE INSERT ON public.members
FOR EACH ROW EXECUTE FUNCTION public.member_assign_shared_account_number();

NOTIFY pgrst, 'reload schema';
COMMIT;
