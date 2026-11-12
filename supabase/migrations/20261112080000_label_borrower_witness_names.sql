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
   'subject_reference',e.subject_reference,
   'subject_name',CASE WHEN e.kind='witness' THEN e.subject_reference ELSE coalesce(nullif(concat_ws(' ',person.first_name,person.last_name),''),e.subject_reference) END,
   'method',e.method,'occurred_at',e.occurred_at,'evidence_reference',e.evidence_reference,
   'status',CASE WHEN e.kind='witness' THEN 'named' WHEN e.kind='borrower' AND agreement.terms_accepted IS TRUE AND agreement.information_certified IS TRUE THEN 'approved' ELSE 'recorded' END,
   'source',CASE WHEN e.kind='witness' THEN 'borrower_witness_names' ELSE 'consent_evidence' END,
   'terms_accepted',agreement.terms_accepted,'information_certified',agreement.information_certified,
   'terms_version',agreement.terms_version,'terms_text',agreement.terms_text) AS record
  FROM public.application_consent_evidence e
  LEFT JOIN public.loan_submission_agreements agreement ON agreement.id=e.id
  LEFT JOIN LATERAL (SELECT m.first_name,m.last_name FROM public.members m WHERE
   (e.subject_user_id IS NOT NULL AND m.user_id=e.subject_user_id) OR m.member_id=e.subject_reference OR m.id::text=e.subject_reference OR m.user_id::text=e.subject_reference ORDER BY m.id LIMIT 1)person ON true
  WHERE e.application_id=app.id AND e.packet_hash=p_packet_hash AND e.invalidated_at IS NULL
   AND e.occurred_at<=now() AND (e.expires_at IS NULL OR e.expires_at>now())
  UNION ALL
  SELECT r.accepted_at,jsonb_build_object('id',r.id::text,'kind','co_maker','subject_reference',coalesce(m.member_id,r.co_maker_name),
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

COMMIT;
