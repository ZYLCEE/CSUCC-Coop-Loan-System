CREATE FUNCTION pg_temp.seat(n integer,new_seat text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
 PERFORM public.committee_account_action(pg_temp.actor(1),'committee_change_membership',jsonb_build_object('p_id',pg_temp.member(n),'p_revision',(SELECT revision FROM public.staff_memberships WHERE id=pg_temp.member(n)),'p_action','edit','p_request_id',gen_random_uuid(),
  'p_payload',jsonb_build_object('role',CASE WHEN n=11 THEN 'bod_member' ELSE 'crecom_member' END,'committeeSeat',new_seat,'title','Synthetic position','startsAt',now()-interval '1 day','endsAt',null,'reason','Synthetic appointment change')));
END$$;
CREATE FUNCTION pg_temp.bod(application text) RETURNS jsonb LANGUAGE sql AS $$SELECT pg_temp.send(2,application,'forward_bod',jsonb_build_object('reviewers',jsonb_build_array(pg_temp.member(11)),'dueAt',null))$$;
CREATE FUNCTION pg_temp.activate(rules jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy',jsonb_build_object('policyId','90000000-0000-0000-0000-000000000001','rules',rules,'requestId',gen_random_uuid()))$$;
-- Direct authenticated calls cannot bypass personal-password service dispatch.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
SELECT pg_temp.denied($q$SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy','{}')$q$,'42501');
SELECT pg_temp.denied($q$UPDATE public.staff_memberships SET committee_seat='chairperson'$q$,'42501');
RESET ROLE;
SELECT pg_temp.denied($q$SELECT pg_temp.activate('{"crecomApprovals":3,"bodReviewers":3,"bodApprovals":3,"bodAuthority":"recommendation","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC","signatoryLayout":"manual_form_v1"}')$q$,'P0001');
UPDATE public.approval_workflow_policies SET config=jsonb_set(config,'{bodMode}','"none"');
SELECT pg_temp.denied($q$SELECT pg_temp.activate('{"crecomApprovals":3,"bodReviewers":1,"bodApprovals":1,"bodAuthority":"recommendation","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC","signatoryLayout":"manual_form_v1"}')$q$,'P0001');
UPDATE public.approval_workflow_policies SET config=jsonb_set(config,'{bodMode}','"required"');
SELECT pg_temp.activate('{"crecomApprovals":3,"bodReviewers":1,"bodApprovals":1,"bodAuthority":"recommendation","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC","signatoryLayout":"manual_form_v1"}');
SELECT pg_temp.seed_app('APP-YES');
SELECT pg_temp.denied($q$SELECT pg_temp.send(3,'APP-YES','forward',pg_temp.payload_reviewers(7,8,9))$q$,'42501');
UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{"committeeSeat":"chairperson","role":"crecom_chairperson"}'::jsonb WHERE id=pg_temp.actor(12);
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,8,12))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,9,10))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,8,9,false))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,7,9))$q$,'P0001');
SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,8,9));
SELECT pg_temp.assert_true((SELECT count(*) FILTER(WHERE signatory_role='crecom_member')=2 AND count(*) FILTER(WHERE signatory_role='crecom_chairperson')=1 FROM public.review_assignments),'exact frozen CRECOM layout');
SELECT pg_temp.denied($q$SELECT pg_temp.respond(10,'APP-YES','approve')$q$,'P0002');
SELECT pg_temp.respond(7,'APP-YES','approve');
SELECT pg_temp.send(8,'APP-YES','clarify',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',8),'reason','Explain the frozen estimate.'));
SELECT pg_temp.denied($q$SELECT pg_temp.respond(8,'APP-YES','approve')$q$,'P0001');
SELECT pg_temp.send(2,'APP-YES','reply',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',8),'reason','Synthetic clarification provided.'));
SELECT pg_temp.respond(8,'APP-YES','approve');
SELECT pg_temp.send(9,'APP-YES','recuse',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'reason','Synthetic recusal.'));
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','reassign',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'membershipId',pg_temp.member(12),'reason','Wrong replacement position.'))$q$,'P0001');
SELECT pg_temp.send(2,'APP-YES','reassign',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'membershipId',pg_temp.member(10),'reason','Replace with another appointed chairperson.'));
SELECT pg_temp.seat(10,'member');
SELECT pg_temp.denied($q$SELECT pg_temp.respond(10,'APP-YES','approve')$q$,'42501');
SELECT pg_temp.seat(10,'chairperson');
SELECT pg_temp.respond(10,'APP-YES','approve');
SELECT pg_temp.assert_true(public.committee_application_stage((SELECT id FROM public.loan_applications WHERE application_id='APP-YES'))='ready_for_bod','three CRECOM approvals require BOD next');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"Too early before BOD"}')$q$,'P0001');
-- Ordinary BOD member cannot occupy the chairperson slot or open the portal.
UPDATE public.staff_memberships SET committee_seat='member' WHERE id=pg_temp.member(11);
SELECT pg_temp.denied($q$SELECT pg_temp.bod('APP-YES')$q$,'40001');
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(11)::text,true);
SELECT pg_temp.assert_true(NOT (public.portal_session_access()->>'allowed')::boolean,'BOD member cannot replace chairperson');
UPDATE public.staff_memberships SET committee_seat='chairperson' WHERE id=pg_temp.member(11);
SELECT pg_temp.bod('APP-YES');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"Before BOD confirmation"}')$q$,'P0001');
SELECT pg_temp.respond(11,'APP-YES','approve','BOD');
SELECT pg_temp.assert_true((SELECT count(*)=4 AND count(*) FILTER(WHERE signatory_role='bod_chairperson')=1 FROM public.individual_review_decisions),'four individual account confirmations');
SELECT pg_temp.assert_true((SELECT bool_and(confirmation_text LIKE '% as %' AND confirmation_method='account_password') FROM public.individual_review_decisions),'confirmation contains frozen position and account password method');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','finalize','{"decision":"approve","reason":"Admin cannot finalize"}')$q$,'42501');
SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"All four required positions confirmed."}');
SELECT pg_temp.assert_true((SELECT status='approved' FROM public.loan_applications WHERE application_id='APP-YES'),'only final Super Admin action approves application');
SELECT pg_temp.denied($q$UPDATE public.individual_review_decisions SET signatory_role='crecom_chairperson'$q$,'42501');
SELECT pg_temp.denied($q$UPDATE public.review_assignments SET signatory_role='crecom_chairperson' WHERE signatory_role='crecom_member'$q$,'P0001');
-- Existing confirmation stays in the original position after appointment changes.
SELECT pg_temp.seat(10,'member');
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(10)::text,true);
SELECT pg_temp.assert_true(NOT public.committee_assignment_eligible(pg_temp.assignment('APP-YES',10)),'old chair packet access closes after seat change');
SELECT pg_temp.assert_true((SELECT signatory_role='crecom_chairperson' FROM public.individual_review_decisions WHERE reviewer_auth_id=pg_temp.actor(10)),'recorded position never relabelled');
SELECT pg_temp.seat(10,'chairperson');
-- A rejection still requires all responses and blocks final approval.
SELECT pg_temp.seed_app('APP-REJECT');
SELECT pg_temp.send(2,'APP-REJECT','forward',pg_temp.payload_reviewers(7,8,9));
SELECT pg_temp.respond(7,'APP-REJECT','approve');
SELECT pg_temp.respond(8,'APP-REJECT','reject');
SELECT pg_temp.respond(9,'APP-REJECT','approve');
SELECT pg_temp.bod('APP-REJECT');
SELECT pg_temp.respond(11,'APP-REJECT','approve','BOD');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-REJECT','finalize','{"decision":"approve","reason":"Cannot override rejection"}')$q$,'P0001');
SELECT pg_temp.send(1,'APP-REJECT','finalize','{"decision":"reject","reason":"Required CRECOM confirmation was rejected."}');
-- Invite validation cannot create a regular BOD voter; no mail provider is called.
SELECT set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
SELECT pg_temp.denied($q$SELECT public.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),jsonb_build_object('name','Synthetic','email','other@example.invalid','role','bod_member','committeeSeat','member','title','','startsAt',now(),'endsAt',null))$q$,'P0001');
SELECT pg_temp.denied($q$SELECT pg_temp.seat(11,'member')$q$,'P0001');
DO $$
DECLARE request uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); payload jsonb; result jsonb; membership uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',pg_temp.actor(1)::text,true);
 payload:=jsonb_build_object('name','Synthetic new chairperson','email','new-chair@example.invalid','role','crecom_member','committeeSeat','chairperson','title','Optional display title','startsAt',now()-interval '1 day','endsAt',null);
 result:=public.committee_reserve_invite(request,attempt,payload);
 PERFORM pg_temp.assert_true(NOT (result->>'complete')::boolean,'new invitation reserves a request without creating a membership');
 INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,invited_at,encrypted_password)
 VALUES(pg_temp.actor(13),'new-chair@example.invalid',jsonb_build_object('role','crecom_member','account_status','active','committee_invitation_request_id',request),'{}',now(),now(),'synthetic-hash');
 result:=public.committee_finish_invite(request,attempt,pg_temp.actor(13));membership:=(result->>'membershipId')::uuid;
 PERFORM pg_temp.assert_true((SELECT committee_seat='chairperson' AND setup_completed_at IS NULL FROM public.staff_memberships WHERE id=membership),'trusted position survives invite completion, personal setup still required');
 PERFORM pg_temp.assert_true(public.committee_finish_invite(request,attempt,pg_temp.actor(13))=result,'completed invitation retry is idempotent');
END$$;
SELECT 'PASS: exact four-position workflow, mandatory BOD, same-position replacement, seat revocation, immutable confirmations, final authority and rejection gate' AS result;
