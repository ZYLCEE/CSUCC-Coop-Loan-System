import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const cli='C:/Users/zylcee/AppData/Local/npm-cache/_npx/b96a6bd565c470ce/node_modules/@supabase/cli-windows-x64/bin/supabase.exe';
const sql="SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'committee_%' OR p.proname IN ('handle_new_user','portal_record_activity','portal_session_access')) ORDER BY p.proname;";
const result=spawnSync(cli,['db','query','--remote','--read-only',sql,'--output','json'],{encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr);
const data=JSON.parse(result.stdout);mkdirSync('docs/committee-creation',{recursive:true});
writeFileSync('docs/committee-creation/database-baseline.json',JSON.stringify(data.rows,null,2));
console.log('Saved '+data.rows.length+' function definitions for a scoped migration.');
