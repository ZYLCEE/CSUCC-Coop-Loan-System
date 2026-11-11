-- Minimal prerequisites on an otherwise empty staging public schema. Always rolled back.
CREATE TABLE public.members(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),member_id varchar NOT NULL,first_name varchar NOT NULL,last_name varchar NOT NULL DEFAULT '',membership_type varchar,status varchar DEFAULT 'active',role varchar DEFAULT 'Member',must_change_password boolean NOT NULL DEFAULT false);
CREATE TABLE public.loan_applications(id uuid PRIMARY KEY,application_id varchar NOT NULL,member_id uuid REFERENCES public.members(id),member_name varchar,loan_type varchar,amount numeric,status varchar,date_submitted date);
CREATE TABLE public.loan_documents(id uuid PRIMARY KEY,loan_application_id uuid REFERENCES public.loan_applications(id),user_id uuid REFERENCES auth.users(id),kind text,storage_path text UNIQUE,original_name text,content_type text,size_bytes bigint,created_at timestamptz DEFAULT now());
CREATE TABLE public.admin_activity_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid REFERENCES auth.users(id),action_name text,target_id text,result text,details jsonb,created_at timestamptz DEFAULT now());
GRANT SELECT ON public.members,public.loan_applications,public.loan_documents TO authenticated;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_member ON public.members FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY own_document ON public.loan_documents FOR SELECT TO authenticated USING(user_id=auth.uid());
INSERT INTO storage.buckets(id,name,public) VALUES('loan-documents','loan-documents',false) ON CONFLICT DO NOTHING;
CREATE POLICY owner_file ON storage.objects FOR SELECT TO authenticated USING(bucket_id='loan-documents' AND (storage.foldername(name))[1]=auth.uid()::text);
