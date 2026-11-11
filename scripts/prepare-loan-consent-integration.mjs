import {readFileSync,writeFileSync} from 'node:fs';
const terms=JSON.parse(readFileSync('src/lib/borrowerTerms.ts','utf8').split('export const borrowerTerms=')[1].trim().replace(/;$/,''));
const version='csucc-loan-terms-2026-11-12-v1';
let sql=`-- Atomic borrower agreements and borrower-supplied witness names for new applications.
BEGIN;
CREATE TABLE IF NOT EXISTS public.loan_submission_agreements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL UNIQUE REFERENCES public.loan_applications(id),
 borrower_user_id uuid NOT NULL REFERENCES auth.users(id), packet_hash text NOT NULL,
 terms_accepted boolean NOT NULL CHECK(terms_accepted), information_certified boolean NOT NULL CHECK(information_certified),
 terms_version text NOT NULL, terms_text text NOT NULL, witness_names jsonb NOT NULL CHECK(jsonb_typeof(witness_names)='array'),
 accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loan_submission_agreements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loan_submission_agreements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.loan_submission_agreements TO authenticated;
GRANT ALL ON public.loan_submission_agreements TO service_role;
DROP POLICY IF EXISTS read_own_or_staff_agreements ON public.loan_submission_agreements;
CREATE POLICY read_own_or_staff_agreements ON public.loan_submission_agreements FOR SELECT TO authenticated
 USING(borrower_user_id=auth.uid() OR public.document_staff_access());

CREATE OR REPLACE FUNCTION public.submit_loan_with_agreements(p_application_id text,p_loan_type text,p_amount numeric,p_documents jsonb,p_tenure_months integer,
 p_terms_accepted boolean,p_information_certified boolean,p_terms_version text,p_witness_names jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE app_id uuid; packet text; receipt public.loan_submission_agreements%ROWTYPE; names jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_submit_loan_documents() THEN RAISE EXCEPTION 'An active member account is required.' USING ERRCODE='42501';END IF;
 IF p_terms_accepted IS DISTINCT FROM true OR p_information_certified IS DISTINCT FROM true THEN RAISE EXCEPTION 'Accept the Terms and Conditions and certify your application information.';END IF;
 IF p_terms_version IS DISTINCT FROM '${version}' THEN RAISE EXCEPTION 'The terms version changed. Update the app and review the agreement again.';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) amr
  WHERE amr->>'method'='otp' AND (amr->>'timestamp')::numeric BETWEEN extract(epoch FROM now()-interval '30 minutes') AND extract(epoch FROM now()+interval '1 minute'))
 THEN RAISE EXCEPTION 'Verify the borrower email with a fresh OTP before submitting.' USING ERRCODE='42501';END IF;
 IF p_witness_names IS NULL OR jsonb_typeof(p_witness_names) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Enter valid witness names.';END IF;
 IF jsonb_array_length(p_witness_names)>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_witness_names) n WHERE jsonb_typeof(n)<>'string' OR length(btrim(n#>>'{}')) NOT BETWEEN 1 AND 160 OR (n#>>'{}') ~ '[[:cntrl:]]')
 THEN RAISE EXCEPTION 'Enter up to two witness names, each at most 160 characters.';END IF;
 SELECT coalesce(jsonb_agg(btrim(n#>>'{}') ORDER BY position),'[]') INTO names FROM jsonb_array_elements(p_witness_names) WITH ORDINALITY x(n,position);
 IF (SELECT count(DISTINCT lower(n)) FROM jsonb_array_elements_text(names)n)<>jsonb_array_length(names) THEN RAISE EXCEPTION 'Enter different people in the witness fields.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_application_id,0));
 SELECT a.id INTO app_id FROM public.loan_applications a WHERE a.application_id=p_application_id;
 IF app_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.loan_submission_agreements r WHERE r.application_id=app_id AND r.borrower_user_id=auth.uid())
 THEN RAISE EXCEPTION 'This older application has no saved agreement. Start a new application reference after reviewing the terms.';END IF;
 app_id:=public.submit_loan_with_documents(p_application_id,p_loan_type,p_amount,p_documents,p_tenure_months);
 packet:=public.private_application_verification_state(app_id)->>'packetHash';
 SELECT * INTO receipt FROM public.loan_submission_agreements WHERE application_id=app_id;
 IF FOUND THEN
  IF receipt.borrower_user_id IS DISTINCT FROM auth.uid() OR receipt.witness_names IS DISTINCT FROM names OR receipt.terms_version IS DISTINCT FROM p_terms_version OR receipt.packet_hash IS DISTINCT FROM packet
  THEN RAISE EXCEPTION 'This saved application agreement changed. Start a new application reference.' USING ERRCODE='40001';END IF;
  RETURN app_id;
 END IF;
 INSERT INTO public.loan_submission_agreements(application_id,borrower_user_id,packet_hash,terms_accepted,information_certified,terms_version,terms_text,witness_names)
 VALUES(app_id,auth.uid(),packet,true,true,p_terms_version,$terms$${terms.join('\n\n')}$terms$,names) RETURNING * INTO receipt;
 INSERT INTO public.application_consent_evidence(id,application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at)
 SELECT receipt.id,app_id,'borrower',m.member_id,auth.uid(),'otp','Borrower agreement receipt: '||receipt.id,packet,receipt.accepted_at FROM public.members m WHERE m.user_id=auth.uid();
 RETURN app_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_loan_with_agreements(text,text,numeric,jsonb,integer,boolean,boolean,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_loan_with_agreements(text,text,numeric,jsonb,integer,boolean,boolean,text,jsonb) TO authenticated;
`;
let display=readFileSync('supabase/migrations/20261112020000_application_evidence_display.sql','utf8');
display=display.slice(display.indexOf('CREATE OR REPLACE FUNCTION'),display.indexOf("NOTIFY pgrst"));
display=display.replace("'status','recorded','source','consent_evidence')", "'status','recorded','source','consent_evidence','terms_accepted',agreement.terms_accepted,'information_certified',agreement.information_certified,'terms_version',agreement.terms_version,'terms_text',agreement.terms_text)");
display=display.replace('FROM public.application_consent_evidence e','FROM public.application_consent_evidence e\n  LEFT JOIN public.loan_submission_agreements agreement ON agreement.id=e.id');
display=display.replace(' ) proof;',`  UNION ALL
  SELECT receipt.accepted_at,jsonb_build_object('id',receipt.id::text||':witness:'||w.position,'kind','witness','subject_reference',w.name,'subject_name',w.name,
   'method','borrower_declaration','occurred_at',receipt.accepted_at,'evidence_reference','Loan application witness names','status','named','source','borrower_witness_names')
  FROM public.loan_submission_agreements receipt CROSS JOIN LATERAL jsonb_array_elements_text(receipt.witness_names) WITH ORDINALITY w(name,position)
  WHERE receipt.application_id=app.id AND receipt.packet_hash=p_packet_hash
 ) proof;`);
sql+=display+"NOTIFY pgrst,'reload schema';\nCOMMIT;\n";
writeFileSync('supabase/migrations/20261112030000_loan_submission_agreements.sql',sql);
console.log('Prepared receipt storage, atomic submission and evidence read model.');
