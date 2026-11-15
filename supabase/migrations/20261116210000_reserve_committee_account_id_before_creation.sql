BEGIN;

-- A form preview is an actual, stable number. If the form is cancelled, the
-- sequence may have a gap; numbers are never recycled or reassigned.
CREATE TABLE IF NOT EXISTS public.committee_account_number_reservations (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  account_number text NOT NULL UNIQUE CHECK (account_number ~ '^CSUCC-2026-[0-9]{4,}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.committee_account_number_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_account_number_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.committee_account_number_reservations TO service_role;

-- Member and committee accounts share the CSUCC-2026 sequence. Rebase before
-- each allocation too, so member IDs added after the initial backfill are
-- included before the next committee ID is issued.
CREATE OR REPLACE FUNCTION public.committee_sync_account_number_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE existing_max bigint; sequence_value bigint;
BEGIN
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
    WHERE request_id = p_request_id AND actor_id = auth.uid();
    IF assigned_number IS NULL THEN
      PERFORM public.committee_sync_account_number_sequence();
      assigned_number := 'CSUCC-2026-' || lpad(nextval('public.committee_account_number_seq'::regclass)::text, 4, '0');
      INSERT INTO public.committee_account_number_reservations(request_id, actor_id, account_number)
      VALUES (p_request_id, auth.uid(), assigned_number);
    END IF;
  END IF;
  IF assigned_number IS NULL THEN RAISE EXCEPTION 'The account ID could not be recovered. Refresh and retry.'; END IF;
  RETURN jsonb_build_object('accountNumber', assigned_number);
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_reserve_account_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.committee_reserve_account_number(uuid) TO authenticated, service_role;

-- When the existing create flow inserts the request after its external auth
-- account is prepared, use the number already shown in the form.
CREATE OR REPLACE FUNCTION public.committee_assign_account_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE reserved_number text;
BEGIN
  IF NEW.kind = 'invite' AND NEW.account_number IS NULL THEN
    SELECT account_number INTO reserved_number
    FROM public.committee_account_number_reservations
    WHERE request_id = NEW.id AND actor_id = NEW.actor_id;
    IF reserved_number IS NULL THEN
      PERFORM public.committee_sync_account_number_sequence();
    END IF;
    NEW.account_number := coalesce(reserved_number,
      'CSUCC-2026-' || lpad(nextval('public.committee_account_number_seq'::regclass)::text, 4, '0'));
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.committee_assign_account_number() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
