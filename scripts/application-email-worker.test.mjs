import test from 'node:test';
import assert from 'node:assert/strict';
import {renderApplicationEmail,runEmailBatch} from './application-email-worker.mjs';
const application={application_id:'APP-TEST',member_name:'<Synthetic Member>',loan_type:'Regular Loan',status:'returned'};
const job={id:'notice-1',lease_id:'lease-1',recipient_email:'member@example.invalid',subject:'Application returned for correction',message:'Please replace your ID. Reason: unreadable <image>.',created_at:'2026-11-13T02:00:00Z',application_snapshot:application};
const env={COOP_EMAIL_PROVIDER:'resend',RESEND_API_KEY:'synthetic-key',COOP_EMAIL_FROM:'CSUCC ERMPC <sender@example.invalid>',COOP_MEMBER_APP_URL:'https://member.example.invalid/'};
test('email rendering escapes submitted text, identifies the application and supplies an exact details link',()=>{
 const email=renderApplicationEmail(job,application,env.COOP_MEMBER_APP_URL);
 assert.match(email.subject,/CSUCC ERMPC.*APP-TEST/);assert.match(email.text,/application=APP-TEST/);assert.match(email.html,/&lt;Synthetic Member&gt;/);assert.ok(!email.html.includes('<image>'));assert.match(email.text,/What you need to do/);assert.match(email.text,/November 13, 2026/);
 assert.throws(()=>renderApplicationEmail(job,application,'javascript:alert(1)'),/HTTPS/);
});
test('missing delivery configuration does not claim a job or contact a provider',async()=>{
 let calls=0;await assert.rejects(runEmailBatch({client:{rpc:async()=>calls++},env:{},send:true,transport:async()=>calls++}),/not configured/);assert.equal(calls,0);
});
test('a successful decision does not imply email success; retries keep the original provider payload and key',async()=>{
 const calls=[],bodies=[],saved=[];let frozen;
 const client={rpc:async(name,args)=>{calls.push(name);if(name==='portal_claim_email_jobs')return {data:[job]};if(name==='portal_prepare_email_payload'){frozen??=args.p_payload;return {data:frozen};}if(name==='portal_finish_email_job'){saved.push(args);return {data:true};}throw new Error(name);}};
 const transport=async(url,init)=>{bodies.push({key:init.headers['Idempotency-Key'],body:init.body});return {ok:true,status:200,json:async()=>({id:'provider-test'})};};
 const first=await runEmailBatch({client,env,send:true,transport});assert.equal(first.sent,1);assert.equal(saved[0].p_success,true);
 await runEmailBatch({client,env:{...env,COOP_EMAIL_FROM:'Changed <changed@example.invalid>'},send:true,transport});assert.deepEqual(bodies[0],bodies[1]);assert.equal(calls.filter(name=>name==='portal_prepare_email_payload').length,2);
});
test('a provider rejection records a delivery failure without repeating a loan action',async()=>{
 const operations=[];let outcome;
 const client={rpc:async(name,args)=>{operations.push(name);if(name==='portal_claim_email_jobs')return {data:[job]};if(name==='portal_prepare_email_payload')return {data:args.p_payload};outcome=args;return {data:true};}};
 const result=await runEmailBatch({client,env,send:true,transport:async()=>({ok:false,status:503,json:async()=>({})})});assert.equal(result.failed,1);assert.equal(outcome.p_success,false);assert.deepEqual(operations,['portal_claim_email_jobs','portal_prepare_email_payload','portal_finish_email_job']);
});
