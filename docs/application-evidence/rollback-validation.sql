-- Read existing consent records and the application's attached co-maker approval.
-- This does not fabricate signatures or alter verification/approval requirements.
BEGIN;
CREATE OR REPLACE FUNCTION public.application_evidence_details(p_application_id text,p_packet_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb; app public.loan_applications%ROWTYPE; records jsonb;
BEGIN
 IF NOT public.document_staff_access() THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501';END IF;
 state:=public.get_application_verification(p_application_id);
 IF p_packet_hash IS DISTINCT FROM state->>'packetHash' THEN RAISE EXCEPTION 'The application changed. Refresh before viewing its evidence.' USING ERRCODE='40001';END IF;
 SELECT * INTO STRICT app FROM public.loan_applications WHERE id=(state->>'applicationUuid')::uuid;
 SELECT coalesce(jsonb_agg(record ORDER BY occurred DESC),'[]') INTO records FROM (
  SELECT e.occurred_at AS occurred,jsonb_build_object('id',e.id,'kind',e.kind,
   'subject_reference',e.subject_reference,'subject_name',coalesce(nullif(concat_ws(' ',person.first_name,person.last_name),''),e.subject_reference),
   'method',e.method,'occurred_at',e.occurred_at,'evidence_reference',e.evidence_reference,'status','recorded','source','consent_evidence') AS record
  FROM public.application_consent_evidence e
  LEFT JOIN LATERAL (SELECT m.first_name,m.last_name FROM public.members m WHERE
   (e.subject_user_id IS NOT NULL AND m.user_id=e.subject_user_id) OR m.member_id=e.subject_reference ORDER BY m.id LIMIT 1)person ON true
  WHERE e.application_id=app.id AND e.packet_hash=p_packet_hash AND e.invalidated_at IS NULL
   AND e.occurred_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now())
  UNION ALL
  SELECT r.accepted_at,jsonb_build_object('id',r.id,'kind','co_maker','subject_reference',coalesce(m.member_id,r.co_maker_name),
   'subject_name',r.co_maker_name,'method','member_approval','occurred_at',r.accepted_at,'evidence_reference',r.id,
   'status','approved','source','co_maker_request','relationship',r.relationship,'borrower_name',r.borrower_name,
   'amount',r.amount,'tenure_months',r.tenure_months,'loan_type',r.loan_type)
  FROM public.co_maker_requests r LEFT JOIN public.members m ON m.id=r.co_maker_member_id
  WHERE r.id=app.co_maker_request_id AND r.application_id=app.application_id AND r.co_maker_member_id=app.co_maker_member_id
   AND r.borrower_member_id=app.member_id AND r.status='accepted' AND r.accepted_at IS NOT NULL AND r.accepted_at<=now()
 ) proof;
 RETURN jsonb_build_object('records',records);
END;
$$;
REVOKE ALL ON FUNCTION public.application_evidence_details(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.application_evidence_details(text,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';

DO $test$
DECLARE actor uuid; packet text; result jsonb; denied boolean:=false;
BEGIN
 SELECT id INTO STRICT actor FROM auth.users WHERE raw_app_meta_data->>'role'='super_admin' AND coalesce(raw_app_meta_data->>'account_status','active')='active' LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 packet:=public.get_application_verification('LA-2026-964420')->>'packetHash';
 result:=public.application_evidence_details('LA-2026-964420',packet);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'records') r WHERE r->>'kind'='co_maker' AND r->>'status'='approved' AND r->>'subject_name'='Kenneth Baldomar') THEN RAISE EXCEPTION 'Saved co-maker approval not displayed';END IF;
 BEGIN PERFORM public.application_evidence_details('LA-2026-964420',repeat('0',64));EXCEPTION WHEN serialization_failure THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale packet accepted';END IF;
 SELECT user_id INTO actor FROM public.members WHERE id=(SELECT member_id FROM public.loan_applications WHERE application_id='LA-2026-964420');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);denied:=false;
 BEGIN PERFORM public.application_evidence_details('LA-2026-964420',packet);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Borrower admitted to staff evidence view';END IF;
END;
$test$;
SELECT 'PASS: saved co-maker approval and name displayed; stale packets and non-staff denied; no loan or consent records changed' AS validation;
ROLLBACK;
