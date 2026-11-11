BEGIN;
CREATE FUNCTION public.portal_record_consent_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE app_label text; event_key text; title text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.invalidated_at IS NOT DISTINCT FROM OLD.invalidated_at THEN RETURN NEW; END IF;
 SELECT application_id INTO app_label FROM public.loan_applications WHERE id=NEW.application_id;
 event_key:='consent:'||NEW.id::text||CASE WHEN TG_OP='UPDATE' THEN ':invalidated:'||txid_current() ELSE '' END;
 title:=CASE WHEN NEW.invalidated_at IS NULL THEN 'Loan consent evidence recorded' ELSE 'Loan consent evidence invalidated' END;
 PERFORM public.portal_emit_activity(event_key,'documents','consent_'||CASE WHEN NEW.invalidated_at IS NULL THEN 'recorded' ELSE 'invalidated' END,title,
  app_label||' · '||replace(NEW.kind,'_',' ')||' · '||title||'.','application',app_label,coalesce(auth.uid(),NEW.subject_user_id),NEW.subject_user_id,app_label||': '||title||'.');
 RETURN NEW;
END;
$$;
CREATE TRIGGER portal_consent_activity AFTER INSERT OR UPDATE ON public.application_consent_evidence FOR EACH ROW EXECUTE FUNCTION public.portal_record_consent_activity();
REVOKE ALL ON FUNCTION public.portal_record_consent_activity() FROM PUBLIC,anon,authenticated;
COMMIT;
