import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=path=>readFileSync(path,'utf8'),migration=path=>read(path).replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
mkdirSync('docs/committee-access',{recursive:true});
writeFileSync('docs/committee-access/staging-rollback-test.sql','BEGIN;\n'+read('supabase/tests/document-workspace-bootstrap.sql')+'\n'+read('supabase/tests/application-verification-bootstrap.sql')+'\n'+
 migration('supabase/migrations/20261110_document_workspace.sql')+'\n'+migration('supabase/migrations/20261110_application_verification.sql')+'\n'+migration('supabase/migrations/20261110_committee_access.sql')+'\n'+read('supabase/tests/committee-access-server-fixture.sql')+'\n'+read('supabase/tests/committee-access-cases.sql').replaceAll(/public[.](committee_(?:reserve_invite|finish_invite|change_membership|begin_link|finish_link))\(/g,'pg_temp.$1(')+'\nROLLBACK;\n');
console.log('Prepared isolated committee access tests. All schema and fixture changes roll back.');
