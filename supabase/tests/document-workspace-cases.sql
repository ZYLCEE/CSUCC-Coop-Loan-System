CREATE FUNCTION pg_temp.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.denied(command text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected_state THEN RETURN; ELSE RAISE; END IF; END;
  RAISE EXCEPTION 'Expected rejection: %',command;
END $$;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES
 ('10000000-0000-0000-0000-000000000001','staff-documents-test@example.invalid','{"role":"super_admin","account_status":"active"}','{"full_name":"Test reviewer"}'),
 ('10000000-0000-0000-0000-000000000002','reader-documents-test@example.invalid','{"role":"admin","account_status":"active","admin_privileges":[]}','{}'),
 ('10000000-0000-0000-0000-000000000003','member-one-documents-test@example.invalid','{"role":"member","account_status":"active"}','{}'),
 ('10000000-0000-0000-0000-000000000004','member-two-documents-test@example.invalid','{"role":"member","account_status":"active"}','{}');
INSERT INTO public.members(id,user_id,member_id,first_name,last_name,membership_type) VALUES
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','TEST-3','Synthetic','Member One','Regular'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','TEST-4','Synthetic','Member Two','Associate');
INSERT INTO public.loan_applications VALUES('30000000-0000-0000-0000-000000000001','TEST-APP','20000000-0000-0000-0000-000000000003','Synthetic Member One','Business',1000,'pending',current_date);
INSERT INTO public.loan_documents(id,loan_application_id,user_id,kind,storage_path,original_name,content_type,size_bytes) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','validId','10000000-0000-0000-0000-000000000003/original.pdf','original.pdf','application/pdf',10);
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('loan-documents','10000000-0000-0000-0000-000000000003/original.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('loan-documents','10000000-0000-0000-0000-000000000003/replacement.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('coop-shared-documents','10000000-0000-0000-0000-000000000001/selected.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('coop-shared-documents','10000000-0000-0000-0000-000000000001/all.pdf','{"size":10,"mimetype":"application/pdf"}'),
 ('coop-shared-documents','10000000-0000-0000-0000-000000000001/draft.pdf','{"size":10,"mimetype":"application/pdf"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.assert_true((public.document_workspace_capabilities()->>'canReview')::boolean=false,'read-only admin cannot review');
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'verified',null)$q$,'42501');
SELECT pg_temp.denied($q$SELECT public.search_document_recipients('Synthetic')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.search_document_recipients('Synthetic Member One')),'full name recipient search');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.search_document_recipients('%')),'search wildcard is literal');
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'needs_replacement','  ')$q$,'P0001');
SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'needs_replacement','The ID photo is blurred. Upload a clear copy.');
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'verified',null)$q$,'40001');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.loan_document_reviews),'owner sees review reason');
SELECT public.submit_document_replacement('40000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000003/replacement.pdf','replacement.pdf','application/pdf',10);
SELECT public.submit_document_replacement('40000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000003/replacement.pdf','replacement.pdf','application/pdf',10);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.loan_document_versions),'replacement retry is idempotent');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_document_reviews WHERE version_id IS NOT NULL),'new version has no inherited review');
SELECT pg_temp.denied($q$DELETE FROM public.loan_document_versions$q$,'42501');
-- DELETE returns no rows under RLS. Submitted original and replacement remain.
SET LOCAL storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='loan-documents';
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='loan-documents'),'original and replacement cannot be deleted');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_document_versions),'other member cannot read versions');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.loan_document_reviews),'other member cannot read reviews');
SELECT pg_temp.denied($q$SELECT public.submit_document_replacement('40000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-000000000004/wrong.pdf','wrong.pdf','application/pdf',10)$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',null,null,'verified',null)$q$,'40001');
SELECT public.record_document_review('40000000-0000-0000-0000-000000000001',(SELECT id FROM public.loan_document_versions LIMIT 1),null,'verified',null);
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.loan_applications LIMIT 1),'verification never approves a loan');
SELECT public.save_shared_document('{"id":"50000000-0000-0000-0000-000000000001","title":"Selected test","category":"Forms","audience":"selected","recipient_ids":["20000000-0000-0000-0000-000000000003"],"publish":true,"storage_path":"10000000-0000-0000-0000-000000000001/selected.pdf","original_name":"selected.pdf","content_type":"application/pdf","size_bytes":10,"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
SELECT public.save_shared_document('{"id":"50000000-0000-0000-0000-000000000002","title":"All test","category":"Forms","audience":"all","recipient_ids":[],"publish":true,"storage_path":"10000000-0000-0000-0000-000000000001/all.pdf","original_name":"all.pdf","content_type":"application/pdf","size_bytes":10,"fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
SELECT public.save_shared_document('{"id":"50000000-0000-0000-0000-000000000003","title":"Draft test","category":"Forms","audience":"all","recipient_ids":[],"publish":false,"storage_path":"10000000-0000-0000-0000-000000000001/draft.pdf","original_name":"draft.pdf","content_type":"application/pdf","size_bytes":10,"fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.shared_documents),'chosen member sees selected plus all, not draft');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.shared_document_recipients),'member sees only own assignment');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'file storage follows same audience');
SELECT pg_temp.denied($q$SELECT public.save_shared_document('{}')$q$,'42501');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.shared_documents),'unselected member sees all-members document only');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.shared_document_recipients),'unselected member cannot enumerate recipients');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'unselected member cannot read selected or draft files');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='10000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.shared_documents),'banned member cannot read shared documents');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.denied($q$SELECT public.publish_shared_document('50000000-0000-0000-0000-000000000003','2000-01-01','selected','{}')$q$,'40001');
SELECT pg_temp.denied($q$SELECT public.publish_shared_document('50000000-0000-0000-0000-000000000003',(SELECT updated_at FROM public.shared_documents WHERE id='50000000-0000-0000-0000-000000000003'),'selected','{}')$q$,'P0001');
SELECT public.publish_shared_document('50000000-0000-0000-0000-000000000003',(SELECT updated_at FROM public.shared_documents WHERE id='50000000-0000-0000-0000-000000000003'),'selected',ARRAY['20000000-0000-0000-0000-000000000003']::uuid[]);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM public.shared_documents),'draft becomes visible after explicit publish');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT public.delete_shared_document('50000000-0000-0000-0000-000000000001',(SELECT updated_at FROM public.shared_documents WHERE id='50000000-0000-0000-0000-000000000001'));
SELECT public.delete_shared_document('50000000-0000-0000-0000-000000000001','2000-01-01');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.shared_documents),'deletion removes member metadata access');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'deletion removes file access');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM storage.objects WHERE bucket_id='coop-shared-documents'),'soft deletion retains stored originals');
UPDATE public.members SET status='blocked' WHERE user_id='10000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
DELETE FROM storage.objects WHERE bucket_id='loan-documents';
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM storage.objects WHERE bucket_id='loan-documents'),'inactive owner cannot delete retained files through hidden review metadata');
SELECT 'PASS: review permissions, concurrency, ownership, replacement retention, recipient privacy, draft publication and deletion' AS result;
