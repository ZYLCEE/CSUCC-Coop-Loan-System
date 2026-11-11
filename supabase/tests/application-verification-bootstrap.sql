ALTER TABLE public.loan_applications ADD COLUMN purpose text,ADD COLUMN tenure_months integer,ADD COLUMN monthly_payment numeric;
CREATE TABLE public.loan_policy_settings(singleton boolean PRIMARY KEY DEFAULT true,collateral_required_above numeric NOT NULL,base_interest_rate numeric DEFAULT 2,updated_at timestamptz DEFAULT now(),updated_by uuid);
INSERT INTO public.loan_policy_settings(singleton,collateral_required_above) VALUES(true,50000);
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES auth.users(id),title varchar NOT NULL,message text NOT NULL,type varchar NOT NULL,read boolean DEFAULT false,created_at timestamptz DEFAULT now());
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.notifications TO authenticated;
CREATE POLICY read_own_notification ON public.notifications FOR SELECT TO authenticated USING(user_id=auth.uid());
