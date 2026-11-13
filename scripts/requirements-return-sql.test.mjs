// Offline PostgreSQL regression: no hosted application, consent or vote changes.
import {PGlite} from "../node_modules/.committee-sql-qa/node_modules/@electric-sql/pglite/dist/index.js";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
const db=new PGlite();
function extract(file,name){
 const source=readFileSync(file,"utf8"),match=source.match(new RegExp('create(?: or replace)? function public[.]'+name+'\\(','i'));
 assert.ok(match,name);const tail=source.slice(match.index),delimiter=tail.match(/as (\$\w*\$)/i)[1],start=tail.indexOf(delimiter);
 return tail.slice(0,tail.indexOf(delimiter+';',start+delimiter.length)+delimiter.length+1);
}
await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,role text,allowed boolean DEFAULT true);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE members(id uuid PRIMARY KEY,user_id uuid,status text DEFAULT 'active');
 CREATE TABLE loan_applications(id uuid PRIMARY KEY,application_id text UNIQUE,member_id uuid,status text DEFAULT 'pending');
 CREATE TABLE application_verifications(application_id uuid PRIMARY KEY,stage text DEFAULT 'needs_verification',revision integer DEFAULT 1,checks jsonb DEFAULT '{"identity":false,"eligibility":false,"terms":false}',notes text DEFAULT '',policy_id uuid,verified_state_hash text,verified_snapshot jsonb,verified_by uuid,verified_at timestamptz,updated_by uuid,updated_at timestamptz);
 CREATE TABLE application_final_decisions(application_id uuid PRIMARY KEY,decision text);
 CREATE TABLE application_review_cycles(id uuid PRIMARY KEY,application_id uuid,status text DEFAULT 'open',closed_at timestamptz);
 CREATE TABLE review_assignments(id uuid PRIMARY KEY,review_cycle_id uuid,state text DEFAULT 'assigned',revision integer DEFAULT 1);
 CREATE TABLE loan_documents(id uuid PRIMARY KEY,loan_application_id uuid,kind text);
 CREATE TABLE loan_document_versions(id uuid PRIMARY KEY,document_id uuid,version integer);
 CREATE TABLE loan_document_reviews(document_id uuid,version_id uuid,status text,reason text,reviewer_id uuid,reviewer_name text);
 CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,message text,type text,read boolean);
 CREATE TABLE application_workflow_events(application_id uuid,request_id uuid UNIQUE,request_hash text,actor_id uuid,actor_name text,action text,details jsonb,result jsonb,notification_id uuid);
 CREATE TABLE admin_activity_logs(actor_id uuid,action_name text,target_id text,result text,details jsonb);
 CREATE FUNCTION document_staff_access(p_privilege text DEFAULT NULL) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT coalesce((SELECT role IN ('super_admin','admin') AND allowed FROM auth.users WHERE id=auth.uid()),false)$$;
 CREATE FUNCTION document_actor_label() RETURNS text LANGUAGE sql AS $$SELECT 'Synthetic Staff'::text$$;
 -- Deliberately incomplete: returning must never require the verification blockers to clear.
 CREATE FUNCTION private_application_verification_state(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('stateHash',repeat('a',64),'policy',null,'blockers',jsonb_build_array('Missing ID','Missing borrower consent','Missing witnesses'))$$;
`);
await db.exec(extract('supabase/migrations/20261111_committee_review.sql','committee_transition_allowed'));
await db.exec(extract('supabase/migrations/20261111_committee_review.sql','guard_enrolled_application_decision'));
await db.exec(`CREATE TRIGGER guard_enrolled_application_decision BEFORE UPDATE OF status ON loan_applications FOR EACH ROW EXECUTE FUNCTION guard_enrolled_application_decision();`);
assert.equal((await db.query("SELECT to_regclass('public.application_email_outbox') AS table_name")).rows[0].table_name,null);
await db.exec(readFileSync('supabase/repairs/20261113172300_restore_application_return_email_outbox.sql','utf8'));
assert.equal((await db.query("SELECT to_regclass('public.application_email_outbox') AS table_name")).rows[0].table_name,'application_email_outbox');
assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.application_email_outbox'::regclass")).rows[0].relrowsecurity,true);
await db.exec(extract('supabase/migrations/20261112090000_allow_return_before_verification.sql','mutate_application_verification'));
await db.exec(extract('supabase/migrations/20261111140000_agreed_approval_workflow.sql','application_workflow_action'));
const uuid=n=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`,staff=uuid(1),borrower=uuid(2),member=uuid(3),denied=uuid(4);
await db.query("INSERT INTO auth.users VALUES($1,'staff@synthetic.invalid','admin',true),($2,'member@synthetic.invalid','member',true),($3,'denied@synthetic.invalid','admin',false)",[staff,borrower,denied]);
await db.query('INSERT INTO members(id,user_id) VALUES($1,$2)',[member,borrower]);
async function loan(n,{enrolled=true,status='pending',final=null}={}){
 await db.query('INSERT INTO loan_applications VALUES($1,$2,$3,$4)',[uuid(n),'APP-'+n,member,status]);
 if(enrolled)await db.query('INSERT INTO application_verifications(application_id) VALUES($1)',[uuid(n)]);
 if(final)await db.query('INSERT INTO application_final_decisions VALUES($1,$2)',[uuid(n),final]);
}
const payload={category:'information',reason:'Upload your missing ID and provide the agreement and witness names.',affectedKinds:[]};
const body=(n,options={})=>({applicationId:'APP-'+n,operation:'return',revision:options.revision??1,stateHash:options.stateHash??'a'.repeat(64),payload:options.payload??payload,requestId:options.requestId??uuid(n+1000)});
async function action(n,options={}){return (await db.query('SELECT application_workflow_action($1,$2::jsonb) AS result',[options.actor??staff,JSON.stringify(body(n,options))])).rows[0].result;}
async function count(table){return (await db.query(`SELECT count(*)::integer AS count FROM ${table}`)).rows[0].count;}
async function status(n){return (await db.query('SELECT status FROM loan_applications WHERE id=$1',[uuid(n)])).rows[0].status;}
try{
 await loan(10);
 await assert.rejects(action(10),/authorized committee, final-decision and servicing procedures/);
 assert.equal(await status(10),'pending');assert.equal(await count('notifications'),0);assert.equal(await count('application_workflow_events'),0);
 const patch=readFileSync('supabase/migrations/20261112100000_allow_requirements_return_transition.sql','utf8');await db.exec(patch);await db.exec(patch);
 const returned=await action(10);assert.equal(returned.stage,'returned_for_requirements');assert.equal(await status(10),'returned');
 assert.deepEqual(await action(10),returned);assert.equal(await count('notifications'),1);assert.equal(await count('application_email_outbox'),1);assert.equal(await count('admin_activity_logs'),1);
 await assert.rejects(action(10,{payload:{...payload,reason:'Changed replay'}}),/request reference was already used/);
 await loan(20,{enrolled:false});const fresh=await action(20,{revision:0});assert.equal(fresh.stage,'returned_for_requirements');assert.equal(fresh.revision,1);assert.equal(await status(20),'returned');
 await loan(30,{status:'under review'});await db.query('INSERT INTO application_review_cycles(id,application_id) VALUES($1,$2)',[uuid(31),uuid(30)]);await db.query('INSERT INTO review_assignments(id,review_cycle_id) VALUES($1,$2)',[uuid(32),uuid(31)]);await action(30);
 assert.equal((await db.query('SELECT status FROM application_review_cycles WHERE id=$1',[uuid(31)])).rows[0].status,'superseded');assert.equal((await db.query('SELECT state FROM review_assignments WHERE id=$1',[uuid(32)])).rows[0].state,'cancelled');
 for(const [n,settings,options,pattern] of [
  [40,{}, {actor:borrower},/permission is required/],
  [41,{}, {actor:denied},/permission is required/],
  [42,{}, {revision:99},/Another staff member/],
  [43,{}, {stateHash:'b'.repeat(64)},/documents or evidence changed/],
  [44,{}, {payload:{...payload,reason:''}},/specific member-visible instructions/],
  [45,{final:'approve'},{},/authorized committee/],
  [46,{status:'approved',final:'approve'},{},/Pending or Under Review/],
  [47,{status:'released',final:'approve'},{},/Pending or Under Review/],
 ]){
  await loan(n,settings);const notices=await count('notifications');await assert.rejects(action(n,options),pattern);assert.equal(await status(n),settings.status??'pending');assert.equal(await count('notifications'),notices);
 }
 // The status guard is still enforced for direct authenticated table writes.
 await loan(50);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[staff]);await db.exec('GRANT SELECT,UPDATE ON loan_applications TO authenticated;SET ROLE authenticated');
 await assert.rejects(db.query("UPDATE loan_applications SET status='returned' WHERE application_id='APP-50'"),/authorized committee/);await db.exec('RESET ROLE');
 // No accidental relaxation of approvals, release, or final-decision rules.
 for(const next of ['approved','rejected','released','completed'])assert.equal((await db.query("SELECT committee_transition_allowed($1,'pending',$2,'postgres') AS allowed",[uuid(50),next])).rows[0].allowed,false);
 await loan(60,{final:'approve'});assert.equal((await db.query("SELECT committee_transition_allowed($1,'approved','released','postgres') AS allowed",[uuid(60)])).rows[0].allowed,true);
 console.log('Passed: reproduced the old guard error; pending/unstarted and under-review incomplete applications return atomically with instructions, notices and logs; replay, stale data, unauthorized users, final decisions and direct writes remain protected. No hosted records changed.');
}finally{await db.close();}
