import {readFileSync,writeFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261112001000_bod_account_provisioning.sql','utf8').replace(/COMMIT;\s*$/,'');
const cases=readFileSync('supabase/tests/bod-account-provisioning-cases.sql','utf8');
writeFileSync('docs/bod-account-creation/rollback-validation.sql',migration+'\n'+cases+'\nROLLBACK;\n');
