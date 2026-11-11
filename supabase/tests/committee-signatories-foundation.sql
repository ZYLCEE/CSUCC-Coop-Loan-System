-- Four signatory positions confirmed from the manual form. No accounts or policies activated.
BEGIN;
ALTER TABLE public.staff_memberships ADD COLUMN committee_seat text NOT NULL DEFAULT 'member' CHECK(committee_seat IN ('member','chairperson'));
ALTER TABLE public.review_assignments ADD COLUMN signatory_role text CHECK(signatory_role IN ('crecom_member','crecom_chairperson','bod_chairperson'));
ALTER TABLE public.individual_review_decisions ADD COLUMN signatory_role text CHECK(signatory_role IN ('crecom_member','crecom_chairperson','bod_chairperson'));
ALTER TABLE public.committee_policy_rules ADD COLUMN signatory_layout text NOT NULL DEFAULT 'manual_form_v1' CHECK(signatory_layout='manual_form_v1');
-- Legacy records are not relabelled as chairperson confirmations. New records need a trusted position.
CREATE FUNCTION public.committee_guard_signatory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected text;
BEGIN
 IF TG_TABLE_NAME='review_assignments' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW.signatory_role IS DISTINCT FROM OLD.signatory_role OR NEW.membership_id<>OLD.membership_id OR NEW.reviewer_auth_id<>OLD.reviewer_auth_id OR NEW.review_cycle_id<>OLD.review_cycle_id THEN RAISE EXCEPTION 'The assigned signatory position is immutable. Use reassignment.'; END IF;
  ELSE
   SELECT CASE WHEN c.stage='CRECOM' AND m.role='crecom_member' THEN CASE WHEN m.committee_seat='chairperson' THEN 'crecom_chairperson' ELSE 'crecom_member' END
     WHEN c.stage='BOD' AND m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' END INTO expected
   FROM public.staff_memberships m JOIN public.application_review_cycles c ON c.id=NEW.review_cycle_id WHERE m.id=NEW.membership_id AND m.auth_user_id=NEW.reviewer_auth_id;
   IF expected IS NULL OR NEW.signatory_role IS DISTINCT FROM expected THEN RAISE EXCEPTION 'The assigned position must match the trusted committee membership.'; END IF;
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.application_review_cycles c ON c.id=a.review_cycle_id
    WHERE a.id=NEW.assignment_id AND a.reviewer_auth_id=NEW.reviewer_auth_id AND a.signatory_role=NEW.signatory_role AND c.packet_version=NEW.packet_version) THEN RAISE EXCEPTION 'The confirmation must preserve the assigned signatory position and packet version.'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER freeze_assigned_signatory BEFORE INSERT OR UPDATE ON public.review_assignments FOR EACH ROW EXECUTE FUNCTION public.committee_guard_signatory();
CREATE TRIGGER confirm_assigned_signatory BEFORE INSERT ON public.individual_review_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_guard_signatory();
CREATE FUNCTION public.committee_signatories_complete(p_cycle uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT CASE WHEN c.stage='CRECOM' THEN c.reviewer_target=3 AND c.required_approvals=3
    AND count(*)=3 AND count(*) FILTER(WHERE a.signatory_role='crecom_member')=2 AND count(*) FILTER(WHERE a.signatory_role='crecom_chairperson')=1
   ELSE c.reviewer_target=1 AND c.required_approvals=1 AND count(*)=1 AND count(*) FILTER(WHERE a.signatory_role='bod_chairperson')=1 END
  AND count(DISTINCT a.reviewer_auth_id)=count(*) AND bool_and(a.state='decision_recorded' AND d.id IS NOT NULL AND d.signatory_role=a.signatory_role AND d.packet_version=c.packet_version AND d.reviewer_auth_id=a.reviewer_auth_id)
 FROM public.application_review_cycles c JOIN public.review_assignments a ON a.review_cycle_id=c.id
 LEFT JOIN public.individual_review_decisions d ON d.assignment_id=a.id
 WHERE c.id=p_cycle AND c.status='completed' AND a.state NOT IN ('cancelled','reassigned') GROUP BY c.id),false);
$$;
REVOKE ALL ON FUNCTION public.committee_guard_signatory(),public.committee_signatories_complete(uuid) FROM PUBLIC,anon,authenticated;
