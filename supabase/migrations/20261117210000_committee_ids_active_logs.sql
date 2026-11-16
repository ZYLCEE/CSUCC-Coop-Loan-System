-- Resolve committee account numbers from staff_memberships in Active Logs.
-- Committee users do not have public.members rows, so their session and event
-- records previously stored a NULL account_number. Existing immutable log
-- rows remain untouched; the read function resolves their display ID live.
BEGIN;

CREATE OR REPLACE FUNCTION public.manage_portal_log_session(
  p_actor_id uuid,
  p_auth_session_id uuid,
  p_operation text,
  p_browser text DEFAULT NULL,
  p_os text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_idle_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  s public.portal_log_sessions%ROWTYPE;
  u auth.users%ROWTYPE;
  role_value text;
  number_value text;
  name_value text;
  at_time timestamptz := clock_timestamp();
  idle_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE id = p_auth_session_id AND user_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'A current verified session is required.' USING ERRCODE = '42501';
  END IF;
  IF p_operation NOT IN ('start', 'touch', 'logout', 'revoke') OR p_idle_seconds < 0 THEN
    RAISE EXCEPTION 'Invalid session operation.';
  END IF;

  SELECT * INTO u FROM auth.users WHERE id = p_actor_id;
  SELECT * INTO s FROM public.portal_log_sessions
  WHERE auth_session_id = p_auth_session_id AND actor_id = p_actor_id FOR UPDATE;

  IF p_operation IN ('logout', 'revoke') THEN
    IF s.id IS NOT NULL AND s.ended_at IS NULL THEN
      UPDATE public.portal_log_sessions
      SET ended_at = greatest(started_at, least(at_time, expires_at)),
          end_reason = CASE WHEN expires_at <= at_time THEN 'idle_timeout' ELSE p_operation END
      WHERE id = s.id RETURNING * INTO s;
      IF p_operation = 'logout' AND s.expires_at > at_time THEN
        INSERT INTO public.portal_active_log_entries(
          source_key, session_id, actor_id, account_number, actor_name,
          actor_role, action_label, description, browser, os, ip_address
        ) VALUES (
          'logout:' || s.id, s.id, s.actor_id, s.account_number, s.actor_name,
          s.actor_role, 'Logout', s.actor_name || ' signed out of the COOP portal.',
          s.browser, s.os, s.ip_address
        ) ON CONFLICT (source_key) DO NOTHING;
      END IF;
    END IF;
    RETURN jsonb_build_object('id', s.id, 'serverTime', at_time, 'expiresAt', at_time, 'ended', true);
  END IF;

  role_value := CASE WHEN u.raw_app_meta_data->>'role' = 'coop_admin'
    THEN 'admin' ELSE u.raw_app_meta_data->>'role' END;
  IF role_value IS NULL
     OR role_value NOT IN ('super_admin', 'admin', 'member', 'crecom_member', 'bod_member')
     OR coalesce(u.raw_app_meta_data->>'account_status', 'active') <> 'active'
     OR u.banned_until > at_time THEN
    RAISE EXCEPTION 'Active portal membership is required.' USING ERRCODE = '42501';
  END IF;
  IF role_value = 'member' AND NOT EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.user_id = p_actor_id AND m.status = 'active' AND m.must_change_password = false
  ) THEN
    RAISE EXCEPTION 'Active member access is required.' USING ERRCODE = '42501';
  END IF;
  IF s.id IS NOT NULL AND (s.ended_at IS NOT NULL OR s.expires_at <= at_time) THEN
    UPDATE public.portal_log_sessions
    SET ended_at = coalesce(ended_at, expires_at), end_reason = coalesce(end_reason, 'idle_timeout')
    WHERE id = s.id;
    RETURN jsonb_build_object('expired', true, 'serverTime', at_time);
  END IF;
  IF s.id IS NOT NULL AND s.actor_role IS DISTINCT FROM role_value THEN
    UPDATE public.portal_log_sessions SET ended_at = at_time, end_reason = 'role_changed' WHERE id = s.id;
    RETURN jsonb_build_object('expired', true, 'serverTime', at_time);
  END IF;

  IF s.id IS NULL THEN
    IF p_operation <> 'start' THEN
      RAISE EXCEPTION 'Start an admitted portal session first.' USING ERRCODE = '42501';
    END IF;

    SELECT member_id INTO number_value
    FROM public.members WHERE user_id = p_actor_id ORDER BY created_at LIMIT 1;
    IF number_value IS NULL AND role_value IN ('crecom_member', 'bod_member') THEN
      SELECT account_number INTO number_value
      FROM public.staff_memberships
      WHERE auth_user_id = p_actor_id AND role = role_value
      ORDER BY active DESC, starts_at DESC, created_at DESC, id
      LIMIT 1;
    END IF;

    name_value := left(coalesce(
      nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name')), ''),
      u.email, 'Account'
    ), 160);
    INSERT INTO public.portal_log_sessions(
      auth_session_id, actor_id, account_number, actor_name, actor_role,
      browser, os, ip_address, expires_at
    ) VALUES (
      p_auth_session_id, p_actor_id, number_value, name_value, role_value,
      left(p_browser, 80), left(p_os, 80), left(p_ip, 64), at_time + interval '15 minutes'
    ) ON CONFLICT (auth_session_id) DO NOTHING;
    SELECT * INTO s FROM public.portal_log_sessions
    WHERE auth_session_id = p_auth_session_id AND actor_id = p_actor_id FOR UPDATE;
  END IF;

  -- Reloads and background checks do not renew idle time; only reported
  -- interaction does.
  IF p_operation = 'touch' THEN
    idle_at := greatest(s.last_activity_at, at_time - make_interval(secs => least(p_idle_seconds, 86400)));
    IF idle_at + interval '15 minutes' <= at_time THEN
      UPDATE public.portal_log_sessions SET ended_at = expires_at, end_reason = 'idle_timeout' WHERE id = s.id;
      RETURN jsonb_build_object('expired', true, 'serverTime', at_time);
    END IF;
    UPDATE public.portal_log_sessions
    SET last_activity_at = idle_at, expires_at = idle_at + interval '15 minutes'
    WHERE id = s.id RETURNING * INTO s;
  END IF;
  RETURN jsonb_build_object('id', s.id, 'serverTime', at_time, 'expiresAt', s.expires_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_portal_active_logs(
  p_search text DEFAULT '',
  p_role text DEFAULT '',
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  viewer text := public.portal_log_viewer_role();
  result jsonb;
BEGIN
  IF viewer IS NULL THEN
    RAISE EXCEPTION 'Active cooperative account access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_page < 1 OR p_page > 100000
     OR p_page_size NOT IN (10, 25, 50)
     OR length(p_search) > 160
     OR p_role NOT IN ('', 'super_admin', 'admin', 'member', 'crecom_member', 'bod_member')
     OR p_from >= p_to THEN
    RAISE EXCEPTION 'Choose valid filters.';
  END IF;

  WITH entries AS (
    SELECT
      s.id,
      s.actor_id,
      coalesce(
        public.portal_display_account_id(s.account_number),
        public.portal_display_account_id(sm.account_number)
      ) AS account_number,
      s.actor_name,
      s.actor_role,
      'Login'::text AS action,
      s.browser,
      s.os,
      s.started_at AS time_in,
      coalesce(s.ended_at, CASE WHEN s.expires_at <= now() THEN s.expires_at END) AS time_out,
      CASE WHEN s.ended_at IS NULL AND s.expires_at > now() THEN 'active' ELSE 'closed' END AS session_state,
      s.ip_address,
      s.actor_name || ' signed in successfully.' ||
        CASE WHEN s.end_reason = 'idle_timeout' OR (s.ended_at IS NULL AND s.expires_at <= now())
          THEN ' Session ended after inactivity.'
          WHEN s.end_reason = 'revoke' THEN ' Portal access ended.' ELSE '' END AS description,
      s.started_at AS event_time
    FROM public.portal_log_sessions s
    LEFT JOIN LATERAL (
      SELECT membership.account_number
      FROM public.staff_memberships membership
      WHERE membership.auth_user_id = s.actor_id AND membership.role = s.actor_role
      ORDER BY membership.active DESC, membership.starts_at DESC, membership.created_at DESC, membership.id
      LIMIT 1
    ) sm ON s.actor_role IN ('crecom_member', 'bod_member')

    UNION ALL

    SELECT
      e.id,
      e.actor_id,
      coalesce(
        public.portal_display_account_id(e.account_number),
        public.portal_display_account_id(sm.account_number)
      ) AS account_number,
      e.actor_name,
      e.actor_role,
      e.action_label AS action,
      e.browser,
      e.os,
      CASE WHEN e.action_label = 'Logout' THEN NULL ELSE e.created_at END AS time_in,
      CASE WHEN e.action_label = 'Logout' THEN e.created_at END AS time_out,
      'activity'::text AS session_state,
      e.ip_address,
      e.description,
      e.created_at AS event_time
    FROM public.portal_active_log_entries e
    LEFT JOIN LATERAL (
      SELECT membership.account_number
      FROM public.staff_memberships membership
      WHERE membership.auth_user_id = e.actor_id AND membership.role = e.actor_role
      ORDER BY membership.active DESC, membership.starts_at DESC, membership.created_at DESC, membership.id
      LIMIT 1
    ) sm ON e.actor_role IN ('crecom_member', 'bod_member')
  ),
  filtered AS (
    SELECT * FROM entries
    WHERE public.portal_log_row_visible(actor_id, actor_role)
      AND (p_role = '' OR actor_role = p_role)
      AND (p_from IS NULL OR event_time >= p_from)
      AND (p_to IS NULL OR event_time < p_to)
      AND (p_search = '' OR strpos(
        lower(concat_ws(' ', account_number, actor_name, actor_role, action, description, browser, os, ip_address)),
        lower(p_search)
      ) > 0)
  ),
  counted AS (SELECT count(*) AS n FROM filtered),
  paging AS (
    SELECT n, greatest(1, least(p_page, ceil(n::numeric / p_page_size)::integer)) AS p FROM counted
  ),
  limited AS (
    SELECT f.* FROM filtered f
    ORDER BY event_time DESC, id DESC
    LIMIT p_page_size OFFSET (SELECT (p - 1) * p_page_size FROM paging)
  )
  SELECT jsonb_build_object(
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'accountNumber', account_number, 'name', actor_name,
        'role', actor_role, 'action', action, 'browser', browser, 'os', os,
        'timeIn', time_in, 'timeOut', time_out, 'sessionState', session_state,
        'ipAddress', ip_address, 'details', description
      ) ORDER BY event_time DESC, id DESC) FROM limited
    ), '[]'),
    'total', n,
    'page', p,
    'pageSize', p_page_size
  ) INTO result
  FROM paging;

  RETURN result;
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
