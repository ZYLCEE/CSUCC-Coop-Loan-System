BEGIN;

-- Employer Certification is a required application document. Collateral is
-- required only when the amount is strictly greater than the configured limit
-- (currently 200,000).
DO $migration$
DECLARE
  existing_check record;
BEGIN
  FOR existing_check IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.loan_documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
      AND pg_get_constraintdef(oid) ILIKE '%payslip%'
      AND pg_get_constraintdef(oid) ILIKE '%supporting%'
  LOOP
    EXECUTE format('ALTER TABLE public.loan_documents DROP CONSTRAINT %I', existing_check.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.loan_documents'::regclass
      AND conname = 'loan_documents_kind_check'
  ) THEN
    ALTER TABLE public.loan_documents
      ADD CONSTRAINT loan_documents_kind_check
      CHECK (kind IN ('payslip', 'validId', 'collateral', 'employerCertification', 'supporting'));
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.private_application_verification_state(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  a public.loan_applications%ROWTYPE;
  m public.members%ROWTYPE;
  financial jsonb;
  documents jsonb;
  manifest jsonb;
  current_packet_hash text;
  policy public.approval_workflow_policies%ROWTYPE;
  w public.application_verifications%ROWTYPE;
  evidence jsonb;
  blockers jsonb := '[]';
  required_kinds text[] := ARRAY['validId', 'payslip', 'employerCertification'];
  member_active boolean;
  document jsonb;
  kind text;
  borrower_count integer := 0;
  co_maker_count integer := 0;
  witness_count integer := 0;
  checks jsonb;
BEGIN
  SELECT * INTO STRICT a FROM public.loan_applications WHERE id = p_id;
  SELECT * INTO m FROM public.members WHERE id = a.member_id;
  SELECT * INTO w FROM public.application_verifications WHERE application_id = a.id;
  IF w.policy_id IS NOT NULL THEN
    SELECT * INTO policy FROM public.approval_workflow_policies WHERE id = w.policy_id;
  ELSE
    SELECT * INTO policy FROM public.approval_workflow_policies
    WHERE status = 'approved' AND effective_at <= now() ORDER BY version DESC LIMIT 1;
  END IF;

  SELECT to_jsonb(s) - 'updated_by' - 'updated_at' INTO financial
  FROM public.loan_policy_settings s WHERE singleton = true;
  IF financial IS NULL OR financial->>'collateral_required_above' IS NULL THEN
    blockers := blockers || jsonb_build_array('Current loan document requirements are unavailable.');
  ELSIF a.amount > (financial->>'collateral_required_above')::numeric THEN
    required_kinds := array_append(required_kinds, 'collateral');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'kind', d.kind, 'versionId', v.id, 'version', coalesce(v.version, 1),
      'name', coalesce(v.original_name, d.original_name), 'storagePath', coalesce(v.storage_path, d.storage_path),
      'size', coalesce(v.size_bytes, d.size_bytes), 'contentType', coalesce(v.content_type, d.content_type),
      'reviewStatus', coalesce(r.status, 'to_review'), 'reviewId', r.id
    ) ORDER BY d.kind, d.id), '[]') INTO documents
  FROM public.loan_documents d
  LEFT JOIN LATERAL (
    SELECT * FROM public.loan_document_versions v WHERE v.document_id = d.id ORDER BY version DESC LIMIT 1
  ) v ON true
  LEFT JOIN LATERAL (
    SELECT * FROM public.loan_document_reviews r
    WHERE r.document_id = d.id AND r.version_id IS NOT DISTINCT FROM v.id
    ORDER BY created_at DESC, id DESC LIMIT 1
  ) r ON true
  WHERE d.loan_application_id = a.id;

  SELECT coalesce(jsonb_agg(value - 'reviewStatus' - 'reviewId' ORDER BY value->>'kind', value->>'id'), '[]')
  INTO manifest FROM jsonb_array_elements(documents);
  current_packet_hash := encode(sha256(convert_to(jsonb_build_object(
    'application', jsonb_build_object('id', a.id, 'memberId', a.member_id, 'loanType', a.loan_type,
      'amount', a.amount, 'purpose', a.purpose, 'tenure', a.tenure_months, 'monthlyPayment', a.monthly_payment),
    'member', jsonb_build_object('id', m.id, 'userId', m.user_id, 'memberNumber', m.member_id,
      'name', concat_ws(' ', m.first_name, m.last_name), 'membershipType', m.membership_type),
    'coMakerMemberId', to_jsonb(a)->>'co_maker_member_id', 'financialPolicy', financial, 'documents', manifest
  )::text, 'UTF8')), 'hex');

  SELECT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = m.user_id AND u.raw_app_meta_data->>'role' = 'member'
      AND coalesce(u.raw_app_meta_data->>'account_status', 'active') = 'active'
      AND (u.banned_until IS NULL OR u.banned_until <= now())
      AND m.status = 'active' AND m.must_change_password = false
  ) INTO member_active;
  IF NOT member_active THEN
    blockers := blockers || jsonb_build_array('The member must have an active, linked account with password setup completed.');
  END IF;

  FOREACH kind IN ARRAY required_kinds LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'kind' = kind) THEN
      blockers := blockers || jsonb_build_array('Required file is missing: ' || kind);
    END IF;
  END LOOP;
  FOR document IN SELECT value FROM jsonb_array_elements(documents) LOOP
    IF document->>'reviewStatus' <> 'verified' THEN
      blockers := blockers || jsonb_build_array('The latest file must be verified: ' || (document->>'kind'));
    END IF;
  END LOOP;

  checks := coalesce(w.checks, '{"identity":false,"eligibility":false,"terms":false}');
  IF checks->>'identity' IS DISTINCT FROM 'true' THEN blockers := blockers || jsonb_build_array('Complete the identity and application details check.'); END IF;
  IF checks->>'eligibility' IS DISTINCT FROM 'true' THEN blockers := blockers || jsonb_build_array('Complete the membership eligibility and affordability check.'); END IF;
  IF checks->>'terms' IS DISTINCT FROM 'true' THEN blockers := blockers || jsonb_build_array('Complete the loan terms and payment projection check.'); END IF;
  IF policy.id IS NULL OR policy.status <> 'approved' THEN
    blockers := blockers || jsonb_build_array('CSUCC-approved verification and consent requirements have not been configured.');
  END IF;

  SELECT coalesce(jsonb_agg(value ORDER BY value->>'kind', value->>'subject'), '[]') INTO evidence
  FROM (
    SELECT jsonb_build_object('id', e.id, 'kind', e.kind, 'subject', e.subject_reference, 'method', e.method,
      'occurredAt', e.occurred_at, 'reference', e.evidence_reference) AS value
    FROM public.application_consent_evidence e
    WHERE e.application_id = a.id AND e.packet_hash = current_packet_hash AND e.invalidated_at IS NULL
      AND e.occurred_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now())
      AND coalesce(policy.config->'allowedConsentMethods', '[]') ? e.method
      AND (e.kind <> 'borrower' OR e.subject_user_id = m.user_id)
      AND (e.kind <> 'co_maker' OR (
        e.subject_user_id IS DISTINCT FROM m.user_id AND e.subject_reference <> m.member_id
        AND EXISTS (
          SELECT 1 FROM public.members cm WHERE cm.id::text = to_jsonb(a)->>'co_maker_member_id'
            AND ((cm.user_id IS NOT NULL AND cm.user_id = e.subject_user_id)
              OR (e.method = 'paper' AND cm.user_id IS NULL AND e.subject_user_id IS NULL
                AND e.subject_reference IN (cm.member_id, cm.id::text)))
        )
      ))
    UNION ALL
    SELECT jsonb_build_object('id', r.id, 'kind', 'co_maker', 'subject', coalesce(cm.member_id, cm.id::text),
      'method', 'otp', 'occurredAt', r.accepted_at, 'reference', 'Co-maker OTP approval: ' || r.id) AS value
    FROM public.co_maker_requests r JOIN public.members cm ON cm.id = r.co_maker_member_id
    WHERE r.id::text = to_jsonb(a)->>'co_maker_request_id' AND r.application_id = a.application_id
      AND r.co_maker_member_id::text = to_jsonb(a)->>'co_maker_member_id' AND r.borrower_member_id = a.member_id
      AND r.status = 'accepted' AND r.accepted_at IS NOT NULL AND r.accepted_at <= now()
      AND cm.user_id IS NOT NULL AND cm.user_id IS DISTINCT FROM m.user_id
      AND coalesce(policy.config->'allowedConsentMethods', '[]') ? 'otp'
      AND NOT EXISTS (
        SELECT 1 FROM public.application_consent_evidence existing
        WHERE existing.application_id = a.id AND existing.packet_hash = current_packet_hash
          AND existing.kind = 'co_maker' AND existing.subject_user_id = cm.user_id
          AND existing.invalidated_at IS NULL AND existing.occurred_at <= now()
          AND (existing.expires_at IS NULL OR existing.expires_at > now())
      )
  ) consent;
  SELECT count(*) FILTER (WHERE value->>'kind' = 'borrower'),
    count(DISTINCT value->>'subject') FILTER (WHERE value->>'kind' = 'co_maker'),
    count(DISTINCT value->>'subject') FILTER (WHERE value->>'kind' = 'witness')
  INTO borrower_count, co_maker_count, witness_count FROM jsonb_array_elements(evidence);
  IF policy.id IS NOT NULL AND policy.status = 'approved' THEN
    IF jsonb_typeof(policy.config->'borrowerConsentRequired') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(policy.config->'coMakerConsentRequired') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(policy.config->'witnessCount') IS DISTINCT FROM 'number'
      OR jsonb_array_length(coalesce(policy.config->'allowedConsentMethods', '[]')) = 0 THEN
      blockers := blockers || jsonb_build_array('Approved consent and witness requirements are incomplete.');
    ELSE
      IF (policy.config->>'borrowerConsentRequired')::boolean AND borrower_count < 1 THEN blockers := blockers || jsonb_build_array('Current borrower consent evidence has not been recorded.'); END IF;
      IF (policy.config->>'coMakerConsentRequired')::boolean AND co_maker_count <> 1 THEN blockers := blockers || jsonb_build_array('Exactly one current co-maker consent record is required.'); END IF;
      IF witness_count < (policy.config->>'witnessCount')::integer THEN blockers := blockers || jsonb_build_array('Required witness attestations have not been recorded for this packet.'); END IF;
    END IF;
  ELSE
    IF borrower_count = 0 THEN blockers := blockers || jsonb_build_array('Borrower consent evidence is not available.'); END IF;
    IF co_maker_count = 0 THEN blockers := blockers || jsonb_build_array('Co-maker consent evidence is not available.'); END IF;
    blockers := blockers || jsonb_build_array('Witness requirements are pending CSUCC configuration.');
  END IF;

  RETURN jsonb_build_object('packetHash', current_packet_hash, 'documents', documents,
    'requiredKinds', required_kinds, 'blockers', blockers,
    'policy', CASE WHEN policy.id IS NULL THEN NULL ELSE jsonb_build_object('id', policy.id, 'version', policy.version,
      'name', policy.name, 'status', policy.status, 'config', policy.config,
      'authorizationReference', policy.authorization_reference, 'createdAt', policy.created_at, 'createdBy', policy.created_by_name) END,
    'evidence', jsonb_build_object('borrower', borrower_count, 'coMaker', co_maker_count, 'witnesses', witness_count),
    'stateHash', encode(sha256(convert_to(jsonb_build_object('packet', current_packet_hash,
      'reviews', documents, 'evidence', evidence, 'policyId', policy.id, 'policyStatus', policy.status,
      'memberActive', member_active)::text, 'UTF8')), 'hex'));
END;
$function$;

REVOKE ALL ON FUNCTION public.private_application_verification_state(uuid) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
