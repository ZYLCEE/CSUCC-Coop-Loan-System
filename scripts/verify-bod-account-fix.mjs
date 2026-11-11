import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const cli='C:/Users/zylcee/AppData/Local/npm-cache/_npx/b96a6bd565c470ce/node_modules/@supabase/cli-windows-x64/bin/supabase.exe';
const query=sql=>{
 const result=spawnSync(cli,['db','query','--remote','--read-only',sql,'--output','json'],{encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr);
 return JSON.parse(result.stdout).rows;
};
const migration=readFileSync('supabase/migrations/20261112001000_bod_account_provisioning.sql','utf8').replaceAll('\r\n','\n');
const feedback=readFileSync('supabase/migrations/20261112010000_committee_creation_request_feedback.sql','utf8').replaceAll('\r\n','\n');
const names=[...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(m=>m[1]);
const rows=query(`SELECT p.proname name,pg_get_functiondef(p.oid) definition,has_function_privilege('authenticated',p.oid,'EXECUTE') browser_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${[...names,'committee_bod_enabled','committee_reviewer_available'].map(n=>`'${n}'`).join(',')});`);
for(const name of names){
 const row=rows.find(r=>r.name===name);assert.ok(row,name+' exists');
 assert.ok((name==='committee_reserve_invite'?feedback:migration).includes(row.definition.replaceAll('\r\n','\n').trimEnd()+';'),name+' matches deployed migration');
 if(['committee_reserve_invite','committee_finish_invite','committee_change_membership','committee_begin_link','committee_complete_setup'].includes(name))assert.equal(row.browser_execute,false,name+' remains service-only');
}
const baseline=JSON.parse(readFileSync('docs/bod-account-creation/database-baseline.json','utf8'));
for(const name of ['committee_bod_enabled','committee_reviewer_available'])assert.equal(rows.find(r=>r.name===name).definition,baseline.find(r=>r.name===name).definition,name+' unchanged');
const counts=query("SELECT (SELECT count(*) FROM auth.users WHERE email LIKE '%@bod-provision-fixture.invalid') AS synthetic_accounts,(SELECT count(*) FROM public.approval_workflow_policies WHERE name='Synthetic BOD fixture') AS synthetic_policies;")[0];
assert.equal(counts.synthetic_accounts,0);assert.equal(counts.synthetic_policies,0);
console.log('PASS: all nine live functions match; service-only mutations retained; BOD policy and reviewer gates unchanged; no synthetic accounts or policies left behind.');
