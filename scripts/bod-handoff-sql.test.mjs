// Isolated PostgreSQL runtime. No network, real accounts, votes or loan changes.
import {PGlite} from "../node_modules/.committee-sql-qa/node_modules/@electric-sql/pglite/dist/index.js";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const db=new PGlite(),read=path=>readFileSync(path,"utf8");
const extract=(file,name)=>{const source=read(file),match=source.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public[.]'+name+'\\('));assert.ok(match,name);const tail=source.slice(match.index),delimiter=tail.match(/AS (\$\w*\$)/)[1],end=tail.indexOf(delimiter+';',tail.indexOf(delimiter)+delimiter.length);return tail.slice(0,end+delimiter.length+1);};
await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb DEFAULT '{}',raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz DEFAULT now(),banned_until timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE public.members(id uuid PRIMARY KEY,user_id uuid);
 CREATE TABLE public.loan_applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id text UNIQUE,member_id uuid,co_maker_member_id uuid,status text DEFAULT 'pending');
 CREATE TABLE public.staff_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid,role text,committee_seat text,member_number smallint,active boolean DEFAULT true,starts_at timestamptz DEFAULT now()-interval '1 day',ends_at timestamptz,setup_completed_at timestamptz DEFAULT now());
 CREATE TABLE public.approval_workflow_policies(id uuid PRIMARY KEY,status text,config jsonb);
 CREATE TABLE public.committee_policy_rules(policy_id uuid PRIMARY KEY,crecom_approvals integer,bod_reviewers integer,bod_approvals integer,signatory_layout text);
 CREATE TABLE public.application_review_cycles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid,cycle_no integer,stage text,status text DEFAULT 'open',outcome text,packet_version integer,packet_snapshot jsonb,policy_id uuid,created_by uuid,required_approvals integer,reviewer_target integer,bod_required boolean,routing_reason text,created_at timestamptz DEFAULT now(),current boolean DEFAULT true,UNIQUE(application_id,cycle_no,stage));
 CREATE TABLE public.review_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_cycle_id uuid,reviewer_auth_id uuid,membership_id uuid,signatory_role text,member_number smallint,state text DEFAULT 'assigned',assigned_at timestamptz DEFAULT now());
 CREATE TABLE public.individual_review_decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid UNIQUE,reviewer_auth_id uuid,signatory_role text,member_number smallint,decision text,packet_version integer,reviewer_name text,created_at timestamptz DEFAULT now());
 CREATE TABLE public.application_verifications(application_id uuid PRIMARY KEY,revision integer DEFAULT 1,updated_by uuid,updated_at timestamptz);
 CREATE TABLE public.application_final_decisions(application_id uuid PRIMARY KEY,decision text);
 CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,message text,type text,read boolean);
 CREATE TABLE public.committee_notification_links(notification_id uuid,assignment_id uuid);
 CREATE TABLE public.committee_review_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid UNIQUE,request_hash text,application_id uuid,cycle_id uuid,actor_id uuid,actor_name text,action text,reason text,result jsonb);
 CREATE TABLE public.admin_activity_logs(actor_id uuid,action_name text,target_id text,result text,details jsonb);
 CREATE FUNCTION public.committee_bod_enabled() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION public.committee_packet_is_current(p_cycle uuid) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT current FROM public.application_review_cycles WHERE id=p_cycle),false)$$;
 CREATE FUNCTION public.committee_workspace() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('assignments',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'stage',c.stage)),'[]')) FROM public.review_assignments x JOIN public.application_review_cycles c ON c.id=x.review_cycle_id WHERE x.reviewer_auth_id=auth.uid()$$;
 CREATE FUNCTION public.committee_review_packet(p_assignment_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE output jsonb;BEGIN SELECT jsonb_build_object('assignment',jsonb_build_object('id',x.id,'stage',c.stage),'canRespond',true) INTO output FROM public.review_assignments x JOIN public.application_review_cycles c ON c.id=x.review_cycle_id WHERE x.id=p_assignment_id AND x.reviewer_auth_id=auth.uid();IF output IS NULL THEN RAISE insufficient_privilege;END IF;RETURN output;END;$$;
 CREATE FUNCTION public.committee_review_state(p_application_id text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('applicationId',p_application_id)$$;
 CREATE FUNCTION public.committee_activate_policy(uuid,jsonb,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
`);
for(const fn of ['committee_signatories_complete','committee_reviewer_available'])await db.exec(extract('supabase/migrations/20261111_committee_signatories.sql',fn));
await db.exec(extract('supabase/migrations/20261111_committee_review.sql','committee_application_stage'));
// The existing mutation is exercised elsewhere; this fixture models the saved
// own decision and panel-completion transaction before the new automatic handoff.
await db.exec(`CREATE FUNCTION public.committee_mutate_review(p_application_id text,p_action text,p_revision integer,p_state_hash text,p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE x public.review_assignments%ROWTYPE;c public.application_review_cycles%ROWTYPE;BEGIN
 IF p_action IN ('approve','reject') THEN
 SELECT * INTO STRICT x FROM public.review_assignments WHERE id=(p_payload->>'assignmentId')::uuid AND reviewer_auth_id=auth.uid();
 SELECT * INTO STRICT c FROM public.application_review_cycles WHERE id=x.review_cycle_id;
 IF x.state<>'decision_recorded' THEN
 INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,signatory_role,member_number,decision,packet_version,reviewer_name) VALUES(x.id,x.reviewer_auth_id,x.signatory_role,x.member_number,p_action,c.packet_version,'Saved Reviewer');
 UPDATE public.review_assignments SET state='decision_recorded' WHERE id=x.id;
 IF (SELECT count(*) FROM public.review_assignments WHERE review_cycle_id=c.id AND state='decision_recorded')=c.reviewer_target THEN UPDATE public.application_review_cycles SET status='completed',outcome=CASE WHEN EXISTS(SELECT 1 FROM public.review_assignments a JOIN public.individual_review_decisions d ON d.assignment_id=a.id WHERE a.review_cycle_id=c.id AND d.decision='reject') THEN 'reject' ELSE 'approve' END WHERE id=c.id;END IF;
 END IF;
 END IF;RETURN jsonb_build_object('success',true);END;$$;`);
const uuid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,policy=uuid(1),staff=uuid(2),borrower=uuid(3),member=uuid(4),bod=uuid(5),bodSeat=uuid(6);
await db.query(`INSERT INTO public.approval_workflow_policies VALUES($1,'approved','{"bodMode":"required"}');`,[policy]);
await db.query(`INSERT INTO public.committee_policy_rules VALUES($1,3,1,1,'manual_form_v1')`,[policy]);
for(const [id,role] of [[staff,'super_admin'],[borrower,'member'],[bod,'bod_member'],[uuid(11),'crecom_member'],[uuid(12),'crecom_member'],[uuid(13),'crecom_member']])await db.query(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('role',$3::text),jsonb_build_object('full_name',$2::text))`,[id,id+'@synthetic.invalid',role]);
await db.query('INSERT INTO public.members VALUES($1,$2)',[member,borrower]);
await db.query("INSERT INTO public.staff_memberships(id,auth_user_id,role,committee_seat) VALUES($1,$2,'bod_member','chairperson')",[bodSeat,bod]);
async function application(n,approvals=3){
 const app=uuid(n),cycle=uuid(n+1),assignments=[uuid(n+2),uuid(n+3),uuid(n+4)];
 await db.query('INSERT INTO public.loan_applications(id,application_id,member_id) VALUES($1,$2,$3)',[app,'APP-'+n,member]);
 await db.query('INSERT INTO public.application_verifications(application_id) VALUES($1)',[app]);
 await db.query(`INSERT INTO public.application_review_cycles(id,application_id,cycle_no,stage,status,outcome,packet_version,packet_snapshot,policy_id,created_by,required_approvals,reviewer_target,bod_required) VALUES($1,$2,1,'CRECOM',$3,$4,4,'{"summary":{"amount":50000,"tenureMonths":12,"monthlyPayment":4500,"purpose":"Saved loan purpose"},"documents":[{"documentId":"pinned-version"}]}',$5,$6,3,3,true)`,[cycle,app,approvals===3?'completed':'open',approvals===3?'approve':null,policy,staff]);
 for(let i=0;i<3;i++){
  const role=i===2?'crecom_chairperson':'crecom_member',number=i===2?null:i+1;
  await db.query('INSERT INTO public.review_assignments(id,review_cycle_id,reviewer_auth_id,signatory_role,member_number,state) VALUES($1,$2,$3,$4,$5,$6)',[assignments[i],cycle,uuid(11+i),role,number,i<approvals?'decision_recorded':'assigned']);
  if(i<approvals)await db.query("INSERT INTO public.individual_review_decisions(assignment_id,reviewer_auth_id,signatory_role,member_number,decision,packet_version,reviewer_name) VALUES($1,$2,$3,$4,'approve',4,$5)",[assignments[i],uuid(11+i),role,number,'Reviewer '+(i+1)]);
 }return {app,cycle,assignments};
}
const waiting=await application(100,2),legacy=await application(200,3);
await db.exec(read('supabase/migrations/20261112070000_bod_review_handoff.sql'));
const route=async app=>(await db.query('SELECT public.committee_route_completed_crecom_to_bod($1) AS result',[app])).rows[0].result;
const vote=async(actor,app,assignment)=>(await db.query("SELECT public.committee_review_action($1,'approve',$2) AS result",[actor,JSON.stringify({applicationId:app,revision:1,stateHash:'a'.repeat(64),payload:{assignmentId:assignment,confirmed:true},requestId:crypto.randomUUID()})])).rows[0].result;
try{
 assert.equal((await route(waiting.app)).status,'not_ready');
 assert.equal((await db.query("SELECT count(*) AS n FROM public.application_review_cycles WHERE application_id=$1 AND stage='BOD'",[waiting.app])).rows[0].n,0);
 assert.equal((await route(legacy.app)).status,'assigned');
 await assert.rejects(db.query("SELECT public.committee_review_action($1,'forward_bod',$2)",[staff,JSON.stringify({applicationId:'APP-100',payload:{reviewers:[bodSeat]}})]),/All three/);
 const result=await vote(uuid(13),'APP-100',waiting.assignments[2]);assert.equal(result.stage,'bod_review');assert.equal(result.bodRouting.status,'assigned');
 const savedBod=(await db.query("SELECT * FROM public.application_review_cycles WHERE application_id=$1 AND stage='BOD'",[waiting.app])).rows[0];
 assert.equal(savedBod.packet_version,4);assert.equal(savedBod.packet_snapshot.documents[0].documentId,'pinned-version');
 const own=(await db.query('SELECT * FROM public.review_assignments WHERE review_cycle_id=$1',[savedBod.id])).rows[0];assert.equal(own.reviewer_auth_id,bod);assert.equal(own.signatory_role,'bod_chairperson');assert.equal(own.state,'assigned');
 assert.equal((await db.query('SELECT count(*) AS n FROM public.individual_review_decisions WHERE assignment_id=$1',[own.id])).rows[0].n,0);
 await route(waiting.app);await route(waiting.app);
 assert.equal((await db.query("SELECT count(*) AS n FROM public.application_review_cycles WHERE application_id=$1 AND stage='BOD'",[waiting.app])).rows[0].n,1);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[bod]);
 const workspace=(await db.query('SELECT public.committee_workspace() AS data')).rows[0].data;
 assert.equal(workspace.assignments.find(row=>row.id===own.id).crecomConfirmations.length,3);
 const packet=(await db.query('SELECT public.committee_review_packet($1) AS data',[own.id])).rows[0].data;assert.equal(packet.crecomConfirmations.length,3);assert.equal(packet.crecomConfirmations[0].committeeMemberNumber,1);assert.equal(packet.crecomConfirmations[1].committeeMemberNumber,2);assert.equal(packet.crecomConfirmations[2].signatoryRole,'crecom_chairperson');assert.equal(packet.canRespond,true);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[borrower]);await assert.rejects(db.query('SELECT public.committee_review_packet($1)',[own.id]),/insufficient_privilege/);
 const final=await vote(bod,'APP-100',own.id);assert.equal(final.stage,'ready_for_final');
 const summary=(await db.query("SELECT public.committee_review_state('APP-100') AS data")).rows[0].data;assert.equal(summary.applicationSummary.amount,50000);assert.equal(summary.applicationSummary.tenureMonths,12);
 assert.equal((await db.query('SELECT count(*) AS n FROM public.application_final_decisions')).rows[0].n,0);
 assert.equal((await db.query('SELECT status FROM public.loan_applications WHERE id=$1',[waiting.app])).rows[0].status,'pending');
 const missing=await application(300,3);await db.query('UPDATE public.staff_memberships SET active=false WHERE id=$1',[bodSeat]);assert.equal((await route(missing.app)).status,'needs_reviewer');await db.query('UPDATE public.staff_memberships SET active=true WHERE id=$1',[bodSeat]);
 await db.query("INSERT INTO public.staff_memberships(id,auth_user_id,role,committee_seat) VALUES($1,$2,'bod_member','chairperson')",[uuid(7),bod]);assert.equal((await route(missing.app)).status,'needs_selection');await db.query('DELETE FROM public.staff_memberships WHERE id=$1',[uuid(7)]);
 await db.query('UPDATE public.application_review_cycles SET current=false WHERE id=$1',[missing.cycle]);assert.equal((await route(missing.app)).status,'not_ready');await db.query('UPDATE public.application_review_cycles SET current=true WHERE id=$1',[missing.cycle]);
 await db.query("UPDATE public.individual_review_decisions SET decision='reject' WHERE assignment_id=$1",[missing.assignments[2]]);assert.equal((await route(missing.app)).status,'not_ready');
 const permissions=(await db.query("SELECT has_function_privilege('authenticated','public.committee_route_completed_crecom_to_bod(uuid)','EXECUTE') AS direct,has_function_privilege('authenticated','public.committee_review_action(uuid,text,jsonb)','EXECUTE') AS mutation")).rows[0];assert.equal(permissions.direct,false);assert.equal(permissions.mutation,false);
 console.log('PASS: local PostgreSQL handoff/backfill, 2/3 gate, automatic unique BOD assignment, unchanged snapshots, duplicate prevention, assigned-only CRECOM evidence, BOD approval to final summary, no automatic approval/release, stale/rejection/ineligible/multiple-chair gates.');
 mkdirSync('docs/bod-handoff',{recursive:true});writeFileSync('docs/bod-handoff/sql-tests.txt','PASS: local PostgreSQL tests completed using synthetic records. No remote migration, assignment, vote or loan change was made.\n');
}finally{await db.close();}
