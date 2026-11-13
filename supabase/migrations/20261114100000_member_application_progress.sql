BEGIN;

-- Expose only each member's own application stage and anonymized committee
-- approval counts. Reviewer identities and decision details remain private.
CREATE OR REPLACE FUNCTION public.member_application_progress()
RETURNS TABLE(
  application_id text,
  loan_status text,
  workflow_stage text,
  review_stage text,
  crecom_approved integer,
  crecom_assigned integer,
  bod_approved integer,
  bod_assigned integer,
  progress_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.document_member_active() THEN
    RAISE EXCEPTION 'Active member access is required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.application_id::text,
    a.status::text,
    COALESCE(
      public.committee_application_stage(a.id),
      CASE
        WHEN verification.application_id IS NULL THEN 'not_started'
        WHEN verification.stage = 'ready_for_committee'
          AND (
            verification.verified_state_hash IS DISTINCT FROM packet.state->>'stateHash'
            OR jsonb_array_length(packet.state->'blockers') > 0
          ) THEN 'needs_verification'
        ELSE verification.stage
      END
    ),
    current_cycle.stage,
    COALESCE(crecom.approved, 0)::integer,
    COALESCE(crecom.assigned, 0)::integer,
    COALESCE(bod.approved, 0)::integer,
    COALESCE(bod.assigned, 0)::integer,
    GREATEST(
      a.updated_at,
      verification.updated_at,
      current_cycle.created_at,
      crecom.last_decision_at,
      bod.last_decision_at,
      final_decision.created_at
    )
  FROM public.loan_applications AS a
  JOIN public.members AS m ON m.id = a.member_id AND m.user_id = auth.uid()
  LEFT JOIN public.application_verifications AS verification
    ON verification.application_id = a.id
  LEFT JOIN LATERAL (
    SELECT public.private_application_verification_state(a.id) AS state
    WHERE verification.stage = 'ready_for_committee'
  ) AS packet ON true
  LEFT JOIN LATERAL (
    SELECT cycle.id, cycle.stage, cycle.created_at
    FROM public.application_review_cycles AS cycle
    WHERE cycle.application_id = a.id AND cycle.status <> 'superseded'
    ORDER BY cycle.cycle_no DESC,
      CASE WHEN cycle.stage = 'BOD' THEN 0 ELSE 1 END
    LIMIT 1
  ) AS current_cycle ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE assignment.state = 'decision_recorded'
          AND decision.decision = 'approve'
      )::integer AS approved,
      count(*) FILTER (
        WHERE assignment.state NOT IN ('cancelled', 'reassigned')
      )::integer AS assigned,
      max(decision.created_at) AS last_decision_at
    FROM public.application_review_cycles AS cycle
    JOIN public.review_assignments AS assignment
      ON assignment.review_cycle_id = cycle.id
    LEFT JOIN public.individual_review_decisions AS decision
      ON decision.assignment_id = assignment.id
    WHERE cycle.application_id = a.id
      AND cycle.stage = 'CRECOM'
      AND cycle.status <> 'superseded'
      AND cycle.id = (
        SELECT latest.id
        FROM public.application_review_cycles AS latest
        WHERE latest.application_id = a.id
          AND latest.stage = 'CRECOM'
          AND latest.status <> 'superseded'
        ORDER BY latest.cycle_no DESC
        LIMIT 1
      )
  ) AS crecom ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (
        WHERE assignment.state = 'decision_recorded'
          AND decision.decision = 'approve'
      )::integer AS approved,
      count(*) FILTER (
        WHERE assignment.state NOT IN ('cancelled', 'reassigned')
      )::integer AS assigned,
      max(decision.created_at) AS last_decision_at
    FROM public.application_review_cycles AS cycle
    JOIN public.review_assignments AS assignment
      ON assignment.review_cycle_id = cycle.id
    LEFT JOIN public.individual_review_decisions AS decision
      ON decision.assignment_id = assignment.id
    WHERE cycle.application_id = a.id
      AND cycle.stage = 'BOD'
      AND cycle.status <> 'superseded'
      AND cycle.id = (
        SELECT latest.id
        FROM public.application_review_cycles AS latest
        WHERE latest.application_id = a.id
          AND latest.stage = 'BOD'
          AND latest.status <> 'superseded'
        ORDER BY latest.cycle_no DESC
        LIMIT 1
      )
  ) AS bod ON true
  LEFT JOIN public.application_final_decisions AS final_decision
    ON final_decision.application_id = a.id
  ORDER BY a.date_submitted DESC, a.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.member_application_progress()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_application_progress()
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
