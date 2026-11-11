import {readFileSync,writeFileSync} from "node:fs";
const access=readFileSync("supabase/migrations/20261110_committee_access.sql","utf8").replaceAll("\r\n","\n");
const review=readFileSync("supabase/migrations/20261111_committee_review.sql","utf8").replaceAll("\r\n","\n");
const chunks=[];
function definition(source,name){
 const start=source.search(new RegExp("CREATE (?:OR REPLACE )?FUNCTION public\\."+name+"\\("));
 if(start<0)throw new Error("Missing "+name);
 const end=source.indexOf("\n$$;",start);
 if(end<0)throw new Error("Missing end "+name);
 return source.slice(start,end+4).replace(/^CREATE FUNCTION/,"CREATE OR REPLACE FUNCTION");
}
function edit(source,name,replacements){
 let value=definition(source,name);
 for(const [from,to]of replacements){
  if(!value.includes(from))throw new Error("Missing replacement in "+name+": "+from);
  value=value.replace(from,to);
 }
 chunks.push(value);
}
edit(access,"committee_membership_eligible",[["AND (m.role='crecom_member' OR public.committee_bod_enabled())","AND (m.role='crecom_member' OR (m.committee_seat='chairperson' AND public.committee_bod_enabled()))"]]);
edit(access,"portal_session_access",[["'membershipId',m.id,'name'","'membershipId',m.id,'committeeSeat',m.committee_seat,'name'"]]);
edit(access,"committee_assignment_eligible",[["AND m.role=CASE","AND a.signatory_role=CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='member' THEN 'crecom_member' END\n AND m.role=CASE"]]);
edit(access,"committee_accounts",[["'email',u.email,'role',m.role,'title'","'email',u.email,'role',m.role,'committeeSeat',m.committee_seat,'title'"],["'role',r.payload->>'role','title'","'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat','title'"]]);
edit(access,"committee_account_assignments",[["'stage',c.stage,'cycle'","'stage',c.stage,'signatoryRole',a.signatory_role,'cycle'"],["(NOT m.active OR","(a.signatory_role IS DISTINCT FROM CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' THEN 'crecom_member' END OR NOT m.active OR"]]);
const seatValidation="\n IF coalesce(p_payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (p_payload->>'role'='bod_member' AND p_payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'Choose a CRECOM member, CRECOM chairperson or BOD chairperson position.'; END IF;";
edit(access,"committee_reserve_invite",[[" IF p_payload->>'role'='bod_member'",seatValidation+"\n IF p_payload->>'role'='bod_member'"],["'email',invite_email));","'email',invite_email,'committeeSeat',p_payload->>'committeeSeat'));"]]);
edit(access,"committee_finish_invite",[[" INSERT INTO public.staff_memberships("," IF coalesce(r.payload->>'committeeSeat','') NOT IN ('member','chairperson') OR (r.payload->>'role'='bod_member' AND r.payload->>'committeeSeat'<>'chairperson') THEN RAISE EXCEPTION 'The invitation needs a valid committee position.'; END IF;\n INSERT INTO public.staff_memberships("],["assigned_by,title,invitation_request_id","assigned_by,title,committee_seat,invitation_request_id"],["coalesce(r.payload->>'title',''),r.id","coalesce(r.payload->>'title',''),r.payload->>'committeeSeat',r.id"],["'role',r.payload->>'role'));","'role',r.payload->>'role','committeeSeat',r.payload->>'committeeSeat'));"]]);
edit(access,"committee_change_membership",[["next_role text; starts","next_role text; next_seat text; starts"],["next_role:=m.role;starts","next_role:=m.role;next_seat:=m.committee_seat;starts"],["  next_role:=p_payload->>'role';starts","  next_seat:=p_payload->>'committeeSeat';"+seatValidation+"\n  next_role:=p_payload->>'role';starts"],["SET role=next_role,starts_at","SET role=next_role,committee_seat=next_seat,starts_at"],["'newRole',next_role,'active'","'newRole',next_role,'oldSeat',m.committee_seat,'newSeat',next_seat,'active'"]]);
edit(review,"committee_reviewer_available",[["AND (m.role='crecom_member' OR public.committee_bod_enabled())","AND (m.role='crecom_member' OR (m.committee_seat='chairperson' AND public.committee_bod_enabled()))"]]);
edit(review,"committee_activate_policy",[[" IF p.config->>'bodMode'<>'none' AND", " IF p.config->>'bodMode' IS DISTINCT FROM 'required' OR bn IS DISTINCT FROM 1 OR ba IS DISTINCT FROM 1 OR p_rules->>'signatoryLayout' IS DISTINCT FROM 'manual_form_v1' OR p_rules->>'bodAuthority' IS DISTINCT FROM 'recommendation' THEN RAISE EXCEPTION 'Every loan requires two CRECOM members, one CRECOM chairperson and one BOD chairperson before Super Admin final decision.'; END IF;\n IF p.config->>'bodMode'<>'none' AND"]]);
edit(review,"committee_mutate_review",[
 ["  FOR candidate IN SELECT", "  PERFORM m.id FROM public.staff_memberships m WHERE m.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) ORDER BY m.id FOR SHARE;\n  FOR candidate IN SELECT"],
 ["  SELECT id INTO existing_cycle", "  IF p.config->>'bodMode' IS DISTINCT FROM 'required' OR rules.crecom_approvals<>3 OR rules.bod_reviewers IS DISTINCT FROM 1 OR rules.bod_approvals IS DISTINCT FROM 1 OR rules.signatory_layout<>'manual_form_v1' THEN RAISE EXCEPTION 'Activate the confirmed four-position workflow before forwarding.'; END IF;\n  SELECT id INTO existing_cycle"],
 ["  FOR candidate IN SELECT", "  IF stage_name='CRECOM' AND ((SELECT count(*) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='member')<>2 OR (SELECT count(*) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='chairperson')<>1) THEN RAISE EXCEPTION 'Select exactly two CRECOM members and one CRECOM chairperson.'; END IF;\n  FOR candidate IN SELECT"],
 ["membership_id,due_at) VALUES(c.id,membership.auth_user_id,membership.id,(p_payload", "membership_id,signatory_role,due_at) VALUES(c.id,membership.auth_user_id,membership.id,CASE WHEN stage_name='BOD' THEN 'bod_chairperson' WHEN membership.committee_seat='chairperson' THEN 'crecom_chairperson' ELSE 'crecom_member' END,(p_payload"],
 ["confirmation_text,confirmation_method)","confirmation_text,confirmation_method,signatory_role)"],
 ["format('I record %s for %s, packet version %s.',p_action,a.application_id,c.packet_version),'account_password');", "format('I record %s as %s for %s, packet version %s.',p_action,replace(assignment.signatory_role,'_',' '),a.application_id,c.packet_version),'account_password',assignment.signatory_role);"],
 ["   UPDATE public.review_assignments SET state='reassigned'", "   IF assignment.signatory_role IS DISTINCT FROM (SELECT CASE WHEN m.role='bod_member' AND m.committee_seat='chairperson' THEN 'bod_chairperson' WHEN m.role='crecom_member' AND m.committee_seat='chairperson' THEN 'crecom_chairperson' WHEN m.role='crecom_member' THEN 'crecom_member' END FROM public.staff_memberships m WHERE m.id=candidate) THEN RAISE EXCEPTION 'The replacement must hold the same committee position as the original assignment.'; END IF;\n   UPDATE public.review_assignments SET state='reassigned'"],
 ["   candidate:=(p_payload->>'membershipId')::uuid;", "   candidate:=(p_payload->>'membershipId')::uuid;\n   PERFORM m.id FROM public.staff_memberships m WHERE m.id=candidate FOR SHARE;"],
 ["  IF p_action IN ('approve','reject','clarify','recuse') AND NOT", "  PERFORM m.id FROM public.staff_memberships m WHERE m.id=assignment.membership_id FOR SHARE;\n  IF p_action IN ('approve','reject','clarify','recuse') AND NOT"],
 ["membership_id,due_at) VALUES(c.id,membership.auth_user_id,membership.id,assignment.due_at)", "membership_id,signatory_role,due_at) VALUES(c.id,membership.auth_user_id,membership.id,assignment.signatory_role,assignment.due_at)"]
]);
edit(review,"committee_record_final",[[" recommendation:=c.outcome", " IF NOT c.bod_required OR p.config->>'bodMode' IS DISTINCT FROM 'required' OR r.signatory_layout<>'manual_form_v1' OR NOT public.committee_signatories_complete(c.id) THEN RAISE EXCEPTION 'Complete the required two CRECOM member and one CRECOM chairperson confirmations first.'; END IF;\n recommendation:=c.outcome"],["IF b.id IS NULL OR b.outcome IS NULL", "IF b.id IS NULL OR NOT public.committee_signatories_complete(b.id) OR b.outcome IS NULL"]]);
edit(review,"committee_rules_json",[["'crecomApprovals',crecom_approvals", "'signatoryLayout',signatory_layout,'crecomApprovals',crecom_approvals"]]);
edit(review,"committee_review_state",[["'name',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email),\n   'state'", "'name',coalesce(d.reviewer_name,nullif(u.raw_user_meta_data->>'full_name',''),u.email),'signatoryRole',x.signatory_role,'confirmationReference',d.id,'confirmationText',d.confirmation_text,'confirmationMethod',d.confirmation_method,\n   'state'"],["'role',m.role,'title',m.title", "'role',m.role,'committeeSeat',m.committee_seat,'title',m.title"]]);
edit(review,"committee_review_packet",[["'method',confirmation_method)", "'method',confirmation_method,'signatoryRole',signatory_role)"]]);
edit(review,"committee_workspace",[["'stage',c.stage,'cycle'", "'stage',c.stage,'signatoryRole',a.signatory_role,'cycle'"],["'decision',d.decision,'reason'", "'decision',d.decision,'signatoryRole',d.signatory_role,'reason'"]]);
const prefix=readFileSync("supabase/tests/committee-signatories-foundation.sql","utf8");
writeFileSync("supabase/migrations/20261111_committee_signatories.sql",prefix+"\n"+chunks.join("\n\n")+"\nCOMMIT;\n");
console.log("Prepared exact four-position committee migration; existing function privileges are preserved.");
