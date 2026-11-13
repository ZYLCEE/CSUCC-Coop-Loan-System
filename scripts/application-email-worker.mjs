// Optional delivery adapter. No messages are sent unless --send is explicit.
// Provider API: https://resend.com/docs/api-reference/emails/send-email
// Retry keys: https://resend.com/docs/dashboard/emails/idempotency-keys
import {createClient} from '@supabase/supabase-js';
import {pathToFileURL} from 'node:url';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderApplicationEmail(job,application,memberAppUrl){
 const base=new URL(memberAppUrl);
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('Configure an HTTPS member application URL.');
 const link=new URL(base);link.searchParams.set('application',application.application_id);
 const subject=`CSUCC ERMPC | ${job.subject} | ${application.application_id}`;
 const updated=new Intl.DateTimeFormat('en-PH',{dateStyle:'long',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(job.created_at));
 const action=/replacement|correction|returned/i.test(job.subject)?'Open the app to review the required changes and update your application.':'No action is required at this time. Open the app for the current details and any available next steps.';
 const stageTitle=job.subject.toLowerCase();
 const milestone=stageTitle==='requirements verified'?'CRECOM Review':stageTitle==='crecom review complete'?'Awaiting BOD Review':stageTitle==='bod review complete'?'Awaiting Final Decision':stageTitle.includes('crecom review')?'CRECOM Review':stageTitle.includes('bod review')?'BOD Review':null;
 const status=milestone??{pending:'Awaiting review','under review':'Application review',returned:'Returned for correction',approved:'Approved — Awaiting Release',rejected:'Rejected',released:'Released',overdue:'Repayment',completed:'Completed'}[application.status]??application.status;
 const fields=[['Application Number',application.application_id],['Loan Type',application.loan_type],['Current Stage',status],['Updated',updated]];
 const text=`Hello ${application.member_name||'Member'},\n\n${job.message}\n\n${fields.map(([label,value])=>`${label}: ${value}`).join('\n')}\n\nWhat you need to do:\n${action}\n\nView Details: ${link.href}\n\nCSUCC ERMPC\nThis is an automated application update.`;
 const html=`<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172c24"><h1 style="font-size:22px;color:#145b3c">${escape(job.subject)}</h1><p>Hello ${escape(application.member_name||'Member')},</p><p style="white-space:pre-wrap">${escape(job.message)}</p><dl>${fields.map(([label,value])=>`<dt style="font-weight:bold;margin-top:12px">${escape(label)}</dt><dd style="margin-left:0">${escape(value)}</dd>`).join('')}</dl><h2 style="font-size:16px">What you need to do</h2><p>${escape(action)}</p><p><a style="display:inline-block;padding:12px 20px;background:#145b3c;color:white;border-radius:6px" href="${escape(link.href)}">View Details</a></p><p>CSUCC ERMPC</p><p style="font-size:12px;color:#66736d">This is an automated application update.</p></main>`;
 return {subject,text,html};
}

export async function runEmailBatch({client,env=process.env,send=false,transport=fetch}){
 if(!send){const result=await client.from('application_email_outbox').select('id',{count:'exact',head:true}).in('status',['queued','failed','sending']);if(result.error)throw new Error('Email queue status is unavailable.');return {dryRun:true,pending:result.count};}
 if(env.COOP_EMAIL_PROVIDER!=='resend'||!env.RESEND_API_KEY||!env.COOP_EMAIL_FROM||!env.COOP_MEMBER_APP_URL)throw new Error('Email delivery is not configured. No jobs were claimed.');
 const configuredUrl=new URL(env.COOP_MEMBER_APP_URL);if(configuredUrl.protocol!=='https:')throw new Error('Configure an HTTPS member application URL before delivery.');
 const claimed=await client.rpc('portal_claim_email_jobs',{p_limit:20});if(claimed.error)throw new Error('Email jobs could not be claimed.');
 let sent=0,failed=0;
 for(const job of claimed.data??[]){
  let providerId=null,failure=null;
  try{
   if(!job.application_snapshot)throw new Error('The email context snapshot is unavailable.');
   const body=renderApplicationEmail(job,job.application_snapshot,env.COOP_MEMBER_APP_URL);
   const prepared=await client.rpc('portal_prepare_email_payload',{p_id:job.id,p_lease:job.lease_id,p_payload:{from:env.COOP_EMAIL_FROM,to:[job.recipient_email],...body}});
   if(prepared.error||!prepared.data)throw new Error('Email payload could not be preserved for safe retries.');
   const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`application-notice/${job.id}`},body:JSON.stringify(prepared.data),signal:AbortSignal.timeout(20000)});
   const accepted=await response.json();if(!response.ok||typeof accepted.id!=='string')throw new Error(`Email provider did not confirm acceptance (HTTP ${response.status}).`);providerId=accepted.id;
  }catch(error){failure=error instanceof Error?error.message:'Email delivery failed.';}
  const finished=await client.rpc('portal_finish_email_job',{p_id:job.id,p_lease:job.lease_id,p_success:!!providerId,p_provider_id:providerId,p_error:failure});
  if(finished.error||finished.data!==true)throw new Error('Email outcome could not be recorded. The existing lease must be reconciled before retrying.');
  if(providerId)sent++;else failed++;
 }
 return {dryRun:false,sent,failed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Configure the server-only Supabase environment before inspecting the queue.');
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  console.log(JSON.stringify(await runEmailBatch({client,send:process.argv.includes('--send')})));
 }catch(error){console.error(error instanceof Error?error.message:'Email worker failed.');process.exitCode=1;}
}
