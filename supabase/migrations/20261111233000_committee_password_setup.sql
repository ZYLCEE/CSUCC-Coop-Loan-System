-- Temporary-password reviewers complete their own setup without requiring an email invitation.
BEGIN;
CREATE OR REPLACE FUNCTION public.committee_complete_setup(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.staff_memberships%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 SELECT * INTO m FROM public.staff_memberships WHERE auth_user_id=u.id AND role=u.raw_app_meta_data->>'role' ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;
 IF m.id IS NULL OR NOT m.active OR m.ends_at<=now() OR u.email_confirmed_at IS NULL
  OR coalesce(u.raw_app_meta_data->>'account_status','active')<>'active' OR u.banned_until>now()
  OR (m.role='bod_member' AND NOT public.committee_bod_enabled()) OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id)
  OR (u.invited_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.committee_account_requests r
    WHERE r.id=m.invitation_request_id AND r.kind='invite' AND r.state='complete' AND r.auth_user_id=u.id AND r.membership_id=m.id
    AND r.payload->>'provisioningMode'='password' AND u.raw_app_meta_data->>'committee_invitation_request_id'=r.id::text)) OR length(coalesce(u.encrypted_password,''))=0 THEN RAISE EXCEPTION 'Complete a valid account invitation and password setup first.' USING ERRCODE='42501'; END IF;
 IF m.setup_completed_at IS NULL THEN
  UPDATE public.staff_memberships SET setup_completed_at=clock_timestamp(),revision=revision+1 WHERE id=m.id;
  INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details) VALUES(u.id,'committee-own-setup',m.id::text,'success','{}');
 END IF;
 RETURN jsonb_build_object('success',true);
END;
$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
