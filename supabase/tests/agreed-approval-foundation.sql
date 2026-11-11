-- Forward migration. Email delivery is intentionally queued until configured.
BEGIN;
ALTER TABLE public.loan_applications DROP CONSTRAINT IF EXISTS loan_applications_status_check;
ALTER TABLE public.loan_applications ADD CONSTRAINT loan_applications_status_check CHECK(status IN ('pending','under review','returned','approved','rejected','released','completed','overdue'));
ALTER TABLE public.committee_policy_rules DROP CONSTRAINT committee_policy_rules_final_mode_check;
ALTER TABLE public.committee_policy_rules ADD CONSTRAINT committee_policy_rules_final_mode_check CHECK(final_mode IN ('super_admin','authorized_admin'));
ALTER TABLE public.application_final_decisions DROP CONSTRAINT application_final_decisions_mode_check;
ALTER TABLE public.application_final_decisions ADD CONSTRAINT application_final_decisions_mode_check CHECK(mode IN ('super_admin','authorized_admin'));
ALTER TABLE public.application_workflow_events DROP CONSTRAINT application_workflow_events_action_check;
ALTER TABLE public.application_workflow_events ADD CONSTRAINT application_workflow_events_action_check CHECK(action IN ('start','save_draft','mark_verified','return','resubmit'));

CREATE TABLE public.application_email_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid NOT NULL REFERENCES public.loan_applications(id),
 member_auth_id uuid NOT NULL REFERENCES auth.users(id),recipient_email text NOT NULL,subject text NOT NULL,message text NOT NULL,
 request_id uuid NOT NULL UNIQUE,notification_id uuid REFERENCES public.notifications(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,last_error text
);
ALTER TABLE public.application_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_email_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.application_email_outbox TO authenticated;
GRANT ALL ON public.application_email_outbox TO service_role;
CREATE POLICY staff_read_application_email_outbox ON public.application_email_outbox FOR SELECT TO authenticated USING(public.document_staff_access('applications.return'));

CREATE OR REPLACE FUNCTION public.pending_loan_workflow_status()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.status='under review' THEN NEW.status:='pending'; END IF;
 IF TG_OP='INSERT' AND NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'New loan applications must start as Pending.'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pending_loan_workflow_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER a_pending_loan_workflow_status BEFORE INSERT OR UPDATE OF status ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.pending_loan_workflow_status();

CREATE OR REPLACE FUNCTION public.committee_transition_allowed(p_application uuid,p_old text,p_new text,p_caller name)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.application_final_decisions%ROWTYPE;
BEGIN
 IF p_old IS NOT DISTINCT FROM p_new THEN RETURN true; END IF;
 IF p_caller NOT IN ('postgres','supabase_admin','service_role') THEN RETURN false; END IF;
 IF p_old IN ('pending','under review') AND p_new='returned' AND public.document_staff_access('applications.return') AND EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application AND stage='returned_for_requirements') THEN RETURN true; END IF;
 IF p_old='returned' AND p_new='pending' AND public.document_member_active() AND EXISTS(SELECT 1 FROM public.loan_applications a JOIN public.members m ON m.id=a.member_id WHERE a.id=p_application AND m.user_id=auth.uid()) THEN RETURN true; END IF;
 -- Preserve servicing of historical loans already approved before enrollment.
 IF NOT EXISTS(SELECT 1 FROM public.application_verifications WHERE application_id=p_application) AND public.document_staff_access()
 AND ((p_old='approved' AND p_new='released') OR (p_old IN ('released','overdue') AND p_new IN ('overdue','completed'))) THEN RETURN true; END IF;
 SELECT * INTO d FROM public.application_final_decisions WHERE application_id=p_application;
 RETURN d.application_id IS NOT NULL AND public.document_staff_access() AND (
  (p_old IN ('pending','under review') AND p_new=CASE WHEN d.decision='approve' THEN 'approved' ELSE 'rejected' END)
  OR (d.decision='approve' AND ((p_old='approved' AND p_new='released') OR (p_old IN ('released','overdue') AND p_new IN ('overdue','completed')))));
END;
$$;
