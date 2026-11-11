import{readFileSync,writeFileSync}from'node:fs';
const definitions=JSON.parse(readFileSync('docs/committee-creation/database-baseline.json','utf8'));
const get=name=>{const f=definitions.find(x=>x.name===name);if(!f)throw Error(name);return f.definition.replaceAll('\r\n','\n');};
const replace=(text,before,after)=>{if(!text.includes(before))throw Error('Missing SQL marker: '+before);return text.replace(before,after);};
const manager=text=>text.replace(/IF NOT public\.document_staff_access\(\) OR \(SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id=auth.uid\(\)\)<>'super_admin'\s+THEN/g,"IF NOT public.document_staff_access('committee.accounts.manage') THEN").replaceAll('Super Admin access is required.','Committee account management permission is required.');
let auth=get('handle_new_user');
auth=replace(auth,'BEGIN',`BEGIN
  -- A reviewer is not a borrower. Only a trusted role or a matching service-only
  -- invitation reservation may bypass the normal member-profile trigger.
  IF NEW.raw_app_meta_data->>'role' IN ('crecom_member','bod_member') OR EXISTS(
    SELECT 1 FROM public.committee_account_requests r WHERE r.kind='invite' AND r.state='pending'
    AND r.id::text=NEW.raw_user_meta_data->>'committee_invitation_request_id'
    AND lower(r.email)=lower(NEW.email) AND r.payload->>'role' IN ('crecom_member','bod_member')) THEN RETURN NEW;END IF;`);
let events=get('portal_record_activity');
events=replace(events,'BEGIN',`BEGIN
 IF TG_TABLE_NAME='members' AND TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.committee_profile_archive WHERE profile_id=OLD.id AND auth_user_id=OLD.user_id) THEN RETURN OLD;END IF;
 END IF;`);
let reserve=manager(get('committee_reserve_invite'));
reserve=replace(reserve,'existing.invited_at IS NULL',"(coalesce(r.payload->>'provisioningMode','invite')<>'password' AND existing.invited_at IS NULL)");
reserve=replace(reserve," start_date:=(p_payload->>'startsAt')::timestamptz;",` IF p_payload->>'role'='crecom_member' AND p_payload->>'committeeSeat'='member' AND coalesce(p_payload->>'committeeMemberNumber','') NOT IN ('1','2') THEN RAISE EXCEPTION 'Choose CRECOM Member 1 or CRECOM Member 2.';END IF;
 start_date:=(p_payload->>'startsAt')::timestamptz;`);
reserve=replace(reserve," IF FOUND THEN\n  IF r.kind<>'invite'",` IF FOUND THEN
  -- A failed legacy request may acquire its missing numbered position once.
  -- Every other detail, owner and the original request reference remain fixed.
  IF r.kind='invite' AND r.actor_id=auth.uid() AND r.state='failed' AND NOT (r.payload ? 'committeeMemberNumber') AND (r.payload-'committeeMemberNumber')=(p_payload-'committeeMemberNumber') THEN
   UPDATE public.committee_account_requests SET payload=p_payload,request_hash=fingerprint WHERE id=r.id RETURNING * INTO r;
  END IF;
  IF r.kind<>'invite'`);
reserve=replace(reserve," SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;",` SELECT * INTO existing FROM auth.users u WHERE lower(u.email)=invite_email;
 IF existing.id IS NOT NULL THEN PERFORM public.committee_archive_auto_profile(existing.id,r.id);END IF;`);
let finish=manager(get('committee_finish_invite'));
finish=replace(finish,'u.invited_at IS NULL',"(coalesce(r.payload->>'provisioningMode','invite')<>'password' AND u.invited_at IS NULL)");
finish=replace(finish," SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;",` SELECT * INTO STRICT u FROM auth.users WHERE id=p_user_id;
 PERFORM public.committee_archive_auto_profile(p_user_id,r.id);`);
finish=replace(finish,'title,committee_seat,invitation_request_id,last_invite_at)','title,committee_seat,member_number,invitation_request_id,last_invite_at)');
finish=replace(finish,"r.payload->>'committeeSeat',r.id,clock_timestamp())", "r.payload->>'committeeSeat',CASE WHEN r.payload->>'role'='crecom_member' AND r.payload->>'committeeSeat'='member' THEN (r.payload->>'committeeMemberNumber')::smallint END,r.id,clock_timestamp())");
let change=manager(get('committee_change_membership'));
change=replace(change,'next_active boolean;','next_active boolean;next_number smallint;');
change=replace(change," next_role:=m.role;next_seat:=m.committee_seat;"," next_number:=m.member_number;next_role:=m.role;next_seat:=m.committee_seat;");
change=replace(change,"  next_seat:=p_payload->>'committeeSeat';",`  next_seat:=p_payload->>'committeeSeat';
  next_number:=CASE WHEN p_payload->>'role'='crecom_member' AND next_seat='member' THEN (p_payload->>'committeeMemberNumber')::smallint END;
  IF p_payload->>'role'='crecom_member' AND next_seat='member' AND (next_number IS NULL OR next_number NOT IN (1,2)) THEN RAISE EXCEPTION 'Choose CRECOM Member 1 or CRECOM Member 2.';END IF;`);
change=replace(change,'SET role=next_role,committee_seat=next_seat,','SET role=next_role,committee_seat=next_seat,member_number=next_number,');
change=replace(change,"'oldSeat',m.committee_seat,'newSeat',next_seat,","'oldSeat',m.committee_seat,'newSeat',next_seat,'oldMemberNumber',m.member_number,'newMemberNumber',next_number,");
let dispatch=get('committee_account_action');
dispatch=replace(dispatch,"raw_app_meta_data->>'role'='super_admin'","raw_app_meta_data->>'role' IN ('super_admin','admin','coop_admin')");
dispatch=replace(dispatch," PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);",` PERFORM set_config('request.jwt.claim.sub',p_actor_id::text,true);
 IF NOT public.document_staff_access('committee.accounts.manage') THEN RAISE EXCEPTION 'Committee account management permission is required.' USING ERRCODE='42501';END IF;`);
let mutate=get('committee_mutate_review');
mutate=replace(mutate,"  FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers') LOOP",`  IF stage_name='CRECOM' AND (SELECT count(DISTINCT member_number) FROM public.staff_memberships WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers')) AND role='crecom_member' AND committee_seat='member' AND member_number IN (1,2))<>2 THEN RAISE EXCEPTION 'Select CRECOM Member 1, CRECOM Member 2 and the CRECOM Chairperson.';END IF;
  FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(p_payload->'reviewers') LOOP`);
mutate=replace(mutate,"   UPDATE public.review_assignments SET state='reassigned'",`   IF assignment.signatory_role='crecom_member' AND assignment.member_number IS NOT NULL AND assignment.member_number IS DISTINCT FROM (SELECT member_number FROM public.staff_memberships WHERE id=candidate) THEN RAISE EXCEPTION 'Choose a replacement with the same numbered CRECOM member position.';END IF;
   UPDATE public.review_assignments SET state='reassigned'`);
const selected=new Map([['handle_new_user',auth],['portal_record_activity',events],['committee_reserve_invite',reserve],['committee_finish_invite',finish],['committee_change_membership',change],['committee_account_action',dispatch],['committee_mutate_review',mutate]]);
for(const name of ['committee_accounts','committee_account_assignments','committee_request_failed','committee_begin_link','committee_finish_link'])selected.set(name,manager(get(name)));
selected.set('committee_accounts',replace(selected.get('committee_accounts'),"'requestId',r.id,","'requestId',r.id,'creationMode',coalesce(r.payload->>'provisioningMode','invite'),"));
for(const name of ['committee_review_state','committee_workspace','committee_review_packet','committee_case','portal_session_access','committee_assignment_eligible'])if(definitions.some(x=>x.name===name))selected.set(name,get(name));
for(const [name,source] of selected){
 let sql=source.replaceAll("'committeeSeat',m.committee_seat","'committeeSeat',m.committee_seat,'committeeMemberNumber',m.member_number")
  .replaceAll("'committeeSeat',r.payload->>'committeeSeat'","'committeeSeat',r.payload->>'committeeSeat','committeeMemberNumber',(r.payload->>'committeeMemberNumber')::smallint")
  .replace(/'signatoryRole',([a-z_]+)\.signatory_role/g,"'signatoryRole',$1.signatory_role,'committeeMemberNumber',$1.member_number")
  .replaceAll("'signatoryRole',signatory_role","'signatoryRole',signatory_role,'committeeMemberNumber',member_number");
 if(name==='committee_assignment_eligible')sql=replace(sql," AND m.role=CASE", " AND (a.member_number IS NULL OR a.member_number IS NOT DISTINCT FROM m.member_number)\n AND m.role=CASE");
 if(name==='committee_account_assignments')sql=replace(sql,"OR NOT m.active", "OR (a.member_number IS NOT NULL AND a.member_number IS DISTINCT FROM m.member_number) OR NOT m.active");
 selected.set(name,sql);
}
const migration=`-- Repair committee provisioning and preserve explicit numbered approval positions.
BEGIN;
ALTER TABLE public.staff_memberships ADD COLUMN member_number smallint;
ALTER TABLE public.staff_memberships ADD CONSTRAINT committee_numbered_position CHECK(member_number IS NULL OR (role='crecom_member' AND committee_seat='member' AND member_number IN (1,2)));
ALTER TABLE public.review_assignments ADD COLUMN member_number smallint CHECK(member_number IS NULL OR member_number IN (1,2));
ALTER TABLE public.individual_review_decisions ADD COLUMN member_number smallint CHECK(member_number IS NULL OR member_number IN (1,2));
CREATE TABLE public.committee_profile_archive(profile_id uuid PRIMARY KEY,auth_user_id uuid NOT NULL,request_id uuid NOT NULL,profile jsonb NOT NULL,archived_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.committee_profile_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.committee_profile_archive FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.committee_profile_archive TO service_role;
CREATE FUNCTION public.committee_archive_auto_profile(p_user uuid,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u auth.users%ROWTYPE;r public.committee_account_requests%ROWTYPE;m public.members%ROWTYPE;dependency record;linked boolean;column_name text;
BEGIN
 SELECT * INTO STRICT r FROM public.committee_account_requests WHERE id=p_request;
 SELECT * INTO STRICT u FROM auth.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO m FROM public.members WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF r.kind<>'invite' OR r.state='complete' OR lower(u.email)<>lower(r.email) OR lower(m.email) IS DISTINCT FROM lower(u.email)
  OR (u.raw_app_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text AND u.raw_user_meta_data->>'committee_invitation_request_id' IS DISTINCT FROM r.id::text)
  OR (u.raw_app_meta_data->>'role' IS NOT NULL AND u.raw_app_meta_data->>'role' IS DISTINCT FROM r.payload->>'role')
  OR abs(extract(epoch FROM m.created_at-u.created_at))>5 OR m.role IS NOT NULL OR m.membership_type IS NOT NULL
  OR nullif(m.phone,'') IS NOT NULL OR nullif(m.address,'') IS NOT NULL OR m.income IS NOT NULL OR nullif(m.department,'') IS NOT NULL OR m.created_by IS NOT NULL
  OR m.in_person_identity_verified OR m.must_change_password OR m.status<>'active' OR m.credit_score IS DISTINCT FROM 700
  OR m.first_name IS DISTINCT FROM coalesce(u.raw_user_meta_data->>'first_name',split_part(coalesce(u.email,'Member'),'@',1))
  OR m.last_name IS DISTINCT FROM coalesce(u.raw_user_meta_data->>'last_name','')
  OR EXISTS(SELECT 1 FROM public.staff_memberships WHERE auth_user_id=u.id) THEN RAISE EXCEPTION 'A genuine member or staff profile is linked to this email. Use a separate committee email or ask the system administrator to reconcile the account.';END IF;
 FOR dependency IN SELECT conrelid,conkey FROM pg_constraint WHERE contype='f' AND confrelid='public.members'::regclass LOOP
  IF cardinality(dependency.conkey)<>1 THEN RAISE EXCEPTION 'A linked profile requires manual reconciliation.';END IF;
  SELECT attname INTO column_name FROM pg_attribute WHERE attrelid=dependency.conrelid AND attnum=dependency.conkey[1];
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',dependency.conrelid::regclass,column_name) INTO linked USING m.id;
  IF linked THEN RAISE EXCEPTION 'This email has linked member records. No member data was changed. Use a separate committee email.';END IF;
 END LOOP;
 INSERT INTO public.committee_profile_archive(profile_id,auth_user_id,request_id,profile) VALUES(m.id,u.id,r.id,to_jsonb(m));
 DELETE FROM public.members WHERE id=m.id AND user_id=u.id;
END;
$$;
REVOKE ALL ON FUNCTION public.committee_archive_auto_profile(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.committee_snapshot_member_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='review_assignments' THEN SELECT member_number INTO NEW.member_number FROM public.staff_memberships WHERE id=NEW.membership_id;
 ELSE SELECT member_number INTO NEW.member_number FROM public.review_assignments WHERE id=NEW.assignment_id;END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.committee_snapshot_member_number() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snapshot_review_member_number BEFORE INSERT ON public.review_assignments FOR EACH ROW EXECUTE FUNCTION public.committee_snapshot_member_number();
CREATE TRIGGER snapshot_decision_member_number BEFORE INSERT ON public.individual_review_decisions FOR EACH ROW EXECUTE FUNCTION public.committee_snapshot_member_number();
${[...selected.values()].map(value=>value.trimEnd()+';').join('\n')}
NOTIFY pgrst,'reload schema';
COMMIT;
`;
writeFileSync('supabase/migrations/20261111223000_committee_account_creation.sql',migration);
console.log('Prepared scoped committee migration with '+selected.size+' updated functions.');
