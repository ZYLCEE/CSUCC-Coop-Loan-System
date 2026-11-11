CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END$$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'Expected rejection: %',command;
END$$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,encrypted_password) VALUES
 ('10000000-0000-0000-0000-000000000001','committee-super@example.invalid','{"role":"super_admin","account_status":"active"}','{"full_name":"Synthetic Super Admin"}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000002','committee-admin@example.invalid','{"role":"admin","account_status":"active"}','{}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000003','committee-borrower@example.invalid','{"role":"member","account_status":"active"}','{}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000005','committee-b@example.invalid','{"role":"crecom_member","account_status":"active"}','{"full_name":"Reviewer B"}',now(),'synthetic-hash'),
 ('10000000-0000-0000-0000-000000000006','committee-bod@example.invalid','{"role":"bod_member","account_status":"active"}','{}',now(),'synthetic-hash');
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,status,role) VALUES
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','TEST-3','Synthetic','Borrower','active','Member');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.denied($q$SELECT public.committee_accounts()$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),'{}')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT public.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),'{"name":"BOD","email":"new-bod@example.invalid","role":"bod_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":""}')$q$,'P0001');
SELECT pg_temp.denied($q$SELECT public.committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),'{"name":"Borrower","email":"committee-borrower@example.invalid","role":"crecom_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":""}')$q$,'P0001');
SELECT public.committee_reserve_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','{"name":"Reviewer A","email":"committee-a@example.invalid","role":"crecom_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":"Committee member"}');
SELECT pg_temp.denied($q$SELECT public.committee_reserve_invite('60000000-0000-0000-0000-000000000001',gen_random_uuid(),'{"name":"Reviewer A","email":"committee-a@example.invalid","role":"crecom_member","startsAt":"2026-01-01T00:00:00Z","endsAt":null,"title":"Committee member"}')$q$,'55P03');
RESET ROLE;
-- Synthetic account-provider response: no email is sent by this test.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,invited_at)
 VALUES('10000000-0000-0000-0000-000000000004','committee-a@example.invalid','{}','{"full_name":"Reviewer A","committee_invitation_request_id":"60000000-0000-0000-0000-000000000001"}',now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied($q$SELECT public.committee_finish_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004')$q$,'P0001');
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data='{"role":"crecom_member","account_status":"active","committee_invitation_request_id":"60000000-0000-0000-0000-000000000001"}' WHERE id='10000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT public.committee_finish_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004');
SELECT public.committee_finish_invite('60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.staff_memberships),'invitation retry creates one membership');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'invited account cannot enter before setup');
SELECT pg_temp.denied($q$SELECT public.committee_complete_setup('10000000-0000-0000-0000-000000000004')$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.committee_workspace()$q$,'42501');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now(),encrypted_password='synthetic-provider-updated-hash' WHERE id='10000000-0000-0000-0000-000000000004';
SELECT public.committee_complete_setup('10000000-0000-0000-0000-000000000004');
INSERT INTO public.staff_memberships(id,auth_user_id,role,active,starts_at,assigned_by,setup_completed_at) VALUES
 ('80000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','crecom_member',true,now()-interval '1 day','10000000-0000-0000-0000-000000000001',now()),
 ('80000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','bod_member',true,now()-interval '1 day','10000000-0000-0000-0000-000000000001',now());
INSERT INTO public.approval_workflow_policies(id,name,status,config,authorization_reference,effective_at,approved_by,approved_at,created_by,created_by_name)
 VALUES('90000000-0000-0000-0000-000000000001','DEMO ONLY','approved','{"reviewerCount":3,"quorumRule":"DEMO ONLY","crecomAuthority":"recommendation","bodMode":"none","bodCriteria":"","finalAuthority":"DEMO ONLY","borrowerConsentRequired":true,"coMakerConsentRequired":true,"witnessCount":0,"allowedConsentMethods":["paper"],"requirementsReference":"DEMO ONLY"}','DEMO ONLY',now()-interval '1 day','10000000-0000-0000-0000-000000000001',now(),'10000000-0000-0000-0000-000000000001','Synthetic Super Admin');
INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted) VALUES
 ('30000000-0000-0000-0000-000000000001','APP-ASSIGNED','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',2000,'pending',current_date),
 ('30000000-0000-0000-0000-000000000002','APP-UNRELATED','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',5000,'pending',current_date);
INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','validId','10000000-0000-0000-0000-000000000003/original.pdf','original.pdf','application/pdf',10),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','validId','10000000-0000-0000-0000-000000000003/unrelated.pdf','unrelated.pdf','application/pdf',10);
INSERT INTO public.loan_document_versions(id,document_id,version,storage_path,original_name,content_type,size_bytes,uploaded_by,uploaded_by_name)
 VALUES('41000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',2,'10000000-0000-0000-0000-000000000003/replacement.pdf','replacement.pdf','application/pdf',10,'10000000-0000-0000-0000-000000000003','Synthetic borrower');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('loan-documents','10000000-0000-0000-0000-000000000003/original.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('loan-documents','10000000-0000-0000-0000-000000000003/replacement.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('loan-documents','10000000-0000-0000-0000-000000000003/unrelated.pdf','{"size":10,"mimetype":"application/pdf"}');
INSERT INTO public.application_review_cycles(id,application_id,cycle_no,stage,packet_version,packet_snapshot,policy_id,created_by) VALUES
 ('a0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'CRECOM',1,'{"summary":{"applicationId":"APP-ASSIGNED","applicant":"Synthetic Borrower","memberNumber":"TEST-3","loanType":"Business","amount":1000},"documents":[{"documentId":"40000000-0000-0000-0000-000000000001","versionId":null,"kind":"validId","name":"original.pdf"}],"staffFindings":"Synthetic findings"}','90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',1,'CRECOM',1,'{"summary":{"applicationId":"APP-UNRELATED","applicant":"Synthetic Borrower","memberNumber":"TEST-3","loanType":"Business","amount":5000},"documents":[]}','90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO public.review_assignments(id,review_cycle_id,reviewer_auth_id,membership_id,state)
 SELECT 'b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',id,'decision_recorded' FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004';
INSERT INTO public.review_assignments(id,review_cycle_id,reviewer_auth_id,membership_id) VALUES
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','80000000-0000-0000-0000-000000000005'),
 ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','80000000-0000-0000-0000-000000000005');
INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,packet_version,decision) VALUES('b0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004',1,'approve');
SELECT pg_temp.denied($q$UPDATE public.individual_review_decisions SET decision='reject'$q$,'42501');
INSERT INTO public.notifications(id,user_id,title,message,type) VALUES
 ('c0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','Assigned case','APP-ASSIGNED','info'),
 ('c0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','Private other reviewer','APP-UNRELATED','info');
INSERT INTO public.committee_notification_links VALUES('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001');
-- Even a permissive legacy read policy cannot expose these tables to committee users.
CREATE POLICY synthetic_legacy_read ON public.loan_applications FOR SELECT TO authenticated USING(true);
ALTER TABLE public.loan_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_legacy_members_read ON public.members FOR SELECT TO authenticated USING(true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean,'active reviewer enters own portal');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_applications),'reviewer cannot bulk-read applications');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.members),'reviewer cannot read member directory');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_workspace()->'assignments')=1,'reviewer sees assigned cases only');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_workspace()->'history')=1,'own attributable history only');
SELECT pg_temp.assert_true(public.committee_review_packet('b0000000-0000-0000-0000-000000000001')->'summary'->>'amount'='1000','review uses frozen terms rather than mutable current loan');
SELECT pg_temp.denied($q$SELECT public.committee_review_packet('b0000000-0000-0000-0000-000000000003')$q$,'42501');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='loan-documents'),'only exact assigned file version is readable');
SELECT public.committee_document_location('b0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',null);
SELECT pg_temp.denied($q$SELECT public.committee_document_location('b0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001')$q$,'42501');
SELECT pg_temp.denied($q$INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,packet_version,decision) VALUES('b0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004',1,'approve')$q$,'42501');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_inbox())=1,'inbox is recipient scoped');
SELECT public.committee_inbox('c0000000-0000-0000-0000-000000000002',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'BOD access remains disabled without policy');
SELECT pg_temp.denied($q$SELECT public.committee_workspace()$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),2,'deactivate','{"reason":"Synthetic membership revocation"}','d0000000-0000-0000-0000-000000000001');
SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),2,'deactivate','{"reason":"Synthetic membership revocation"}','d0000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_account_assignments((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004')))=1,'deactivation preserves assignment history');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'revocation takes effect without JWT refresh');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='loan-documents'),'revoked account cannot obtain new file access');
SELECT pg_temp.denied($q$SELECT public.committee_review_packet('b0000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.individual_review_decisions),'historical decisions retained');
SELECT pg_temp.assert_true((SELECT read=false FROM public.notifications WHERE id='c0000000-0000-0000-0000-000000000002'),'cannot mark someone else notification read');
UPDATE public.approval_workflow_policies SET config=jsonb_set(jsonb_set(config,'{bodMode}','"required"'),'{bodCriteria}','"DEMO ONLY BOD rule"');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean,'BOD enabled only by approved configuration');
SELECT pg_temp.assert_true(jsonb_array_length(public.committee_workspace()->'assignments')=0,'BOD membership cannot read CRECOM queue');
RESET ROLE;
-- Current dates, optimistic revisions, and link cooldown remain enforced server-side.
UPDATE public.staff_memberships SET last_invite_at=now()-interval '2 minutes' WHERE auth_user_id='10000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied('SELECT public.'||'committee_reserve_invite(gen_random_uuid(),gen_random_uuid(),''{}'')','42501');
SELECT pg_temp.denied($q$SELECT public.committee_account_action('10000000-0000-0000-0000-000000000001','committee_change_membership','{}')$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),1,'reactivate','{"reason":"Stale revision"}',gen_random_uuid())$q$,'40001');
SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),3,'reactivate','{"reason":"Renewed membership"}','d0000000-0000-0000-0000-000000000002');
SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),4,'edit',jsonb_build_object('role','crecom_member','startsAt',now()-interval '1 year','endsAt',now()-interval '1 day','title','Member','reason','Expired appointment'),gen_random_uuid());
SELECT pg_temp.denied($q$SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),5,'reactivate','{"reason":"Expired reactivation"}',gen_random_uuid())$q$,'P0001');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'expired appointment denies access');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),5,'edit',jsonb_build_object('role','crecom_member','startsAt',now()+interval '1 day','endsAt',null,'title','Member','reason','Future appointment'),gen_random_uuid());
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((public.portal_session_access()->>'allowed')::boolean=false,'future appointment denies early case access');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),6,'edit',jsonb_build_object('role','crecom_member','startsAt',now()-interval '1 day','endsAt',null,'title','Member','reason','Current appointment'),gen_random_uuid());
SELECT public.committee_begin_link((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),7,'e0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001');
SELECT pg_temp.denied($q$SELECT public.committee_begin_link((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),8,gen_random_uuid(),gen_random_uuid())$q$,'55P03');
SELECT public.committee_finish_link('e0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001');
SELECT public.committee_finish_link('e0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001');
SELECT public.committee_change_membership((SELECT id FROM public.staff_memberships WHERE auth_user_id='10000000-0000-0000-0000-000000000004'),8,'edit',jsonb_build_object('role','bod_member','startsAt',now()-interval '1 day','endsAt',null,'title','BOD Member','reason','Authorized committee change'),gen_random_uuid());
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(public.portal_session_access()->>'role'='bod_member','role changes use trusted current metadata');
SELECT pg_temp.denied($q$SELECT public.committee_review_packet('b0000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.admin_activity_logs WHERE action_name='committee-setup-link'),'completed link replay does not duplicate audit');
SELECT 'PASS: invitation provisioning, password-step boundary, membership revisions/dates, link cooldown/replay, reviewer scope, pinned files, private notifications, revocation and conditional BOD' AS result;
