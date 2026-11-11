import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
const read=path=>readFileSync(path,"utf8").replaceAll("\r\n","\n");
const migration=["supabase/migrations/20261111_portal_activity_notifications.sql","supabase/migrations/20261111_portal_consent_notifications.sql","supabase/migrations/20261111_notification_read_permissions.sql"].map(path=>read(path).replace(/^BEGIN;\s*$/m,"").replace(/^COMMIT;\s*$/m,"")).join("\n");
const base=read("docs/committee-signatories/staging-rollback-test.sql");
const bootstrap="CREATE TABLE public.loan_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),loan_application_id uuid REFERENCES public.loan_applications(id),payment_amount numeric,receipt_number text,payment_status text,recorded_by uuid,reversed_by uuid);\nCREATE TABLE public.announcements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,status text);\nALTER TABLE public.notifications ADD COLUMN send_to text;\nGRANT UPDATE(read) ON public.notifications TO authenticated;\nCREATE POLICY update_own_notification ON public.notifications FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());\n";
if(!base.includes("-- All users, policies, notifications"))throw new Error("Missing fixture insertion point.");
const sql=base.replace("-- All users, policies, notifications",()=>bootstrap+migration+"\n-- All users, policies, notifications").replace("ROLLBACK;",()=>read("supabase/tests/portal-activity-cases.sql")+"\nROLLBACK;");
mkdirSync("docs/portal-activity",{recursive:true});writeFileSync("docs/portal-activity/staging-rollback-test.sql",sql);
console.log("Prepared account, loan, committee, document, payment and RLS tests with ROLLBACK.");
