// Offline PostgreSQL checks: synthetic loans only, no hosted database changes.
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
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb DEFAULT '{}',banned_until timestamptz);
 CREATE TABLE public.members(id uuid,user_id uuid);
 CREATE TABLE public.loan_applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id text UNIQUE,member_id uuid,status text,amount numeric,date_submitted date,date_approved date,date_released date,date_completed date,release_request_id uuid UNIQUE,release_reference text UNIQUE,release_notes text,released_by uuid,released_by_name text,interest_rate_at_release numeric,processing_fee_rate_at_release numeric,service_fee_rate_at_release numeric,processing_fee_amount_at_release numeric,service_fee_amount_at_release numeric,updated_at timestamptz);
 CREATE TABLE public.loan_policy_settings(singleton boolean,base_interest_rate numeric,processing_fee_percent numeric,service_fee_percent numeric);
 INSERT INTO public.loan_policy_settings VALUES(true,2,1,0.5);
 CREATE TABLE public.admin_activity_logs(actor_id uuid,action_name text,target_id text,result text,details jsonb);
 CREATE TABLE public.application_verifications(application_id uuid);
 CREATE TABLE public.application_final_decisions(application_id uuid,decision text);
 CREATE FUNCTION public.document_staff_access() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT coalesce((SELECT raw_app_meta_data->>'role' IN ('super_admin','admin') FROM auth.users WHERE id=auth.uid()),false)$$;
`);
await db.exec(extract('supabase/migrations/20261108180000_counter_payment_interest.sql','release_approved_loan'));
for(const name of ['committee_transition_allowed','guard_enrolled_application_decision'])await db.exec(extract('supabase/migrations/20261111_committee_review.sql',name));
await db.exec(`CREATE TRIGGER guard_enrolled_application_decision BEFORE UPDATE OF status ON public.loan_applications FOR EACH ROW EXECUTE FUNCTION public.guard_enrolled_application_decision();
 REVOKE ALL ON FUNCTION public.release_approved_loan(text,uuid,date,text,numeric,text) FROM PUBLIC,anon,service_role;
 GRANT EXECUTE ON FUNCTION public.release_approved_loan(text,uuid,date,text,numeric,text) TO authenticated;`);
const uuid=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=uuid(1),other=uuid(2),member=uuid(3);
await db.query("INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,'staff@synthetic.invalid','{\"role\":\"super_admin\"}'),($2,'member@synthetic.invalid','{\"role\":\"member\"}')",[actor,other]);
await db.query('INSERT INTO members VALUES($1,$2)',[member,other]);
async function loan(n,{final='approve',status='approved'}={}){
 const id=uuid(n);await db.query("INSERT INTO loan_applications(id,application_id,member_id,status,amount,date_submitted,date_approved) VALUES($1,$2,$3,$4,50000,'2026-01-01','2026-01-02')",[id,'APP-'+n,member,status]);
 await db.query('INSERT INTO application_verifications VALUES($1)',[id]);
 if(final)await db.query('INSERT INTO application_final_decisions VALUES($1,$2)',[id,final]);
}
async function release(n,{request=uuid(n+1000),reference='DV-'+n,amount=50000,date='2026-01-03',who=actor,notes='Voucher checked'}={}){
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);await db.exec('SET ROLE authenticated');
 try{return (await db.query('SELECT release_approved_loan($1,$2,$3::date,$4,$5::numeric,$6) AS result',['APP-'+n,request,date,reference,amount,notes])).rows[0].result;}
 finally{await db.exec('RESET ROLE');}
}
try{
 await loan(10);const saved=await release(10);assert.equal(saved.status,'released');assert.equal(saved.processing_fee_amount_at_release,500);assert.equal(saved.service_fee_amount_at_release,250);assert.equal(saved.net_proceeds,49250);assert.equal(saved.interest_rate_at_release,2);
 assert.deepEqual(await release(10),saved);assert.equal((await db.query('SELECT count(*)::integer AS count FROM admin_activity_logs')).rows[0].count,1);
 await assert.rejects(release(10,{notes:'Changed retry'}),/different release details/);
 await assert.rejects(release(10,{request:uuid(9000)}),/Only approved loans/);
 for(const [n,options,overrides,pattern] of [
  [20,{final:null},{},/authorized committee/],
  [21,{final:'reject'},{},/authorized committee/],
  [22,{}, {who:other},/Super Admin access/],
  [23,{}, {amount:1},/amount changed/],
  [24,{}, {date:'2026-01-01'},/earlier than approval/],
  [25,{}, {date:'2099-01-01'},/future/],
  [26,{}, {reference:'DV-10'},/unique constraint/],
  [27,{status:'pending'},{},/Only approved loans/],
 ]){
  await loan(n,options);await assert.rejects(release(n,overrides),pattern);
  assert.equal((await db.query('SELECT date_released FROM loan_applications WHERE application_id=$1',['APP-'+n])).rows[0].date_released,null);
 }
 assert.equal((await db.query('SELECT count(*)::integer AS count FROM admin_activity_logs')).rows[0].count,1);
 // Failure to save the activity log must roll back the status and fee snapshots.
 await loan(30);await db.exec("ALTER TABLE admin_activity_logs ADD CONSTRAINT reject_synthetic_audit CHECK(target_id <> 'APP-30')");
 await assert.rejects(release(30),/reject_synthetic_audit/);
 const unchanged=(await db.query("SELECT status,date_released,interest_rate_at_release FROM loan_applications WHERE application_id='APP-30'")).rows[0];
 assert.deepEqual(unchanged,{status:'approved',date_released:null,interest_rate_at_release:null});
 console.log('Passed: atomic release, authenticated caller, final decision guard, policy snapshots, idempotent retries, duplicate protection, invalid inputs and full rollback on audit failure. No hosted records changed.');
}finally{await db.close();}
