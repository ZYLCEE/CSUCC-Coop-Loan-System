-- Returning an incomplete application is a correction, not a committee decision.
-- Keep every other transition governed by the existing final-decision rules.
BEGIN;

CREATE OR REPLACE FUNCTION public.committee_transition_allowed(
  p_application uuid,p_old text,p_new text,p_caller name
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.application_final_decisions%ROWTYPE;
BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.document_staff_access()
  AND NOT EXISTS(SELECT 1 FROM public.loan_applications a JOIN public.members m ON m.id=a.member_id WHERE a.id=p_application AND m.user_id=auth.uid()) THEN RETURN false; END IF;
 IF p_new IS NOT DISTINCT FROM p_old OR NOT EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application) THEN RETURN true; END IF;
 -- Authenticated table updates must not bypass the trusted workflow procedure.
 IF p_caller NOT IN ('postgres','supabase_admin','service_role') THEN RETURN false; END IF;
 IF p_old IN ('pending','under review') AND p_new='returned'
  AND auth.uid() IS NOT NULL
  AND public.document_staff_access('applications.return')
  AND NOT EXISTS(SELECT 1 FROM public.application_final_decisions WHERE application_id=p_application)
  AND EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application AND stage='returned_for_requirements')
 THEN RETURN true; END IF;
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 IF d.application_id IS NOT NULL AND (
  (p_new=CASE WHEN d.decision='approve' THEN 'approved' ELSE 'rejected' END AND p_old IN ('pending','under review'))
  OR (d.decision='approve' AND ((p_old='approved' AND p_new='released') OR (p_old IN ('released','overdue') AND p_new IN ('overdue','completed'))))
 ) THEN RETURN true; END IF;
 RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.committee_transition_allowed(uuid,text,text,name) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.committee_transition_allowed(uuid,text,text,name) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
