// Read-only shape check. No member identities, tokens, URLs or document contents are printed.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
const require=createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(),false,{info:()=>{},error:()=>{}});
function load(path,imports={}){const exports={};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',code)(name=>{if(!(name in imports))throw new Error('Unexpected import '+name);return imports[name];},exports);return exports;}
const model=load('src/lib/documentWorkspace.ts',{'./membership':load('src/lib/membership.ts')});
const {loadDocumentWorkspace}=load('src/lib/documentWorkspaceData.ts',{'./documentWorkspace':model});
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
// Permissions are covered by the authenticated staging tests; this verifies server-side data mapping only.
const data=await loadDocumentWorkspace(service,{rpc:async()=>({data:{version:1,canReview:true},error:null})});
if(data.warnings.length)throw new Error(data.warnings.join(' '));
console.log(JSON.stringify({applications:data.applications.length,files:data.applications.reduce((count,app)=>count+app.documents.length,0),legacyStaffFiles:data.shared.filter(item=>item.source==='legacy').length,warnings:data.warnings.length}));
