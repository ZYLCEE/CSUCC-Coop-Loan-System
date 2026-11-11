-- Atomic borrower agreements and borrower-supplied witness names for new applications.
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
 IF p_terms_version IS DISTINCT FROM 'csucc-loan-terms-2026-11-12-v1' THEN RAISE EXCEPTION 'The terms version changed. Update the app and review the agreement again.';END IF;
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
 VALUES(app_id,auth.uid(),packet,true,true,p_terms_version,$terms$1. The loan shall be payable in __________ mo/s. with monthly amortization of PhP __________ thru salary deduction/ATM retention or issuance of PDC to commence on the payroll date immediately succeeding the date of loan granted.

2. The borrower hereby agrees to pay the 2% interest per month. The borrower also agrees that the above interest rate of the loan as well as all fees and charges under this agreement/note maybe increase by the coop anytime during the term of the loan if CSUCC ER MPC so requires. The borrower shall be notified of the increase which shall take effect on the next scheduled amortization.

3. The borrower that in case of his transfer of assignment where he/she no longer receives his salary from his former station, the loan shall become due and demandable.

4. In the event the borrower is TERMINATED/SEPARATED from CSU Cabadbaran City (CSUCC), (a) the borrower's outstanding loan shall become Due and Demandable; (b) the borrower hereby agrees that all his salaries, bonuses, separation/gratuity pay, retirement benefits, and all other benefits due to him from his/employer and from any other sources (SSS, GSIS, etc.) shall be withheld by his/her employer and remitted to the CSUCC ER MPC to settle the borrower's outstanding loan; (c) if the outstanding loan plus all interest thereon have been fully settled by the borrower (d) if the amount collected from the borrower is insufficient to cover the borrower's outstanding obligation with the coop, the Co-Maker agrees to settle the balance of the loan and authorizes the Head of Office/Disbursing Officer to withhold his/her Payroll until the loan balance has been settled:

5. In the event the Co-maker is terminated/separated from service with CSU Cabadbaran City (CSUCC), the borrower shall submit to the Coop a qualified and acceptable replacement of the Co-maker for the loan as determined by the Coop within ten (10) days from termination/separation of the co-maker. Failure to do so shall constitute an event of Default hereunder.

6. The Borrower and Co-maker shall be jointly and severally liable to the CSUCC ER MPC for the full payment and complete performance of such obligation from any one of them;

7. The borrower and co-maker hereby assign in favor of CSUCC ER MPC their salaries, allowances, bonuses, retirement benefits, separation/gratuity pay, monetary value of their accumulated leave credits/service credits and other monies/benefits (collectively referred to as receivable) due to them from their employer, SSS, GSIS or from whatever source. The liability of the borrower and co-maker under this assignment shall extend to all renewals and/or extensions of time of payment of the loan plus all interest thereon. To affect above assignment, the borrower and co-maker irrevocably appoint and constitute CSUCC ER MPC as their True and Lawful Attorney-In-Fact with full power and authority to apply or use the proceeds of the Receivables in payment of the loan plus interest thereon, to collect the amounts due hereunder and endorsed any checks or other instruments and to file any claims on institute any proceedings which are necessary to protect the bank's right under the Assignment.

8. The borrower agrees and authorizes CSUCC ER MPC to act as his agent to, (a) periodically deduct from his/her salary and other remuneration the amortization of the loan and (b) remit the same to CSUCC ER MPC not later than the 10th banking after each payroll date without demand, protest or notice of any kind;

9. The borrower agrees that any legal action suit or proceedings arising out or relating to this agreement/note, or other documentation contemplated hereby maybe instituted by the CSUCC ER MPC and its option in the appropriate Courts of Agusan del Norte or in any other jurisdiction where the assets or properties of the borrowers, maybe found. The borrower hereby irrevocably submits himself to the jurisdiction of such courts;

10. The borrower shall pay the CSUCC ER MPC reasonable attorney's fees which shall be in the amount equal to twenty (20%) percent of the total amount due, regardless of whether or not CSUCC ER MPC institutes suit for purposes of collection and any and all cost of litigation the event CSUCC ER MPC is constrained to institute a court suit to enforce collection of amounts due hereunder or for breach of any terms of this agreement/note;

11. The borrower agrees to pay a service fee of One percent (1%) of the loaned amount.

12. Violation from the Terms and Conditions shall make the Loan DUE and DEMANDABLE.$terms$,names) RETURNING * INTO receipt;
 INSERT INTO public.application_consent_evidence(id,application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at)
 SELECT receipt.id,app_id,'borrower',m.member_id,auth.uid(),'otp','Borrower agreement receipt: '||receipt.id,packet,receipt.accepted_at FROM public.members m WHERE m.user_id=auth.uid();
 RETURN app_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_loan_with_agreements(text,text,numeric,jsonb,integer,boolean,boolean,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_loan_with_agreements(text,text,numeric,jsonb,integer,boolean,boolean,text,jsonb) TO authenticated;
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
   'method',e.method,'occurred_at',e.occurred_at,'evidence_reference',e.evidence_reference,'status','recorded','source','consent_evidence','terms_accepted',agreement.terms_accepted,'information_certified',agreement.information_certified,'terms_version',agreement.terms_version,'terms_text',agreement.terms_text) AS record
  FROM public.application_consent_evidence e
  LEFT JOIN public.loan_submission_agreements agreement ON agreement.id=e.id
  LEFT JOIN LATERAL (SELECT m.first_name,m.last_name FROM public.members m WHERE
   (e.subject_user_id IS NOT NULL AND m.user_id=e.subject_user_id) OR m.member_id=e.subject_reference OR m.id::text=e.subject_reference OR m.user_id::text=e.subject_reference ORDER BY m.id LIMIT 1)person ON true
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
  UNION ALL
  SELECT receipt.accepted_at,jsonb_build_object('id',receipt.id::text||':witness:'||w.position,'kind','witness','subject_reference',w.name,'subject_name',w.name,
   'method','borrower_declaration','occurred_at',receipt.accepted_at,'evidence_reference','Loan application witness names','status','named','source','borrower_witness_names')
  FROM public.loan_submission_agreements receipt CROSS JOIN LATERAL jsonb_array_elements_text(receipt.witness_names) WITH ORDINALITY w(name,position)
  WHERE receipt.application_id=app.id AND receipt.packet_hash=p_packet_hash
 ) proof;
 RETURN jsonb_build_object('records',records);
END;
$$;
REVOKE ALL ON FUNCTION public.application_evidence_details(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.application_evidence_details(text,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
