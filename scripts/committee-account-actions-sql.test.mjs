// Local PostgreSQL (WASM), with isolated Auth/provider fixtures; never connects to Supabase.
import {PGlite} from "../node_modules/.committee-sql-qa/node_modules/@electric-sql/pglite/dist/index.js";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import assert from "node:assert/strict";
const read=path=>readFileSync(path,"utf8"),db=new PGlite();
const extract=(file,name)=>{const source=read(file),start=source.indexOf("CREATE OR REPLACE FUNCTION public."+name+"(");assert.ok(start>=0,name);const tail=source.slice(start),delimiter=tail.match(/AS (\$[\w]*\$)/)[1],end=tail.indexOf(delimiter+";",tail.indexOf(delimiter)+delimiter.length);return tail.slice(0,end+delimiter.length+1);};
await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb DEFAULT '{}',raw_user_meta_data jsonb DEFAULT '{}',last_sign_in_at timestamptz,deleted_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE public.members(id uuid PRIMARY KEY,user_id uuid);
 CREATE TABLE public.staff_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid REFERENCES auth.users(id),role text,committee_seat text,member_number smallint,active boolean,revision integer DEFAULT 1,starts_at timestamptz,ends_at timestamptz,title text DEFAULT '',setup_completed_at timestamptz,invitation_request_id uuid,last_invite_at timestamptz);
 CREATE TABLE public.committee_account_requests(id uuid PRIMARY KEY,kind text,actor_id uuid,email text,payload jsonb,request_hash text,state text,auth_user_id uuid,membership_id uuid,result jsonb,created_at timestamptz DEFAULT now(),error text);
 CREATE TABLE public.admin_activity_logs(actor_id uuid,action_name text,target_id text,result text,details jsonb);
 CREATE TABLE public.application_review_cycles(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.review_assignments(id uuid PRIMARY KEY,membership_id uuid REFERENCES public.staff_memberships(id),reviewer_auth_id uuid REFERENCES auth.users(id),review_cycle_id uuid,state text);
 CREATE TABLE public.individual_review_decisions(id uuid PRIMARY KEY,assignment_id uuid REFERENCES public.review_assignments(id),reviewer_auth_id uuid REFERENCES auth.users(id),decision text,reviewer_name text);
 CREATE FUNCTION public.document_staff_access(privilege text DEFAULT '') RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND coalesce(raw_app_meta_data->>'account_status','active')='active' AND (raw_app_meta_data->>'role'='super_admin' OR raw_app_meta_data->>'role'='admin' AND raw_app_meta_data->'admin_privileges' ? privilege))$$;
 CREATE FUNCTION public.committee_bod_enabled() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
`);
await db.exec(extract('supabase/migrations/20261112001000_bod_account_provisioning.sql','committee_change_membership'));
for(const fn of ['committee_accounts','committee_account_action'])await db.exec(extract('supabase/migrations/20261111223000_committee_account_creation.sql',fn));
await db.exec(read('supabase/migrations/20261112060000_committee_account_actions.sql'));
const uuid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=uuid(1),target=uuid(2),membership=uuid(3),ordinary=uuid(4),review=uuid(5),decision=uuid(6);
await db.query(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES($1,'admin@synthetic.invalid','{"role":"super_admin"}','{}'),($2,'bod@synthetic.invalid','{"role":"bod_member"}','{"full_name":"Synthetic BOD Chair"}'),($3,'other@synthetic.invalid','{"role":"admin"}','{}')`,[actor,target,ordinary]);
await db.query(`INSERT INTO public.staff_memberships(id,auth_user_id,role,committee_seat,active,starts_at,setup_completed_at) VALUES($1,$2,'bod_member','chairperson',true,now()-interval '1 day',now())`,[membership,target]);
await db.query(`INSERT INTO public.review_assignments(id,membership_id,reviewer_auth_id,state) VALUES($1,$2,$3,'decision_recorded')`,[review,membership,target]);
await db.query(`INSERT INTO public.individual_review_decisions VALUES($1,$2,$3,'approve','Synthetic BOD Chair')`,[decision,review,target]);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
const call=async(actor,operation,args)=>{const result=await db.query('SELECT public.committee_account_action($1,$2,$3) AS result',[actor,operation,JSON.stringify(args)]);return result.rows[0].result;};
const begin=(id,revision,operation='reset',fingerprint='a'.repeat(64))=>({p_id:membership,p_revision:revision,p_operation:operation,p_request_id:id,p_attempt_id:uuid(100),p_fingerprint:fingerprint,p_reason:'Forgotten temporary password'});
const finish=id=>({p_request_id:id,p_attempt_id:uuid(100)});
const logs=async()=>Number((await db.query('SELECT count(*) AS n FROM public.admin_activity_logs')).rows[0].n);
try{
 await assert.rejects(call(ordinary,'committee_begin_credential_action',begin(uuid(10),1)),/permission/);
 await db.query("INSERT INTO public.staff_memberships(id,auth_user_id,role,committee_seat,active,starts_at) VALUES($1,$2,'bod_member','chairperson',false,now())",[uuid(50),target]);
 await assert.rejects(call(actor,'committee_begin_credential_action',begin(uuid(10),1)),/multiple memberships/);
 await db.query('DELETE FROM public.staff_memberships WHERE id=$1',[uuid(50)]);
 const reserved=await call(actor,'committee_begin_credential_action',begin(uuid(10),1));assert.equal(reserved.role,'bod_member');
 let row=(await db.query('SELECT * FROM public.staff_memberships WHERE id=$1',[membership])).rows[0];assert.equal(row.active,false);assert.equal(row.setup_completed_at,null);assert.equal(row.account_action_id,uuid(10));
 assert.equal(await logs(),0);
 await assert.rejects(call(actor,'committee_begin_credential_action',begin(uuid(10),1)),/already being processed/);
 await assert.rejects(call(actor,'committee_finish_credential_action',finish(uuid(10))),/password update could not be confirmed/);
 await assert.rejects(db.query("UPDATE public.staff_memberships SET active=true WHERE id=$1",[membership]),/credential action is pending/);
 // Simulate only the Auth provider's receipt, never a real password change.
 await db.query("UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object('committee_credential_action_id',$1::text) WHERE id=$2",[uuid(10),target]);
 assert.equal((await call(actor,'committee_finish_credential_action',finish(uuid(10)))).success,true);
 row=(await db.query('SELECT * FROM public.staff_memberships WHERE id=$1',[membership])).rows[0];assert.equal(row.active,true);assert.equal(row.setup_completed_at,null);assert.equal(row.account_action_id,null);assert.equal(row.revision,3);assert.equal(await logs(),1);
 assert.equal((await call(actor,'committee_begin_credential_action',begin(uuid(10),1))).complete,true);assert.equal(await logs(),1);
 await assert.rejects(call(actor,'committee_begin_credential_action',begin(uuid(10),1,'reset','b'.repeat(64))),/already used/);
 await assert.rejects(call(actor,'committee_begin_credential_action',begin(uuid(11),1)),/changed/);
 // Failed attempts remain safely suspended and can be replaced with a fresh request.
 await call(actor,'committee_begin_credential_action',begin(uuid(11),3));await call(actor,'committee_fail_credential_action',finish(uuid(11)));
 assert.equal(await logs(),1);
 await call(actor,'committee_begin_credential_action',begin(uuid(12),4));
 await assert.rejects(call(actor,'committee_finish_credential_action',finish(uuid(11))),/changed/);
 await db.query("UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object('committee_credential_action_id',$1::text) WHERE id=$2",[uuid(12),target]);await call(actor,'committee_finish_credential_action',finish(uuid(12)));
 const edit={p_id:membership,p_revision:6,p_action:'edit',p_request_id:uuid(13),p_payload:{name:'Updated BOD Chair',role:'bod_member',committeeSeat:'chairperson',committeeMemberNumber:null,startsAt:'2026-01-01',endsAt:null,title:'Director',reason:'Name corrected'}};
 await call(actor,'committee_change_membership',edit);assert.equal((await db.query('SELECT raw_user_meta_data FROM auth.users WHERE id=$1',[target])).rows[0].raw_user_meta_data.full_name,'Updated BOD Chair');
 await call(actor,'committee_change_membership',{p_id:membership,p_revision:7,p_action:'deactivate',p_request_id:uuid(14),p_payload:{reason:'Term paused'}});
 let accounts=(await db.query('SELECT public.committee_accounts() AS data')).rows[0].data;assert.equal(accounts.accountActionsVersion,1);assert.equal(accounts.accounts[0].status,'blocked');
 await call(actor,'committee_change_membership',{p_id:membership,p_revision:8,p_action:'reactivate',p_request_id:uuid(15),p_payload:{reason:'Term resumed'}});
 await call(actor,'committee_begin_credential_action',begin(uuid(16),9,'delete'));
 await assert.rejects(call(actor,'committee_finish_credential_action',finish(uuid(16))),/deletion could not be confirmed/);
 await db.query("UPDATE auth.users SET deleted_at=now(),raw_app_meta_data='{}',raw_user_meta_data='{}',email=null WHERE id=$1",[target]);
 const recovery=(await db.query('SELECT public.committee_accounts() AS data')).rows[0].data.accounts[0];assert.equal(recovery.name,'Updated BOD Chair');assert.equal(recovery.email,'bod@synthetic.invalid');assert.equal(recovery.status,'recovery_pending');
 await call(actor,'committee_fail_credential_action',finish(uuid(16)));
 // Closing a failed deletion modal does not strand the account: a fresh Delete can finish.
 const retry=await call(actor,'committee_begin_credential_action',begin(uuid(17),10,'delete'));assert.equal(retry.authDeleted,true);
 await call(actor,'committee_finish_credential_action',finish(uuid(17)));
 accounts=(await db.query('SELECT public.committee_accounts() AS data')).rows[0].data;assert.equal(accounts.accounts.length,0);
 assert.equal((await db.query('SELECT reviewer_name FROM public.individual_review_decisions WHERE id=$1',[decision])).rows[0].reviewer_name,'Synthetic BOD Chair');
 assert.equal((await db.query('SELECT count(*) AS n FROM public.review_assignments')).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*) AS n FROM public.admin_activity_logs WHERE action_name='committee-account-delete'")).rows[0].n,1);
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.committee_begin_credential_action(uuid,integer,text,uuid,uuid,text,text)','EXECUTE') AS allowed")).rows[0].allowed,false);
 // An assigned Admin may manage committee credentials, while revoked permissions fail closed.
 await db.query("UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{\"admin_privileges\":[\"committee.accounts.manage\"]}'::jsonb WHERE id=$1",[ordinary]);
 await db.query("INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES($1,'crecom@synthetic.invalid','{\"role\":\"crecom_member\"}','{\"full_name\":\"Synthetic Member Two\"}')",[uuid(51)]);
 await db.query("INSERT INTO public.staff_memberships(id,auth_user_id,role,committee_seat,member_number,active,starts_at) VALUES($1,$2,'crecom_member','member',2,true,now())",[uuid(52),uuid(51)]);
 const adminRequest={...begin(uuid(53),1),p_id:uuid(52)};
 await call(ordinary,'committee_begin_credential_action',adminRequest);
 await db.query("UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object('committee_credential_action_id',$1::text) WHERE id=$2",[uuid(53),uuid(51)]);
 await db.query("UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data-'admin_privileges' WHERE id=$1",[ordinary]);
 await assert.rejects(call(ordinary,'committee_finish_credential_action',finish(uuid(53))),/permission/);
 assert.equal((await db.query('SELECT active FROM public.staff_memberships WHERE id=$1',[uuid(52)])).rows[0].active,false);
 console.log('PASS: local PostgreSQL migration, privilege gates, safe reset suspension, provider receipts, lease/duplicate/stale guards, failure recovery, name editing, block/unblock, deleted-account filtering and retained decisions.');
 mkdirSync('docs/committee-account-actions',{recursive:true});writeFileSync('docs/committee-account-actions/sql-tests.txt','PASS: migration and PostgreSQL behavior verified locally with synthetic Auth fixtures. No remote schema or account changed.\n');
}finally{await db.close();}
