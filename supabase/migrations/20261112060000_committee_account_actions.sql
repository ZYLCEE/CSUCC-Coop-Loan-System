-- Password-confirmed committee account actions. No historical review is deleted.
BEGIN;
ALTER TABLE public.staff_memberships ADD COLUMN account_deleted_at timestamptz,
 ADD COLUMN account_action_id uuid;
CREATE TABLE public.committee_credential_actions(
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES auth.users(id),
 membership_id uuid NOT NULL REFERENCES public.staff_memberships(id),
 auth_user_id uuid NOT NULL REFERENCES auth.users(id), operation text NOT NULL CHECK(operation IN ('reset','delete')),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','failed','complete','superseded')),
 attempt_id uuid NOT NULL, lease_until timestamptz, was_active boolean NOT NULL,
 account_name text NOT NULL, email text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 result jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.staff_memberships ADD CONSTRAINT committee_pending_account_action_fk
 FOREIGN KEY(account_action_id) REFERENCES public.committee_credential_actions(id);
ALTER TABLE public.committee_credential_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_credential_actions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.committee_guard_account_action() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (OLD.account_deleted_at IS NOT NULL OR OLD.account_action_id IS NOT NULL)
  AND coalesce(current_setting('coop.committee_credential_write',true),'')<>'true' THEN
  RAISE EXCEPTION 'This account is deleted or a credential action is pending. Refresh Committee Accounts.' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER committee_guard_account_action BEFORE UPDATE ON public.staff_memberships
 FOR EACH ROW EXECUTE FUNCTION public.committee_guard_account_action();

CREATE FUNCTION public.committee_begin_credential_action(p_id uuid,p_revision integer,p_operation text,p_request_id uuid,p_attempt_id uuid,p_fingerprint text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.staff_memberships%ROWTYPE;u auth.users%ROWTYPE;r public.committee_credential_actions%ROWTYPE;
 prior public.committee_credential_actions%ROWTYPE;was_active boolean;label_name text;label_email text;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501';END IF;
 IF p_operation IS NULL OR p_operation NOT IN ('reset','delete') OR p_request_id IS NULL OR p_attempt_id IS NULL
  OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Choose a valid committee account action and reason.';END IF;
 -- A per-membership lock serializes account changes; completed retries need no Auth write.
 SELECT * INTO STRICT m FROM public.staff_memberships WHERE id=p_id FOR UPDATE;
 SELECT * INTO r FROM public.committee_credential_actions WHERE id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.actor_id<>auth.uid() OR r.membership_id<>p_id OR r.operation<>p_operation OR r.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'This account action reference was already used.' USING ERRCODE='40001';END IF;
  IF r.state='complete' THEN RETURN jsonb_build_object('complete',true,'result',r.result);END IF;
  IF r.state='superseded' OR m.account_action_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'This action was replaced. Refresh Committee Accounts.' USING ERRCODE='40001';END IF;
  IF r.lease_until>now() THEN RAISE EXCEPTION 'An account action is already being processed. Wait before retrying.' USING ERRCODE='55P03';END IF;
 ELSE
  IF m.revision IS DISTINCT FROM p_revision OR m.account_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Committee account changed. Refresh before continuing.' USING ERRCODE='40001';END IF;
 END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=m.auth_user_id FOR UPDATE;
 IF (SELECT count(*) FROM public.staff_memberships WHERE auth_user_id=u.id)<>1 THEN RAISE EXCEPTION 'This sign-in account has multiple memberships. Reconcile its membership records before changing credentials.';END IF;
 IF u.id=auth.uid() OR u.deleted_at IS NOT NULL AND NOT (p_operation='delete' AND m.account_action_id IS NOT NULL)
  OR (u.deleted_at IS NULL AND (u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role OR m.role NOT IN ('crecom_member','bod_member')))
  OR EXISTS(SELECT 1 FROM public.members WHERE user_id=u.id) THEN RAISE EXCEPTION 'Choose a separate, verified committee sign-in account.' USING ERRCODE='42501';END IF;
 IF r.id IS NULL THEN
  was_active:=m.active;
  label_name:=coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.email,''),'Committee reviewer');label_email:=coalesce(u.email,'');
  IF m.account_action_id IS NOT NULL THEN
   SELECT * INTO STRICT prior FROM public.committee_credential_actions WHERE id=m.account_action_id FOR UPDATE;
   IF prior.lease_until>now() THEN RAISE EXCEPTION 'An account action is already being processed. Wait before retrying.' USING ERRCODE='55P03';END IF;
   -- A failed/expired request can be replaced without remembering its temporary password.
   was_active:=prior.was_active;
   label_name:=prior.account_name;label_email:=prior.email;
   UPDATE public.committee_credential_actions SET state='superseded',lease_until=null WHERE id=prior.id;
  END IF;
  INSERT INTO public.committee_credential_actions(id,actor_id,membership_id,auth_user_id,operation,fingerprint,attempt_id,lease_until,was_active,account_name,email,reason)
  VALUES(p_request_id,auth.uid(),m.id,u.id,p_operation,p_fingerprint,p_attempt_id,now()+interval '90 seconds',was_active,label_name,label_email,btrim(p_reason)) RETURNING * INTO r;
  PERFORM set_config('coop.committee_credential_write','true',true);
  UPDATE public.staff_memberships SET active=false,setup_completed_at=null,account_action_id=r.id,revision=revision+1 WHERE id=m.id;
  PERFORM set_config('coop.committee_credential_write','',true);
 ELSE
  UPDATE public.committee_credential_actions SET state='pending',attempt_id=p_attempt_id,lease_until=now()+interval '90 seconds' WHERE id=r.id;
 END IF;
 RETURN jsonb_build_object('complete',false,'userId',u.id,'email',r.email,'role',m.role,'authDeleted',u.deleted_at IS NOT NULL);
END;
$$;

CREATE FUNCTION public.committee_finish_credential_action(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.committee_credential_actions%ROWTYPE;m public.staff_memberships%ROWTYPE;u auth.users%ROWTYPE;output jsonb;
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501';END IF;
 -- Lock the membership before its request, matching the begin function lock order.
 SELECT sm.* INTO STRICT m FROM public.staff_memberships sm JOIN public.committee_credential_actions a ON a.membership_id=sm.id WHERE a.id=p_request_id FOR UPDATE OF sm;
 SELECT * INTO STRICT r FROM public.committee_credential_actions WHERE id=p_request_id FOR UPDATE;
 IF r.actor_id<>auth.uid() THEN RAISE EXCEPTION 'This action belongs to another administrator.' USING ERRCODE='42501';END IF;
 IF r.state='complete' THEN RETURN r.result;END IF;
 IF r.state<>'pending' OR r.attempt_id IS DISTINCT FROM p_attempt_id OR r.lease_until<=now() OR m.account_action_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'This account action changed. Retry the saved request.' USING ERRCODE='40001';END IF;
 SELECT * INTO STRICT u FROM auth.users WHERE id=r.auth_user_id;
 IF r.operation='reset' AND (u.deleted_at IS NOT NULL OR u.raw_app_meta_data->>'committee_credential_action_id' IS DISTINCT FROM r.id::text
  OR u.raw_app_meta_data->>'role' IS DISTINCT FROM m.role) THEN RAISE EXCEPTION 'The password update could not be confirmed.';END IF;
 IF r.operation='delete' AND u.deleted_at IS NULL THEN RAISE EXCEPTION 'The account deletion could not be confirmed.';END IF;
 PERFORM set_config('coop.committee_credential_write','true',true);
 UPDATE public.staff_memberships SET active=CASE WHEN r.operation='reset' THEN r.was_active ELSE false END,
  setup_completed_at=null,account_action_id=null,account_deleted_at=CASE WHEN r.operation='delete' THEN clock_timestamp() ELSE null END,revision=revision+1 WHERE id=m.id;
 PERFORM set_config('coop.committee_credential_write','',true);
 IF r.operation='delete' THEN
  -- Preserve the original invite payload, but release its email uniqueness slot.
  UPDATE public.committee_account_requests SET email='deleted+'||id::text||'@accounts.invalid' WHERE auth_user_id=u.id AND kind='invite';
 END IF;
 output:=jsonb_build_object('success',true,'message',CASE WHEN r.operation='reset' THEN 'Temporary password reset. The reviewer must choose their own password on the next sign-in.' ELSE 'Committee sign-in account deleted. Recorded decisions and assignment history were retained.' END);
 UPDATE public.committee_credential_actions SET state='complete',lease_until=null,result=output WHERE id=r.id;
 INSERT INTO public.admin_activity_logs(actor_id,action_name,target_id,result,details)
 VALUES(auth.uid(),CASE WHEN r.operation='reset' THEN 'committee-password-reset' ELSE 'committee-account-delete' END,m.id::text,'success',jsonb_build_object('requestId',r.id,'name',r.account_name,'reason',r.reason,'role',m.role));
 RETURN output;
END;
$$;

CREATE FUNCTION public.committee_fail_credential_action(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501';END IF;
 UPDATE public.committee_credential_actions SET state='failed',lease_until=null WHERE id=p_request_id AND actor_id=auth.uid() AND attempt_id=p_attempt_id AND state='pending';
 -- Keep access suspended until an administrator finishes or replaces the request.
 RETURN '{"success":true}';
END;
$$;

-- Preserve the existing role/position/date validation and add real name editing.
ALTER FUNCTION public.committee_change_membership(uuid,integer,text,jsonb,uuid) RENAME TO committee_change_membership_before_account_actions;
CREATE FUNCTION public.committee_change_membership(p_id uuid,p_revision integer,p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;full_name text:=btrim(coalesce(p_payload->>'name',''));
BEGIN
 IF p_action='edit' AND p_payload ? 'name' AND (length(full_name) NOT BETWEEN 1 AND 160 OR full_name ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'Enter a full name of up to 160 characters.';END IF;
 output:=public.committee_change_membership_before_account_actions(p_id,p_revision,p_action,p_payload,p_request_id);
 IF p_action='edit' AND p_payload ? 'name' THEN
  UPDATE auth.users u SET raw_user_meta_data=coalesce(u.raw_user_meta_data,'{}')||jsonb_build_object('full_name',full_name)
   FROM public.staff_memberships m WHERE m.id=p_id AND u.id=m.auth_user_id AND m.revision=(output->>'revision')::integer;
 END IF;
 RETURN output;
END;
$$;

ALTER FUNCTION public.committee_accounts() RENAME TO committee_accounts_before_account_actions;
CREATE FUNCTION public.committee_accounts() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE output jsonb;rows jsonb;
BEGIN
 output:=public.committee_accounts_before_account_actions();
 SELECT coalesce(jsonb_agg(a.value||CASE WHEN m.account_action_id IS NOT NULL THEN jsonb_build_object('status','recovery_pending','name',c.account_name,'email',c.email) WHEN m.id IS NOT NULL AND NOT m.active THEN jsonb_build_object('status','blocked') ELSE '{}'::jsonb END ORDER BY a.value->>'email'),'[]')
 INTO rows FROM jsonb_array_elements(output->'accounts') a LEFT JOIN public.staff_memberships m ON m.id=(a.value->>'id')::uuid
 LEFT JOIN public.committee_credential_actions c ON c.id=m.account_action_id WHERE m.account_deleted_at IS NULL;
 RETURN output||jsonb_build_object('accounts',rows,'accountActionsVersion',1);
END;
$$;

-- The existing service-only dispatcher still enforces the acting Admin privilege.
ALTER FUNCTION public.committee_account_action(uuid,text,jsonb) RENAME TO committee_account_action_before_credentials;
CREATE FUNCTION public.committee_account_action(p_actor_id uuid,p_operation text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous_subject text:=current_setting('request.jwt.claim.sub',true);output jsonb;
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'Active administrator access is required.' USING ERRCODE='42501';END IF;
 PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501';END IF;
 IF p_operation='committee_begin_credential_action' THEN
  output:=public.committee_begin_credential_action((p_args->>'p_id')::uuid,(p_args->>'p_revision')::integer,p_args->>'p_operation',(p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid,p_args->>'p_fingerprint',p_args->>'p_reason');
 ELSIF p_operation='committee_finish_credential_action' THEN output:=public.committee_finish_credential_action((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid);
 ELSIF p_operation='committee_fail_credential_action' THEN output:=public.committee_fail_credential_action((p_args->>'p_request_id')::uuid,(p_args->>'p_attempt_id')::uuid);
 ELSE output:=public.committee_account_action_before_credentials(p_actor_id,p_operation,p_args);
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RETURN output;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.committee_guard_account_action(),public.committee_begin_credential_action(uuid,integer,text,uuid,uuid,text,text),public.committee_finish_credential_action(uuid,uuid),public.committee_fail_credential_action(uuid,uuid),
 public.committee_change_membership_before_account_actions(uuid,integer,text,jsonb,uuid),public.committee_change_membership(uuid,integer,text,jsonb,uuid),public.committee_accounts_before_account_actions(),public.committee_accounts(),
 public.committee_account_action_before_credentials(uuid,text,jsonb),public.committee_account_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.committee_change_membership_before_account_actions(uuid,integer,text,jsonb,uuid),public.committee_account_action_before_credentials(uuid,text,jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.committee_accounts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.committee_account_action(uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
