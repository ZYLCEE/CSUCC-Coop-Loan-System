-- Test-only stand-ins for the password-verified Next.js server. Never deployed.
CREATE FUNCTION pg_temp.committee_reserve_invite(p_request_id uuid,p_attempt_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_reserve_invite',jsonb_build_object('p_request_id',p_request_id,'p_attempt_id',p_attempt_id,'p_payload',p_payload));
$$;
CREATE FUNCTION pg_temp.committee_finish_invite(p_request_id uuid,p_attempt_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_finish_invite',jsonb_build_object('p_request_id',p_request_id,'p_attempt_id',p_attempt_id,'p_user_id',p_user_id));
$$;
CREATE FUNCTION pg_temp.committee_change_membership(p_id uuid,p_revision integer,p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_change_membership',jsonb_build_object('p_id',p_id,'p_revision',p_revision,'p_action',p_action,'p_payload',p_payload,'p_request_id',p_request_id));
$$;
CREATE FUNCTION pg_temp.committee_begin_link(p_id uuid,p_revision integer,p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_begin_link',jsonb_build_object('p_id',p_id,'p_revision',p_revision,'p_request_id',p_request_id,'p_attempt_id',p_attempt_id));
$$;
CREATE FUNCTION pg_temp.committee_finish_link(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.committee_account_action(auth.uid(),'committee_finish_link',jsonb_build_object('p_request_id',p_request_id,'p_attempt_id',p_attempt_id));
$$;
