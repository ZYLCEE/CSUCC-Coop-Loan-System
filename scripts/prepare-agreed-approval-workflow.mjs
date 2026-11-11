import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=path=>readFileSync(path,'utf8').replaceAll('\r\n','\n');
const verification=read('supabase/migrations/20261110_application_verification.sql');
const review=read('supabase/migrations/20261111_committee_review.sql');
const positions=read('supabase/migrations/20261111_committee_signatories.sql');
function definition(source,name){
 const start=source.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.'+name+'\\(','i'));
 if(start<0)throw Error('Missing function '+name);
 const end=source.indexOf('\n$$;',start);if(end<0)throw Error('Missing end '+name);
 return source.slice(start,end+4).replace(/^CREATE FUNCTION/i,'CREATE OR REPLACE FUNCTION');
}
function change(value,from,to){if(!value.includes(from))throw Error('Missing replacement '+from);return value.replace(from,to);}
const chunks=[read('supabase/tests/agreed-approval-foundation.sql')];
const releaseSource=read('supabase/migrations/20261108180000_counter_payment_interest.sql');
const releaseStart=releaseSource.indexOf('create or replace function public.release_approved_loan(');
let release=releaseSource.slice(releaseStart,releaseSource.indexOf('\nend $$;',releaseStart)+8);
release=change(release,`if not exists(select 1 from auth.users where id=auth.uid()
    and raw_app_meta_data->>'role'='super_admin'
    and coalesce(raw_app_meta_data->>'account_status','active')='active'
    and (banned_until is null or banned_until < now()))
    then raise exception 'Super Admin access required.' using errcode='42501'; end if;`,`if not public.document_staff_access('loans.release') then raise exception 'Loan release permission is required.' using errcode='42501'; end if;`);
chunks.push(release);
let mutation=definition(verification,'mutate_application_verification');
mutation=change(mutation,"IF w.application_id IS NULL THEN RAISE EXCEPTION 'Start verification before saving this action.'; END IF;",`IF w.application_id IS NULL THEN
      IF p_action<>'return' THEN RAISE EXCEPTION 'Start the requirements check before saving this action.'; END IF;
      INSERT INTO public.application_verifications(application_id,updated_by,policy_id) VALUES(a.id,actor,chosen_policy);
    END IF;`);
mutation=change(mutation,"UPDATE public.application_verifications SET stage='returned_for_requirements',revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;",`UPDATE public.application_review_cycles SET status='superseded',closed_at=clock_timestamp() WHERE application_id=a.id AND status<>'superseded';
      UPDATE public.review_assignments ra SET state='cancelled',revision=ra.revision+1 WHERE ra.review_cycle_id IN (SELECT id FROM public.application_review_cycles WHERE application_id=a.id) AND ra.state IN ('assigned','awaiting_clarification','recused');
      UPDATE public.application_verifications SET stage='returned_for_requirements',checks='{"identity":false,"eligibility":false,"terms":false}',verified_state_hash=null,verified_snapshot=null,verified_by=null,verified_at=null,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE application_id=a.id;
      UPDATE public.loan_applications SET status='returned' WHERE id=a.id;`);
mutation=change(mutation,"'Application requires correction'","'Loan application returned'");
mutation=change(mutation,"details:=jsonb_build_object('category',p_payload->>'category'",`INSERT INTO public.application_email_outbox(application_id,member_auth_id,recipient_email,subject,message,request_id,notification_id)
        SELECT a.id,recipient,u.email,'Loan application returned — '||a.application_id,a.application_id||': '||btrim(p_payload->>'reason'),p_request_id,notification FROM auth.users u WHERE u.id=recipient;
      details:=jsonb_build_object('category',p_payload->>'category'`);
chunks.push(mutation);
let replacement=definition(read('supabase/migrations/20261110_document_workspace.sql'),'submit_document_replacement');
replacement=change(replacement,"app_status NOT IN ('pending','under review')","app_status NOT IN ('pending','under review','returned')");
replacement=replacement.replace('Pending or Under Review','Pending or Returned');chunks.push(replacement);
let corrections=definition(verification,'member_application_corrections');
corrections=change(corrections,"'applicationId',a.application_id,'stage',v.stage,","'applicationId',a.application_id,'stage',v.stage,'purpose',a.purpose,'missingKinds',(SELECT coalesce(jsonb_agg(k),'[]') FROM jsonb_array_elements_text(public.private_application_verification_state(a.id)->'requiredKinds') k WHERE NOT EXISTS(SELECT 1 FROM public.loan_documents d WHERE d.loan_application_id=a.id AND d.kind=k)),");chunks.push(corrections);
let application=definition(review,'get_application_verification');
application=change(application,"'loanStatus',a.status,","'loanStatus',a.status,'loanSummary',jsonb_build_object('amount',a.amount,'months',a.tenure_months,'monthlyPayment',a.monthly_payment,'purpose',a.purpose),'returnEmailStatus',(SELECT o.status FROM public.application_email_outbox o WHERE o.application_id=a.id ORDER BY o.created_at DESC LIMIT 1),");chunks.push(application);

let stage=definition(review,'committee_application_stage');
stage=change(stage,"IF c.status='open' THEN", "IF c.outcome='reject' THEN RETURN 'review_attention'; END IF;\n IF c.status='open' THEN");chunks.push(stage);
let mutateReview=definition(positions,'committee_mutate_review');
mutateReview=change(mutateReview,"IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' THEN RAISE EXCEPTION 'Super Admin final authority is required.' USING ERRCODE='42501'; END IF;","IF NOT public.document_staff_access('applications.finalize') THEN RAISE EXCEPTION 'Final decision permission is required.' USING ERRCODE='42501'; END IF;");
mutateReview=change(mutateReview,"parent.id IS NULL OR NOT public.committee_packet_is_current(parent.id)","parent.id IS NULL OR parent.outcome IS DISTINCT FROM 'approve' OR NOT public.committee_signatories_complete(parent.id) OR NOT public.committee_packet_is_current(parent.id)");
mutateReview=change(mutateReview,"PERFORM public.committee_record_final(a.id,p_payload->>'decision','super_admin',reason);","PERFORM public.committee_record_final(a.id,p_payload->>'decision',CASE WHEN rules.final_mode='authorized_admin' THEN 'authorized_admin' ELSE 'super_admin' END,reason);");
// Finalization does not run the forwarding branch that initializes rules.
mutateReview=change(mutateReview,"ELSIF p_action='finalize' THEN\n  PERFORM", "ELSIF p_action='finalize' THEN\n  SELECT * INTO STRICT rules FROM public.committee_policy_rules WHERE policy_id=w.policy_id;\n  PERFORM");
mutateReview=change(mutateReview,"IF responded=c.reviewer_target THEN", "IF responded=c.reviewer_target OR EXISTS(SELECT 1 FROM public.individual_review_decisions d JOIN public.review_assignments x ON x.id=d.assignment_id WHERE x.review_cycle_id=c.id AND d.decision='reject') THEN");
mutateReview=change(mutateReview,"outcome_value:=CASE WHEN approvals>=c.required_approvals THEN 'approve' ELSE 'reject' END;", "outcome_value:=CASE WHEN responded=c.reviewer_target AND approvals>=c.required_approvals THEN 'approve' ELSE 'reject' END;");
mutateReview=change(mutateReview,"UPDATE public.application_verifications SET revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE application_id=a.id;",`IF p_action='approve' AND c.stage='CRECOM' AND outcome_value='approve' THEN PERFORM public.committee_route_bod(c.id); END IF;
 UPDATE public.application_verifications SET revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() WHERE application_id=a.id;`);
chunks.push(mutateReview);
let final=definition(positions,'committee_record_final');
final=change(final,"IF NOT public.document_staff_access() OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin' OR p_mode<>'super_admin' THEN RAISE EXCEPTION 'Super Admin final authority is required.' USING ERRCODE='42501'; END IF;",`IF NOT public.document_staff_access('applications.finalize') OR (r.final_mode='super_admin' AND (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())<>'super_admin') THEN RAISE EXCEPTION 'Your account is not authorized to record this final decision.' USING ERRCODE='42501'; END IF;`);chunks.push(final);
let activation=definition(positions,'committee_activate_policy');
activation=change(activation,"p_rules->>'finalMode' IS DISTINCT FROM 'super_admin'", "coalesce(p_rules->>'finalMode','') NOT IN ('super_admin','authorized_admin')");chunks.push(activation);
let state=definition(positions,'committee_review_state');
state=change(state,"'canFinalize',public.document_staff_access() AND (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())='super_admin'\n   AND stage_value='ready_for_final' AND public.committee_rules_json(w.policy_id)->>'finalMode'='super_admin'",`'canFinalize',public.document_staff_access('applications.finalize') AND stage_value='ready_for_final'
   AND (public.committee_rules_json(w.policy_id)->>'finalMode'='authorized_admin' OR (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid())='super_admin')`);chunks.push(state);
for(const name of ['committee_membership_eligible','committee_accounts','committee_reserve_invite','committee_finish_invite','committee_change_membership']){
 let value=definition(positions,name);
 if(name==='committee_membership_eligible')value=change(value,"AND (m.role='crecom_member' OR (m.committee_seat='chairperson' AND public.committee_bod_enabled()))", "AND (m.role='crecom_member' OR m.committee_seat='chairperson')");
 // Account setup is independent of loan policy activation. Assignment checks still require the policy.
 value=value.replace(/ IF (?:p_payload|r.payload)->>'role'='bod_member' AND NOT public\.committee_bod_enabled\(\) THEN RAISE EXCEPTION '[^']*'; END IF;\n/g,'');
 value=value.replace(/WHEN m\.role='bod_member' AND NOT public\.committee_bod_enabled\(\) THEN 'policy_disabled'\s*/g,'');
 value=value.replace("existing.invited_at IS NULL OR (", "(coalesce(r.payload->>'provisioningMode','invite')<>'password' AND existing.invited_at IS NULL) OR (");
 value=value.replace("OR u.invited_at IS NULL OR", "OR (coalesce(r.payload->>'provisioningMode','invite')<>'password' AND u.invited_at IS NULL) OR");
 value=value.replace(" IF next_role='bod_member' AND next_active AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'An approved policy must enable BOD access first.'; END IF;",'');
 if(name==='committee_change_membership')value=value.replace(' UPDATE public.staff_memberships SET role=next_role',` IF p_action='edit' AND p_payload ? 'name' THEN
  IF length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Enter a valid reviewer name.'; END IF;
  UPDATE auth.users SET raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('full_name',btrim(p_payload->>'name')) WHERE id=u.id;
 END IF;
 UPDATE public.staff_memberships SET role=next_role`);
 if(name==='committee_accounts')value=value.replace("'requestId',r.id,", "'requestId',r.id,'creationMode',coalesce(r.payload->>'provisioningMode','invite'),");
 chunks.push(value);
}
chunks.push(read('supabase/tests/agreed-approval-procedures.sql'));
chunks.push(`REVOKE ALL ON FUNCTION public.mutate_application_verification(text,text,integer,text,jsonb,uuid),public.application_workflow_action(uuid,jsonb),public.committee_route_bod(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.application_workflow_action(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.release_approved_loan(text,uuid,date,text,numeric,text),public.loan_release_action(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loan_release_action(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.resubmit_returned_loan(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resubmit_returned_loan(text,uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.submit_missing_application_document(text,text,text,text,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_missing_application_document(text,text,text,text,text,bigint) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;`);
mkdirSync('docs/approval-workflow',{recursive:true});
writeFileSync('supabase/migrations/20261111140000_agreed_approval_workflow.sql',chunks.join('\n\n')+'\n');
console.log('Prepared Pending/Returned and four-reviewer workflow migration. No accounts or approvals are seeded.');
