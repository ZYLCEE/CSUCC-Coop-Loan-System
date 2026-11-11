import {readFileSync,writeFileSync} from 'node:fs';
const base=JSON.parse(readFileSync('docs/bod-account-creation/database-baseline.json','utf8'));
const names=['committee_reserve_invite','committee_finish_invite','committee_change_membership','committee_begin_link','committee_complete_setup','committee_membership_eligible','committee_accounts','portal_session_access','committee_assignment_eligible'];
const replacements={
 committee_reserve_invite:[[" IF p_payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD membership requires an approved policy enabling the BOD stage.'; END IF;\n",'']],
 committee_finish_invite:[[" IF r.payload->>'role'='bod_member' AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'BOD access is not enabled.'; END IF;\n",'']],
 committee_change_membership:[[" IF next_role='bod_member' AND next_active AND NOT public.committee_bod_enabled() THEN RAISE EXCEPTION 'An approved policy must enable BOD access first.'; END IF;\n",'']],
 committee_begin_link:[[" OR (m.role='bod_member' AND NOT public.committee_bod_enabled())",'']],
 committee_complete_setup:[["OR (m.role='bod_member' AND NOT public.committee_bod_enabled()) ",'']],
 committee_membership_eligible:[["(m.role='crecom_member' OR (m.committee_seat='chairperson' AND public.committee_bod_enabled()))","(m.role='crecom_member' OR (m.role='bod_member' AND m.committee_seat='chairperson'))"]],
 committee_accounts:[[" WHEN m.role='bod_member' AND NOT public.committee_bod_enabled() THEN 'policy_disabled'",'']],
 portal_session_access:[
  [" WHEN portal_role_value='bod_member' AND NOT public.committee_bod_enabled() THEN 'BOD access is not enabled by an approved workflow policy.'",''],
  ["'allowed',eligible,'role',portal_role_value,","'allowed',eligible,'role',portal_role_value,'reviewEnabled',portal_role_value<>'bod_member' OR public.committee_bod_enabled(),"]
 ],
 // Portal admission is independent of policy activation; packet access is not.
 committee_assignment_eligible:[["AND public.committee_membership_eligible(m.id)","AND public.committee_membership_eligible(m.id)\n AND (m.role<>'bod_member' OR public.committee_bod_enabled())"]]
};
const definitions=names.map(name=>{
 let sql=base.find(r=>r.name===name).definition.replaceAll('\r\n','\n');
 for(const [before,after] of replacements[name]){
  if(sql.split(before).length!==2)throw Error('Unexpected current definition: '+name);
  sql=sql.replace(before,after);
 }
 return sql.trimEnd()+';';
});
const migration=`-- BOD account provisioning and personal setup do not require loan policy activation.\n-- Review availability, routing and packet access retain the BOD policy gate.\nBEGIN;\n${definitions.join('\n\n')}\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n`;
writeFileSync('supabase/migrations/20261112001000_bod_account_provisioning.sql',migration);
console.log('Prepared '+names.length+' scoped function updates; loan policy and decision procedures unchanged.');
