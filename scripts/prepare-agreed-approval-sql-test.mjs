import {readFileSync,writeFileSync} from 'node:fs';
const read=path=>readFileSync(path,'utf8').replaceAll('\r\n','\n');
const base=read('docs/committee-signatories/staging-rollback-test.sql').split('CREATE FUNCTION pg_temp.seat(')[0];
if(!base.includes('CREATE FUNCTION pg_temp.respond'))throw Error('Missing isolated fixture setup.');
const migration=read('supabase/migrations/20261111140000_agreed_approval_workflow.sql').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
const releaseColumns="ALTER TABLE public.loan_applications ADD COLUMN date_released date,ADD COLUMN date_completed date,ADD COLUMN updated_at timestamptz,ADD COLUMN release_reference text UNIQUE,ADD COLUMN release_notes text,ADD COLUMN released_by uuid,ADD COLUMN released_by_name text,ADD COLUMN release_request_id uuid UNIQUE,ADD COLUMN interest_rate_at_release numeric,ADD COLUMN processing_fee_rate_at_release numeric,ADD COLUMN service_fee_rate_at_release numeric,ADD COLUMN processing_fee_amount_at_release numeric,ADD COLUMN service_fee_amount_at_release numeric; ALTER TABLE public.loan_policy_settings ADD COLUMN processing_fee_percent numeric DEFAULT 1,ADD COLUMN service_fee_percent numeric DEFAULT 0.5;\n";
writeFileSync('docs/approval-workflow/staging-rollback-test.sql',base+'\n'+releaseColumns+migration+'\n'+read('supabase/tests/agreed-approval-cases.sql')+'\nROLLBACK;\n');
console.log('Prepared staging-only approval/return/resubmit tests. Schema and synthetic data end in ROLLBACK.');
