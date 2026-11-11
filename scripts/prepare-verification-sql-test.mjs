import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const sql=path=>readFileSync(path,'utf8');
const migration=path=>sql(path).replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
mkdirSync('docs/application-verification',{recursive:true});
writeFileSync('docs/application-verification/staging-rollback-test.sql','BEGIN;\n'+
 sql('supabase/tests/document-workspace-bootstrap.sql')+'\n'+
 sql('supabase/tests/application-verification-bootstrap.sql')+'\n'+
 migration('supabase/migrations/20261110_document_workspace.sql')+'\n'+
 migration('supabase/migrations/20261110_application_verification.sql')+'\n'+
 sql('supabase/tests/application-verification-cases.sql')+'\nROLLBACK;\n');
console.log('Prepared application verification test; staging schema and fixtures roll back.');
