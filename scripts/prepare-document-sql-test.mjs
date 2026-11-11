import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261110_document_workspace.sql','utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
mkdirSync('docs/document-workspace',{recursive:true});
writeFileSync('docs/document-workspace/staging-rollback-test.sql','BEGIN;\n'+readFileSync('supabase/tests/document-workspace-bootstrap.sql','utf8')+'\n'+migration+'\n'+readFileSync('supabase/tests/document-workspace-cases.sql','utf8')+'\nROLLBACK;\n');
console.log('Prepared isolated staging test; all schema and fixture changes roll back.');
