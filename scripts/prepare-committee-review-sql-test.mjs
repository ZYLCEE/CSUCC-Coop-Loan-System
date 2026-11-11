import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
const read=path=>readFileSync(path,"utf8"),migration=path=>read(path).replace(/^BEGIN;\s*$/m,"").replace(/^COMMIT;\s*$/m,"");
mkdirSync("docs/committee-review",{recursive:true});
const sources=["supabase/tests/document-workspace-bootstrap.sql","supabase/tests/application-verification-bootstrap.sql",
 "supabase/migrations/20261110_document_workspace.sql","supabase/migrations/20261110_application_verification.sql",
 "supabase/migrations/20261110_committee_access.sql","supabase/migrations/20261111_committee_review.sql"];
writeFileSync("docs/committee-review/staging-rollback-test.sql","BEGIN;\n"+sources.map(path=>path.includes("/migrations/")?migration(path):read(path)).join("\n")+"\n"+
 "ALTER TABLE public.loan_applications ADD COLUMN date_approved date,ADD COLUMN co_maker_member_id uuid REFERENCES public.members(id);\n"+read("supabase/tests/committee-review-cases.sql")+"\nROLLBACK;\n");
console.log("Prepared synthetic Phase 3 staging tests; all changes end in ROLLBACK.");
