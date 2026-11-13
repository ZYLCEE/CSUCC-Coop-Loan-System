BEGIN;
-- The existing function remains the authority for accepted evidence and packet
-- access. A pending/declined request is context, never completed consent.
CREATE FUNCTION public.portal_application_evidence(p_application_id text,p_packet_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;app public.loan_applications%ROWTYPE;response jsonb;request_key text;records jsonb;
BEGIN
 output:=public.application_evidence_details(p_application_id,p_packet_hash);
 SELECT * INTO STRICT app FROM public.loan_applications WHERE application_id=p_application_id;
 request_key:=to_jsonb(app)->>'co_maker_request_id';
 SELECT to_jsonb(r)||jsonb_build_object('member_reference',coalesce(m.member_id,r.co_maker_name)) INTO response
 FROM public.co_maker_requests r LEFT JOIN public.members m ON m.id=r.co_maker_member_id
 WHERE r.id::text=request_key AND r.application_id=app.application_id AND r.borrower_member_id=app.member_id AND r.co_maker_member_id=app.co_maker_member_id;
 IF response IS NOT NULL AND response->>'status' IN ('pending','declined','rejected','expired','cancelled') THEN
  records:=coalesce(output->'records','[]')||jsonb_build_array(jsonb_build_object('id',response->>'id','kind','co_maker','subject_name',response->>'co_maker_name',
   'subject_reference',response->>'member_reference','relationship',response->>'relationship','method','member_request','source','co_maker_request',
   'status',CASE response->>'status' WHEN 'rejected' THEN 'declined' WHEN 'cancelled' THEN 'invalidated' ELSE response->>'status' END,
   'occurred_at',coalesce(response->>'responded_at',response->>'declined_at',response->>'updated_at',response->>'created_at'),
   'decision_reason',coalesce(response->>'decline_reason',response->>'rejection_reason',response->>'reason'),'evidence_reference',response->>'id'));
  output:=jsonb_set(output,'{records}',records);
 END IF;
 RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_application_evidence(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.portal_application_evidence(text,text) TO authenticated,service_role;
-- Run after native consent processing so an existing personal response notice
-- can be reused instead of sending a second notice for the same outcome.
CREATE FUNCTION public.portal_co_maker_response_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE response jsonb:=to_jsonb(NEW);app public.loan_applications%ROWTYPE;owner uuid;owner_message text;reason text;notice_title text;existing boolean;existing_notice uuid;
BEGIN
 IF response->>'status' IS NULL OR response->>'status' NOT IN ('accepted','declined','rejected') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW;END IF;
 SELECT * INTO app FROM public.loan_applications WHERE application_id=response->>'application_id'
 AND id IS NOT NULL AND to_jsonb(loan_applications)->>'co_maker_request_id'=response->>'id'
 AND member_id::text=response->>'borrower_member_id' AND co_maker_member_id::text=response->>'co_maker_member_id';
 IF app.id IS NULL OR (response->>'status'='accepted' AND response->>'accepted_at' IS NULL) THEN RETURN NEW;END IF;
 SELECT user_id INTO owner FROM public.members WHERE id=app.member_id;
 IF response->>'status'='accepted' THEN notice_title:='Co-maker consent received';owner_message:=format('Your co-maker has approved the consent request for application %s. You can view the recorded consent in the app.',app.application_id);
 ELSE notice_title:='Co-maker consent declined';reason:=coalesce(response->>'decline_reason',response->>'rejection_reason');owner_message:=format('Your co-maker declined the consent request for application %s. %s Open the app to review the response and available next steps.',app.application_id,CASE WHEN reason IS NOT NULL THEN 'Reason: '||reason||'.' ELSE '' END);END IF;
 SELECT EXISTS(SELECT 1 FROM public.notifications n WHERE n.user_id=owner AND n.created_at>=transaction_timestamp()
  AND (n.data->>'request_id'=response->>'id' OR (n.data->>'entityKey'=app.application_id AND n.title IN ('Co-maker consent received','Co-maker consent declined')))) INTO existing;
 IF existing THEN
  SELECT n.id INTO existing_notice FROM public.notifications n WHERE n.user_id=owner AND n.created_at>=transaction_timestamp() AND (n.data->>'request_id'=response->>'id' OR (n.data->>'entityKey'=app.application_id AND n.title IN ('Co-maker consent received','Co-maker consent declined'))) ORDER BY n.created_at DESC LIMIT 1;
  UPDATE public.notifications SET title=notice_title,message=owner_message,data=coalesce(data,'{}')||jsonb_build_object('category','documents','entityType','application','entityKey',app.application_id,'event','co_maker_'||(response->>'status')) WHERE id=existing_notice;
  INSERT INTO public.application_email_outbox(application_id,member_auth_id,recipient_email,subject,message,request_id,notification_id)
   SELECT app.id,owner,u.email,notice_title,owner_message,existing_notice,existing_notice FROM auth.users u WHERE u.id=owner AND u.email_confirmed_at IS NOT NULL ON CONFLICT DO NOTHING;
  UPDATE public.application_email_outbox SET subject=notice_title,message=owner_message WHERE notification_id=existing_notice AND status='queued' AND attempts=0 AND delivery_payload IS NULL;
 END IF;
 PERFORM public.portal_emit_activity('co_maker_response:'||(response->>'id')||':'||(response->>'status'),'documents','co_maker_'||(response->>'status'),notice_title,app.application_id||' ? '||notice_title,'application',app.application_id,auth.uid(),CASE WHEN existing THEN NULL ELSE owner END,CASE WHEN existing THEN NULL ELSE owner_message END);
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER portal_co_maker_response_notice AFTER UPDATE ON public.co_maker_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.portal_co_maker_response_notice();
REVOKE ALL ON FUNCTION public.portal_co_maker_response_notice() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
