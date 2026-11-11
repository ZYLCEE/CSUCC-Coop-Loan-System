-- All users, policies, notifications and decisions below are synthetic and rolled back.
CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END$$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'Expected rejection: %',command;
END$$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,encrypted_password)
SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'review-'||n||'@example.invalid',
 jsonb_build_object('role',CASE WHEN n=1 THEN 'super_admin' WHEN n IN (2,3) THEN 'admin' WHEN n IN (4,5,6) THEN 'member' WHEN n=11 THEN 'bod_member' ELSE 'crecom_member' END,
  'account_status','active','admin_privileges',CASE WHEN n=2 THEN '["applications.forward","applications.verify"]'::jsonb ELSE '[]'::jsonb END),
 jsonb_build_object('full_name','Synthetic reviewer '||n),now(),'synthetic-hash' FROM generate_series(1,11)n;
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,status,must_change_password)
SELECT ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'TEST-'||n,'Synthetic','Member '||n,'active',false FROM generate_series(4,6)n;
INSERT INTO public.staff_memberships(id,auth_user_id,role,active,starts_at,setup_completed_at,assigned_by)
SELECT ('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n=11 THEN 'bod_member' ELSE 'crecom_member' END,true,now()-interval '1 day',now(),'10000000-0000-0000-0000-000000000001' FROM generate_series(7,11)n;
INSERT INTO public.approval_workflow_policies(id,name,config,authorization_reference,created_by,created_by_name)
VALUES('90000000-0000-0000-0000-000000000001','SYNTHETIC NO BOD',
 '{"reviewerCount":3,"quorumRule":"SYNTHETIC all 3 must respond and approve","crecomAuthority":"recommendation","bodMode":"none","bodCriteria":"","finalAuthority":"Super Admin","borrowerConsentRequired":false,"coMakerConsentRequired":false,"witnessCount":0,"allowedConsentMethods":["paper"],"requirementsReference":"SYNTHETIC TEST ONLY"}',
 'SYNTHETIC TEST ONLY','10000000-0000-0000-0000-000000000001','Synthetic coordinator');
CREATE FUNCTION pg_temp.actor(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE FUNCTION pg_temp.member(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('80000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE FUNCTION pg_temp.payload_reviewers(n1 integer,n2 integer,n3 integer,bod boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('reviewers',jsonb_build_array(pg_temp.member(n1),pg_temp.member(n2),pg_temp.member(n3)),'dueAt',null,'bodRequired',bod,'routingReason','SYNTHETIC approved applicability');
$$;
CREATE FUNCTION pg_temp.send(actor integer,application text,operation text,payload jsonb,request uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE app uuid; revision integer; hash text;
BEGIN
 SELECT id INTO STRICT app FROM public.loan_applications WHERE application_id=application;
 SELECT v.revision INTO STRICT revision FROM public.application_verifications v WHERE v.application_id=app;
 hash:=public.private_application_verification_state(app)->>'stateHash';
 RETURN public.committee_review_action(pg_temp.actor(actor),operation,jsonb_build_object('applicationId',application,'revision',revision,'stateHash',hash,'payload',payload,'requestId',request));
END$$;
CREATE FUNCTION pg_temp.seed_app(label text,policy uuid DEFAULT '90000000-0000-0000-0000-000000000001')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE app uuid:=gen_random_uuid(); doc uuid; kind text; state jsonb;
BEGIN
 INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted,tenure_months,monthly_payment)
 VALUES(app,label,'20000000-0000-0000-0000-000000000004','Synthetic Borrower','Business',1000,'pending',current_date,12,100);
 FOREACH kind IN ARRAY ARRAY['validId','payslip'] LOOP
  doc:=gen_random_uuid();
  INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes)
  VALUES(doc,app,pg_temp.actor(4),kind,'synthetic/'||doc::text||'.pdf',kind||'.pdf','application/pdf',10);
  INSERT INTO public.loan_document_reviews(document_id,status,reviewer_id,reviewer_name) VALUES(doc,'verified',pg_temp.actor(1),'Synthetic verifier');
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('loan-documents','synthetic/'||doc::text||'.pdf','{"mimetype":"application/pdf","size":10}');
 END LOOP;
 INSERT INTO public.application_verifications(application_id,checks,notes,policy_id,updated_by)
 VALUES(app,'{"identity":true,"eligibility":true,"terms":true}','Synthetic staff findings',policy,pg_temp.actor(1));
 state:=public.private_application_verification_state(app);
 IF jsonb_array_length(state->'blockers')<>0 THEN RAISE EXCEPTION 'Unexpected fixture blockers: %',state->'blockers'; END IF;
 UPDATE public.application_verifications SET stage='ready_for_committee',verified_state_hash=state->>'stateHash',verified_snapshot=state WHERE application_id=app;
 RETURN app;
END$$;
CREATE FUNCTION pg_temp.assignment(application text,reviewer integer,stage_name text DEFAULT 'CRECOM') RETURNS uuid LANGUAGE sql AS $$
 SELECT x.id FROM public.review_assignments x JOIN public.application_review_cycles c ON c.id=x.review_cycle_id
 JOIN public.loan_applications a ON a.id=c.application_id WHERE a.application_id=application AND x.reviewer_auth_id=pg_temp.actor(reviewer) AND c.stage=stage_name AND c.status<>'superseded' AND x.state NOT IN ('reassigned','cancelled') ORDER BY c.cycle_no DESC LIMIT 1;
$$;
CREATE FUNCTION pg_temp.respond(reviewer integer,application text,decision text,stage_name text DEFAULT 'CRECOM') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.send(reviewer,application,decision,jsonb_build_object('assignmentId',pg_temp.assignment(application,reviewer,stage_name),'reason','Synthetic decision note','confirmed',true));
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT public.committee_review_action('10000000-0000-0000-0000-000000000001','activate_policy','{}')$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.committee_activate_policy('90000000-0000-0000-0000-000000000001','{}',gen_random_uuid())$q$,'42501');
RESET ROLE;
SELECT pg_temp.denied($q$SELECT public.committee_review_action(pg_temp.actor(2),'activate_policy',jsonb_build_object('policyId','90000000-0000-0000-0000-000000000001','rules','{}','requestId',gen_random_uuid()))$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy',jsonb_build_object('policyId','90000000-0000-0000-0000-000000000001','rules','{"crecomApprovals":2,"finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC"}'::jsonb,'requestId',gen_random_uuid()))$q$,'P0001');
SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy',jsonb_build_object('policyId','90000000-0000-0000-0000-000000000001','rules','{"crecomApprovals":3,"bodReviewers":null,"bodApprovals":null,"bodAuthority":"pending","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC TEST ONLY"}'::jsonb,'requestId',gen_random_uuid()));
SELECT pg_temp.denied($q$UPDATE public.approval_workflow_policies SET config='{}' WHERE status='approved'$q$,'42501');
SELECT pg_temp.seed_app('APP-YES');
SELECT pg_temp.denied($q$SELECT pg_temp.send(3,'APP-YES','forward',pg_temp.payload_reviewers(7,8,9))$q$,'42501');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','forward',pg_temp.payload_reviewers(7,7,9))$q$,'P0001');
DO $$
DECLARE app uuid; rev integer; hash text; args jsonb; result jsonb; req uuid:=gen_random_uuid();
BEGIN
 SELECT id INTO app FROM public.loan_applications WHERE application_id='APP-YES';
 SELECT revision INTO rev FROM public.application_verifications WHERE application_id=app;
 hash:=public.private_application_verification_state(app)->>'stateHash';
 args:=jsonb_build_object('applicationId','APP-YES','revision',rev,'stateHash',hash,'payload',pg_temp.payload_reviewers(7,8,9),'requestId',req);
 result:=public.committee_review_action(pg_temp.actor(2),'forward',args);
 PERFORM pg_temp.assert_true(result=public.committee_review_action(pg_temp.actor(2),'forward',args),'forward retry is idempotent');
 PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.review_assignments),'one assignment per reviewer');
 PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM public.committee_notification_links),'one linked notification per reviewer');
END$$;
SELECT pg_temp.denied($q$SELECT pg_temp.send(10,'APP-YES','approve',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',7),'confirmed',true))$q$,'42501');
SELECT pg_temp.denied($q$SELECT pg_temp.send(7,'APP-YES','approve',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',7)))$q$,'P0001');
SELECT pg_temp.respond(7,'APP-YES','approve');
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.loan_applications WHERE application_id='APP-YES'),'individual approval does not approve loan');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"Too early"}')$q$,'P0001');
SELECT pg_temp.send(8,'APP-YES','clarify',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',8),'reason','Please explain the frozen projection.'));
SELECT pg_temp.denied($q$SELECT pg_temp.respond(8,'APP-YES','approve')$q$,'P0001');
SELECT pg_temp.send(2,'APP-YES','reply',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',8),'reason','The projection includes the documented fee.'));
SELECT pg_temp.respond(8,'APP-YES','approve');
SELECT pg_temp.send(9,'APP-YES','recuse',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'reason','Synthetic conflict of interest.'));
SELECT pg_temp.send(2,'APP-YES','reassign',jsonb_build_object('assignmentId',pg_temp.assignment('APP-YES',9),'membershipId',pg_temp.member(10),'reason','Replace the recused reviewer.'));
SELECT pg_temp.respond(10,'APP-YES','approve');
SELECT pg_temp.assert_true(public.committee_application_stage((SELECT id FROM public.loan_applications WHERE application_id='APP-YES'))='ready_for_final','all three approvals await final authority');
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.loan_applications WHERE application_id='APP-YES'),'panel outcome is not automatic final approval');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-YES','finalize','{"decision":"approve","reason":"Admin cannot finalize"}')$q$,'42501');
SELECT pg_temp.send(1,'APP-YES','finalize','{"decision":"approve","reason":"All required confirmations checked."}');
SELECT pg_temp.assert_true((SELECT status='approved' AND date_approved=(now() AT TIME ZONE 'Asia/Manila')::date FROM public.loan_applications WHERE application_id='APP-YES'),'Super Admin final decision commits loan status and Philippine date');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true(public.committee_review_state('APP-YES')->'finalDecision'->>'decision'='approve','staff reads the recorded final outcome');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_true(public.committee_review_packet(pg_temp.assignment('APP-YES',7))->'myDecision'->>'method'='account_password','own packet contains immutable password confirmation record');
SELECT pg_temp.assert_true(NOT (public.committee_review_packet(pg_temp.assignment('APP-YES',7))->'documents'->0 ? 'storagePath'),'packet response hides storage paths');
SELECT pg_temp.denied($q$SELECT public.committee_review_packet(pg_temp.assignment('APP-YES',8))$q$,'42501');
RESET ROLE;
SELECT pg_temp.denied($q$UPDATE public.individual_review_decisions SET decision='reject'$q$,'42501');
SELECT pg_temp.denied($q$UPDATE public.loan_applications SET status='under review' WHERE application_id='APP-YES'$q$,'42501');
GRANT UPDATE ON public.loan_applications TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$UPDATE public.loan_applications SET status='released' WHERE application_id='APP-YES'$q$,'42501');
SELECT pg_temp.denied($q$UPDATE public.loan_applications SET amount=9999 WHERE application_id='APP-YES'$q$,'42501');
RESET ROLE;
UPDATE public.loan_applications SET status='released' WHERE application_id='APP-YES';
SELECT pg_temp.assert_true((SELECT status='released' FROM public.loan_applications WHERE application_id='APP-YES'),'authorized final approval permits existing release flow');
SELECT pg_temp.seed_app('APP-NO');
SELECT pg_temp.send(2,'APP-NO','forward',pg_temp.payload_reviewers(7,8,9));
SELECT pg_temp.respond(7,'APP-NO','approve');
SELECT pg_temp.respond(8,'APP-NO','approve');
SELECT pg_temp.respond(9,'APP-NO','reject');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-NO','finalize','{"decision":"approve","reason":"Attempted override"}')$q$,'P0001');
SELECT pg_temp.send(1,'APP-NO','finalize','{"decision":"reject","reason":"Required unanimous CRECOM approval was not achieved."}');
SELECT pg_temp.seed_app('APP-STALE');
SELECT pg_temp.send(2,'APP-STALE','forward',pg_temp.payload_reviewers(7,8,9));
SELECT pg_temp.respond(7,'APP-STALE','approve');
DO $$
DECLARE document uuid; old_path text; frozen_path text;
BEGIN
 SELECT d.id,d.storage_path INTO document,old_path FROM public.loan_documents d JOIN public.loan_applications a ON a.id=d.loan_application_id WHERE a.application_id='APP-STALE' AND d.kind='validId';
 UPDATE public.loan_documents SET storage_path='synthetic/replaced-root.pdf' WHERE id=document;
 PERFORM set_config('request.jwt.claim.sub',pg_temp.actor(7)::text,true);
 frozen_path:=public.committee_document_location(pg_temp.assignment('APP-STALE',7),document,null)->>'path';
 PERFORM pg_temp.assert_true(frozen_path=old_path,'assigned packet retains the frozen original object path');
END$$;
UPDATE public.loan_applications SET amount=2000 WHERE application_id='APP-STALE';
SELECT pg_temp.denied($q$SELECT pg_temp.respond(8,'APP-STALE','approve')$q$,'40001');
SELECT pg_temp.send(2,'APP-STALE','reopen','{"reason":"Changed terms require a new verified packet."}');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.individual_review_decisions d JOIN public.review_assignments x ON x.id=d.assignment_id JOIN public.application_review_cycles c ON c.id=x.review_cycle_id JOIN public.loan_applications a ON a.id=c.application_id WHERE a.application_id='APP-STALE'),'return to verification retains previous decisions');
-- Conditional BOD fixtures demonstrate routing enforcement without activating any real policy.
INSERT INTO public.approval_workflow_policies(id,name,config,authorization_reference,created_by,created_by_name)
SELECT '90000000-0000-0000-0000-000000000002','SYNTHETIC CONDITIONAL BOD',jsonb_set(jsonb_set(config,'{bodMode}','"conditional"'),'{bodCriteria}','"SYNTHETIC amount criteria"'),
 'SYNTHETIC TEST ONLY',pg_temp.actor(1),'Synthetic coordinator' FROM public.approval_workflow_policies WHERE id='90000000-0000-0000-0000-000000000001';
SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy',jsonb_build_object('policyId','90000000-0000-0000-0000-000000000002','rules','{"crecomApprovals":3,"bodReviewers":1,"bodApprovals":1,"bodAuthority":"binding_decision","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC TEST ONLY"}'::jsonb,'requestId',gen_random_uuid()));
SELECT pg_temp.seed_app('APP-BOD','90000000-0000-0000-0000-000000000002');
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-BOD','forward',pg_temp.payload_reviewers(7,8,9,true)||'{"routingReason":""}')$q$,'P0001');
SELECT pg_temp.send(2,'APP-BOD','forward',pg_temp.payload_reviewers(7,8,9,true));
SELECT pg_temp.denied($q$SELECT pg_temp.send(2,'APP-BOD','forward_bod',jsonb_build_object('reviewers',jsonb_build_array(pg_temp.member(11)),'dueAt',null))$q$,'P0001');
SELECT pg_temp.respond(7,'APP-BOD','approve');
SELECT pg_temp.respond(8,'APP-BOD','approve');
SELECT pg_temp.respond(9,'APP-BOD','approve');
SELECT pg_temp.assert_true(public.committee_application_stage((SELECT id FROM public.loan_applications WHERE application_id='APP-BOD'))='ready_for_bod','CRECOM confirmation does not waive required BOD review');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-BOD','finalize','{"decision":"approve","reason":"BOD is still pending"}')$q$,'P0001');
SELECT pg_temp.send(2,'APP-BOD','forward_bod',jsonb_build_object('reviewers',jsonb_build_array(pg_temp.member(11)),'dueAt',null));
SELECT pg_temp.denied($q$SELECT pg_temp.respond(7,'APP-BOD','approve','BOD')$q$,'P0002');
SELECT pg_temp.respond(11,'APP-BOD','reject','BOD');
SELECT pg_temp.denied($q$SELECT pg_temp.send(1,'APP-BOD','finalize','{"decision":"approve","reason":"Attempt to override BOD"}')$q$,'P0001');
SELECT pg_temp.send(1,'APP-BOD','finalize','{"decision":"reject","reason":"Required BOD confirmation was not granted."}');
-- A confirmed reviewer cannot see another reviewer's decisions, and old cycles stay attributable.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.individual_review_decisions WHERE reviewer_auth_id<>'10000000-0000-0000-0000-000000000007'),'private peer decisions');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(public.committee_workspace()->'history')x WHERE x->>'applicationId'='APP-STALE'),'superseded decisions remain in own history');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.committee_review_events),'reviewers cannot bulk-read staff event history');
RESET ROLE;
SELECT pg_temp.seed_app('APP-REVOKED');
SELECT pg_temp.send(2,'APP-REVOKED','forward',pg_temp.payload_reviewers(7,8,9));
UPDATE public.staff_memberships SET active=false WHERE id=pg_temp.member(9);
SELECT pg_temp.denied($q$SELECT pg_temp.respond(9,'APP-REVOKED','approve')$q$,'42501');
UPDATE public.staff_memberships SET active=true WHERE id=pg_temp.member(9);
-- Consent evidence is bound to the actually selected co-maker and exact packet.
INSERT INTO public.approval_workflow_policies(id,name,config,authorization_reference,created_by,created_by_name)
SELECT '90000000-0000-0000-0000-000000000003','SYNTHETIC CO-MAKER',jsonb_set(config,'{coMakerConsentRequired}','true'),
 'SYNTHETIC TEST ONLY',pg_temp.actor(1),'Synthetic coordinator' FROM public.approval_workflow_policies WHERE id='90000000-0000-0000-0000-000000000001';
SELECT public.committee_review_action(pg_temp.actor(1),'activate_policy',jsonb_build_object('policyId','90000000-0000-0000-0000-000000000003','rules','{"crecomApprovals":3,"bodReviewers":null,"bodApprovals":null,"bodAuthority":"pending","finalMode":"super_admin","allowOverride":false,"allResponses":true,"ruleReference":"SYNTHETIC TEST ONLY"}'::jsonb,'requestId',gen_random_uuid()));
SELECT pg_temp.seed_app('APP-CONSENT');
UPDATE public.loan_applications SET co_maker_member_id='20000000-0000-0000-0000-000000000005' WHERE application_id='APP-CONSENT';
UPDATE public.application_verifications SET policy_id='90000000-0000-0000-0000-000000000003' WHERE application_id=(SELECT id FROM public.loan_applications WHERE application_id='APP-CONSENT');
INSERT INTO public.application_consent_evidence(application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at)
SELECT id,'co_maker','TEST-6',pg_temp.actor(6),'paper','SYNTHETIC wrong subject',public.private_application_verification_state(id)->>'packetHash',now() FROM public.loan_applications WHERE application_id='APP-CONSENT';
SELECT pg_temp.assert_true((SELECT public.private_application_verification_state(id)->'evidence'->>'coMaker'='0' FROM public.loan_applications WHERE application_id='APP-CONSENT'),'different member cannot supply selected co-maker consent');
INSERT INTO public.application_consent_evidence(application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at)
SELECT id,'co_maker','TEST-5',pg_temp.actor(5),'paper','SYNTHETIC selected subject',public.private_application_verification_state(id)->>'packetHash',now() FROM public.loan_applications WHERE application_id='APP-CONSENT';
SELECT pg_temp.assert_true((SELECT public.private_application_verification_state(id)->'evidence'->>'coMaker'='1' FROM public.loan_applications WHERE application_id='APP-CONSENT'),'selected co-maker evidence accepted');
UPDATE public.loan_applications SET co_maker_member_id='20000000-0000-0000-0000-000000000006' WHERE application_id='APP-CONSENT';
SELECT pg_temp.assert_true((SELECT public.private_application_verification_state(id)->'evidence'->>'coMaker'='0' FROM public.loan_applications WHERE application_id='APP-CONSENT'),'changing selected co-maker invalidates old packet consent');
UPDATE public.members SET user_id=null WHERE id='20000000-0000-0000-0000-000000000006';
INSERT INTO public.application_consent_evidence(application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at)
SELECT id,'co_maker','TEST-6',null,'paper','SYNTHETIC selected paper subject',public.private_application_verification_state(id)->>'packetHash',now() FROM public.loan_applications WHERE application_id='APP-CONSENT';
SELECT pg_temp.assert_true((SELECT public.private_application_verification_state(id)->'evidence'->>'coMaker'='1' FROM public.loan_applications WHERE application_id='APP-CONSENT'),'paper evidence can identify the exact selected member without fabricating an Auth account');
SELECT 'PASS: 3-of-3 CRECOM, Super Admin authority, conditional BOD, immutable confirmations, private history, clarification/reassignment, stale packets, revocation, selected co-maker consent and trusted release gate' AS result;
