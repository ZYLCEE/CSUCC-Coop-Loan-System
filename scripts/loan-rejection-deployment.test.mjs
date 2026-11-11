import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const staged=readFileSync('node_modules/.cache/coop-rejection-deploy/supabase/edge-functions/secure-admin-action/index.ts','utf8').replaceAll('\r\n','\n');
const hosted=readFileSync('docs/loan-rejection-deploy/deployed-source/supabase/edge-functions/secure-admin-action/index.ts.txt','utf8').replaceAll('\r\n','\n');
function declaration(source,name){const ast=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true);return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);}
test('deployment preserves actual hosted account behavior and shared security helper functions',()=>{
 for(const name of ['executeAccountAction','canonicalJson','sha256','hmacSha256','containsSensitiveField','validateActionSecret'])assert.equal(declaration(staged,name),declaration(hosted,name));
});
test('deployment preserves actual hosted review/approval rules and authentication guard',()=>{
 const segment=s=>s.slice(s.indexOf('  if (action === "review-loan")'),s.indexOf('  } else if (action === "reject-loan")'));
 assert.equal(segment(staged),segment(hosted));
 const auth=s=>s.slice(s.indexOf('  const bearer ='),s.indexOf('  let body: JsonObject;'));
 assert.equal(auth(staged),auth(hosted));
});
test('canonical wrapper and JWT configuration are used; existing reviewed release service remains intact',()=>{
 assert.equal(readFileSync('node_modules/.cache/coop-rejection-deploy/supabase/functions/secure-admin-action/index.ts','utf8'),readFileSync('../coop_backend/supabase/functions/secure-admin-action/index.ts','utf8'));
 assert.match(readFileSync('node_modules/.cache/coop-rejection-deploy/supabase/config.toml','utf8'),/verify_jwt = true/);
 assert.match(readFileSync('src/lib/loanRelease.ts','utf8'),/\.rpc\('release_approved_loan'/);
});
