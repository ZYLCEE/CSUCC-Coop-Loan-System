CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END$$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'Expected rejection: %',command;
END$$;
CREATE FUNCTION pg_temp.workflow_action(actor uuid,application text,action text,revision integer,state_hash text,payload jsonb,request uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.application_workflow_action($1,jsonb_build_object(
  'applicationId',$2,'operation',$3,'revision',$4,'stateHash',$5,'payload',$6,'requestId',$7))
$$;
CREATE FUNCTION pg_temp.act(action text,payload jsonb DEFAULT '{}',application text DEFAULT 'APP-VERIFY') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb;
BEGIN
 state:=public.get_application_verification(application);
 RETURN pg_temp.workflow_action(auth.uid(),application,action,(state->>'revision')::integer,state->>'stateHash',payload,gen_random_uuid());
END$$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES
 ('10000000-0000-0000-0000-000000000001','workflow-super@example.invalid','{"role":"super_admin","account_status":"active"}','{"full_name":"Synthetic coordinator"}'),
 ('10000000-0000-0000-0000-000000000002','workflow-reader@example.invalid','{"role":"admin","account_status":"active","admin_privileges":[]}','{}'),
 ('10000000-0000-0000-0000-000000000003','workflow-member@example.invalid','{"role":"member","account_status":"active"}','{}'),
 ('10000000-0000-0000-0000-000000000004','workflow-co-maker@example.invalid','{"role":"member","account_status":"active"}','{}'),
 ('10000000-0000-0000-0000-000000000005','workflow-reviewer@example.invalid','{"role":"crecom_member","account_status":"active"}','{}');
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,membership_type) VALUES
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','TEST-3','Synthetic','Borrower','Regular'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','TEST-4','Synthetic','Co-maker','Regular');
INSERT INTO public.loan_applications(id,application_id,member_id,member_name,loan_type,amount,status,date_submitted,tenure_months,monthly_payment) VALUES
 ('30000000-0000-0000-0000-000000000001','APP-VERIFY','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',1000,'pending',current_date,12,100),
 ('30000000-0000-0000-0000-000000000002','APP-LEGACY','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',1000,'approved',current_date,12,100),
 ('30000000-0000-0000-0000-000000000003','APP-UNSTARTED-RETURN','20000000-0000-0000-0000-000000000003','Synthetic Borrower','Business',1000,'pending',current_date,12,100);
INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','validId','owner/id.pdf','id.pdf','application/pdf',10),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','payslip','owner/payslip.pdf','payslip.pdf','application/pdf',10);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true(public.get_application_verification('APP-VERIFY')->>'stage'='not_started','read-only staff sees stage');
SELECT pg_temp.denied($q$SELECT pg_temp.act('start')$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.save_approval_policy_draft(null,'{}',gen_random_uuid())$q$,'42501');
SELECT pg_temp.denied($q$INSERT INTO public.application_consent_evidence(application_id,kind) VALUES('30000000-0000-0000-0000-000000000001','borrower')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT pg_temp.act('start','{}','APP-LEGACY')$q$,'P0001');
DO $$
DECLARE state jsonb; request uuid:=gen_random_uuid(); payload jsonb:='{"category":"information","reason":"Please upload the missing required documents.","affectedKinds":[]}'; result jsonb;
BEGIN
 state:=public.get_application_verification('APP-UNSTARTED-RETURN');
 result:=pg_temp.workflow_action(auth.uid(),'APP-UNSTARTED-RETURN','return',0,state->>'stateHash',payload,request);
 PERFORM pg_temp.assert_true(result->>'stage'='returned_for_requirements' AND (result->>'revision')::int=1,'return initializes and returns an unenrolled application');
 PERFORM pg_temp.assert_true(public.get_application_verification('APP-UNSTARTED-RETURN')->>'enrolled'='true','returned application is enrolled in verification');
 PERFORM pg_temp.assert_true(result=pg_temp.workflow_action(auth.uid(),'APP-UNSTARTED-RETURN','return',0,state->>'stateHash',payload,request),'unstarted return retry returns saved result');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.application_workflow_events WHERE application_id='30000000-0000-0000-0000-000000000003' AND action='return'),'unstarted return is recorded once');
 PERFORM pg_temp.assert_true((SELECT status='returned' FROM public.loan_applications WHERE application_id='APP-UNSTARTED-RETURN'),'unstarted return updates loan status');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.application_email_outbox WHERE application_id='30000000-0000-0000-0000-000000000003'),'unstarted return queues one member email');
END$$;
DO $$
DECLARE state jsonb; request uuid:=gen_random_uuid(); result jsonb;
BEGIN
 state:=public.get_application_verification('APP-VERIFY');
 result:=pg_temp.workflow_action(auth.uid(),'APP-VERIFY','start',0,state->>'stateHash','{}',request);
 PERFORM pg_temp.assert_true(result=pg_temp.workflow_action(auth.uid(),'APP-VERIFY','start',0,state->>'stateHash','{}',request),'start retry returns saved result');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.application_workflow_events),'enrollment is exactly once');
 PERFORM pg_temp.denied(format('SELECT pg_temp.workflow_action(%L::uuid,''APP-VERIFY'',''start'',0,%L,''{}'',%L::uuid)',
   auth.uid(),state->>'stateHash',gen_random_uuid()),'40001');
END$$;
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
SELECT pg_temp.act('save_draft','{"checks":{"identity":true,"eligibility":true,"terms":true},"notes":"INTERNAL_ONLY"}');
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
SELECT pg_temp.assert_true((public.get_application_verification('APP-VERIFY')->'evidence'->>'borrower')::int=0,'staff checks do not manufacture borrower consent');
SELECT public.save_approval_policy_draft(null,'{"name":"DEMO ONLY synthetic policy","authorizationReference":"","status":"approved","config":{"reviewerCount":null,"quorumRule":"","crecomAuthority":"pending","bodMode":"pending","bodCriteria":"","finalAuthority":"","borrowerConsentRequired":null,"coMakerConsentRequired":null,"witnessCount":null,"allowedConsentMethods":[],"requirementsReference":""}}',gen_random_uuid());
SELECT pg_temp.assert_true((SELECT status='draft' FROM public.approval_workflow_policies),'policy draft cannot self-activate');
SELECT pg_temp.denied($q$UPDATE public.approval_workflow_policies SET status='approved'$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.save_approval_policy_draft(null,'{}',gen_random_uuid())$q$,'40001');
SELECT pg_temp.denied($q$SELECT pg_temp.act('return','{"category":"documents","reason":" ","affectedKinds":["validId"]}')$q$,'P0001');
DO $$
DECLARE state jsonb; request uuid:=gen_random_uuid(); payload jsonb:='{"category":"documents","reason":"Please replace the blurred ID photo.","affectedKinds":["validId"]}'; result jsonb;
BEGIN
 state:=public.get_application_verification('APP-VERIFY');
 result:=pg_temp.workflow_action(auth.uid(),'APP-VERIFY','return',(state->>'revision')::int,state->>'stateHash',payload,request);
 PERFORM pg_temp.assert_true(result=pg_temp.workflow_action(auth.uid(),'APP-VERIFY','return',(state->>'revision')::int,state->>'stateHash',payload,request),'correction retry does not duplicate delivery');
 PERFORM pg_temp.denied(format('SELECT pg_temp.workflow_action(%L::uuid,''APP-VERIFY'',''save_draft'',%s,%L,''{}'',%L::uuid)',
   auth.uid(),state->>'revision',state->>'stateHash',gen_random_uuid()),'40001');
END$$;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.loan_document_reviews WHERE status='needs_replacement'),'selected file is actionable in member replacement flow');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.member_application_corrections())=1,'affected borrower sees correction');
SELECT pg_temp.assert_true(public.member_application_corrections()::text NOT LIKE '%INTERNAL_ONLY%','internal notes never sent to member');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.notifications),'one safe correction inbox item');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.application_workflow_events),'member cannot read staff event history');
SELECT pg_temp.denied($q$SELECT public.get_application_verification('APP-VERIFY')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true(jsonb_array_length(public.member_application_corrections())=0,'other member cannot read correction');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
SELECT pg_temp.denied($q$SELECT public.application_workflow_summaries()$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.act('save_draft','{"checks":{"identity":true,"eligibility":true,"terms":true},"notes":"Reviewed again"}');
RESET ROLE;
-- A synthetic approved configuration/evidence is injected by the test owner only.
-- The production feature has no policy activation or consent-forging endpoint.
SELECT pg_temp.denied($q$UPDATE public.approval_workflow_policies SET status='approved',authorization_reference='DEMO ONLY',approved_by='10000000-0000-0000-0000-000000000001',approved_at=now(),effective_at=now()$q$,'23514');
UPDATE public.approval_workflow_policies SET status='approved',authorization_reference='DEMO ONLY test authorization',
 approved_by='10000000-0000-0000-0000-000000000001',approved_at=now(),effective_at=now(),
 config='{"reviewerCount":3,"quorumRule":"Synthetic test rule","crecomAuthority":"recommendation","bodMode":"none","bodCriteria":"","finalAuthority":"Synthetic designated officer","borrowerConsentRequired":true,"coMakerConsentRequired":true,"witnessCount":1,"allowedConsentMethods":["paper"],"requirementsReference":"DEMO ONLY"}';
INSERT INTO public.loan_document_reviews(document_id,status,reviewer_id,reviewer_name) SELECT id,'verified','10000000-0000-0000-0000-000000000001','Synthetic coordinator' FROM public.loan_documents;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act('save_draft','{"checks":{"identity":true,"eligibility":true,"terms":true},"notes":"All staff checks complete"}');
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
RESET ROLE;
INSERT INTO public.application_consent_evidence(application_id,kind,subject_reference,subject_user_id,method,evidence_reference,packet_hash,occurred_at)
SELECT '30000000-0000-0000-0000-000000000001',kind,subject,subject_id,'paper','Synthetic evidence fixture',
 public.private_application_verification_state('30000000-0000-0000-0000-000000000001')->>'packetHash',now()
FROM (VALUES('borrower','TEST-3','10000000-0000-0000-0000-000000000003'::uuid),('co_maker','TEST-4','10000000-0000-0000-0000-000000000004'::uuid),('witness','EXTERNAL-WITNESS',null::uuid)) AS e(kind,subject,subject_id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.act('mark_verified');
SELECT pg_temp.assert_true(public.get_application_verification('APP-VERIFY')->>'stage'='ready_for_committee','complete verified packet becomes ready');
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.loan_applications WHERE application_id='APP-VERIFY'),'verification preserves canonical loan status');
RESET ROLE;
SELECT pg_temp.denied($q$UPDATE public.loan_applications SET status='approved' WHERE application_id='APP-VERIFY'$q$,'42501');
UPDATE public.loan_applications SET status='released' WHERE application_id='APP-LEGACY';
SELECT pg_temp.assert_true((SELECT status='released' FROM public.loan_applications WHERE application_id='APP-LEGACY'),'unenrolled legacy servicing remains available');
INSERT INTO public.loan_document_versions(document_id,version,storage_path,original_name,content_type,size_bytes,uploaded_by,uploaded_by_name)
VALUES('40000000-0000-0000-0000-000000000001',2,'owner/replacement.pdf','replacement.pdf','application/pdf',10,'10000000-0000-0000-0000-000000000003','Synthetic borrower');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.get_application_verification('APP-VERIFY')->>'stage'='needs_verification','replacement invalidates readiness');
SELECT pg_temp.assert_true((public.get_application_verification('APP-VERIFY')->>'stale')::boolean,'stale verification is explicit');
SELECT pg_temp.assert_true((public.application_workflow_summaries()->0->>'stage')='needs_verification','table filter uses effective current stage');
SELECT pg_temp.denied($q$SELECT pg_temp.act('mark_verified')$q$,'P0001');
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data='{"role":"admin","account_status":"active","admin_privileges":["applications.verify"]}' WHERE id='10000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.act('save_draft','{"checks":{"identity":false,"eligibility":true,"terms":true},"notes":"Delegated verification"}');
SELECT pg_temp.denied($q$SELECT pg_temp.act('return','{"category":"information","reason":"Correct details.","affectedKinds":[]}')$q$,'42501');
RESET ROLE;
SELECT 'PASS: enrollment, draft permissions, consent provenance, correction privacy, policy drafts, idempotency, stale versions, legacy servicing and approval guard' AS result;
