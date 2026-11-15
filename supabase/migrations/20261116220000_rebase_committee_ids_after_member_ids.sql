BEGIN;

-- If the initial committee ID migration was already applied, move its IDs
-- after the highest existing member ID. Keep linked membership, invitation,
-- and open-form reservation IDs paired while rebasing.
DROP TABLE IF EXISTS pg_temp.committee_account_id_rebase;
CREATE TEMP TABLE committee_account_id_rebase ON COMMIT DROP AS
WITH member_max AS (
  SELECT coalesce(max(substring(member_id FROM 12)::bigint), 0) AS value
  FROM public.members
  WHERE member_id ~ '^CSUCC-2026-[0-9]+$'
), entities AS (
  SELECT 'request'::text AS entity_type, request.id AS entity_id, request.created_at
  FROM public.committee_account_requests request
  WHERE request.kind = 'invite'
  UNION ALL
  SELECT 'reservation', reservation.request_id, reservation.created_at
  FROM public.committee_account_number_reservations reservation
  WHERE NOT EXISTS (
    SELECT 1 FROM public.committee_account_requests request
    WHERE request.id = reservation.request_id AND request.kind = 'invite'
  )
  UNION ALL
  SELECT 'membership', membership.id, membership.created_at
  FROM public.staff_memberships membership
  WHERE membership.invitation_request_id IS NULL
), numbered AS (
  SELECT entities.entity_type, entities.entity_id,
    member_max.value + row_number() OVER (ORDER BY entities.created_at, entities.entity_type, entities.entity_id) AS new_suffix,
    row_number() OVER (ORDER BY entities.created_at, entities.entity_type, entities.entity_id) AS ordinal
  FROM entities CROSS JOIN member_max
), maxima AS (
  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0) AS value
  FROM (
    SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite'
    UNION ALL SELECT account_number FROM public.committee_account_number_reservations
    UNION ALL SELECT account_number FROM public.staff_memberships
  ) current_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$'
)
SELECT numbered.*, maxima.value + numbered.ordinal AS parking_suffix
FROM numbered CROSS JOIN maxima;

DO $rebase$
DECLARE member_max bigint; committee_min bigint;
BEGIN
  SELECT coalesce(max(substring(member_id FROM 12)::bigint), 0)
  INTO member_max FROM public.members
  WHERE member_id ~ '^CSUCC-2026-[0-9]+$';
  SELECT min(substring(account_number FROM 12)::bigint)
  INTO committee_min
  FROM (
    SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite'
    UNION ALL SELECT account_number FROM public.committee_account_number_reservations
    UNION ALL SELECT account_number FROM public.staff_memberships
  ) current_ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$';

  IF committee_min IS NOT NULL AND committee_min <= member_max THEN
    -- Park each ID above the old maximum first to avoid collisions with unique
    -- indexes while moving the rows to their final sequence values.
    UPDATE public.committee_account_requests request
    SET account_number = 'CSUCC-2026-' || lpad(rebase.parking_suffix::text, 4, '0')
    FROM committee_account_id_rebase rebase
    WHERE rebase.entity_type = 'request' AND request.id = rebase.entity_id;

    UPDATE public.committee_account_number_reservations reservation
    SET account_number = 'CSUCC-2026-' || lpad(rebase.parking_suffix::text, 4, '0')
    FROM committee_account_id_rebase rebase
    WHERE reservation.request_id = rebase.entity_id
      AND rebase.entity_type IN ('request', 'reservation');

    UPDATE public.staff_memberships membership
    SET account_number = 'CSUCC-2026-' || lpad(rebase.parking_suffix::text, 4, '0')
    FROM committee_account_id_rebase rebase
    WHERE (rebase.entity_type = 'request' AND membership.invitation_request_id = rebase.entity_id)
       OR (rebase.entity_type = 'membership' AND membership.id = rebase.entity_id);

    UPDATE public.committee_account_requests request
    SET account_number = 'CSUCC-2026-' || lpad(rebase.new_suffix::text, 4, '0')
    FROM committee_account_id_rebase rebase
    WHERE rebase.entity_type = 'request' AND request.id = rebase.entity_id;

    UPDATE public.committee_account_number_reservations reservation
    SET account_number = 'CSUCC-2026-' || lpad(rebase.new_suffix::text, 4, '0')
    FROM committee_account_id_rebase rebase
    WHERE reservation.request_id = rebase.entity_id
      AND rebase.entity_type IN ('request', 'reservation');

    UPDATE public.staff_memberships membership
    SET account_number = 'CSUCC-2026-' || lpad(rebase.new_suffix::text, 4, '0')
    FROM committee_account_id_rebase rebase
    WHERE (rebase.entity_type = 'request' AND membership.invitation_request_id = rebase.entity_id)
       OR (rebase.entity_type = 'membership' AND membership.id = rebase.entity_id);
  END IF;
END;
$rebase$;

DO $sequence$
DECLARE maximum_number bigint;
BEGIN
  SELECT coalesce(max(substring(account_number FROM 12)::bigint), 0)
  INTO maximum_number
  FROM (
    SELECT account_number FROM public.committee_account_requests WHERE kind = 'invite'
    UNION ALL SELECT account_number FROM public.committee_account_number_reservations
    UNION ALL SELECT account_number FROM public.staff_memberships
    UNION ALL SELECT member_id FROM public.members
  ) ids
  WHERE account_number ~ '^CSUCC-2026-[0-9]+$';
  PERFORM setval('public.committee_account_number_seq'::regclass, greatest(maximum_number, 1), maximum_number > 0);
END;
$sequence$;

COMMIT;
