-- CSUCC fictional demo data, January-October 2026.
-- Run the entire file in this project's Supabase SQL Editor.
-- Adds 60 profiles and 60 applications. Existing records are never updated.
-- Repeat runs skip this dataset's deterministic IDs.
-- Profiles intentionally have no Auth users: they cannot sign in and are not
-- counted by the dashboard's authenticated Active Members metric. The account
-- list may identify them as unlinked profiles. No passwords or permissions change.
-- No payment or notification rows are explicitly inserted. Existing database
-- triggers remain enabled and may process inserted application records.
-- Dates represent historical sample events, not actual lending activity.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('csucc-fictional-demo-2026-v1'));

-- Discover the database's own allowed labels instead of guessing loan names.
-- Validate every extracted candidate against the original CHECK expression.
create temporary table csucc_demo_loan_types (
  loan_type text primary key
) on commit drop;

do $$
declare
  type_check text;
  candidate text;
  is_allowed boolean;
begin
  select pg_get_expr(conbin, conrelid) into type_check
  from pg_constraint
  where conrelid = 'public.loan_applications'::regclass
    and conname = 'loan_applications_loan_type_check'
    and contype = 'c';

  if type_check is null then
    raise exception 'Cannot find the loan type CHECK constraint. Nothing has been committed.';
  end if;

  for candidate in
    select distinct replace(matches[1], chr(39) || chr(39), chr(39))
    from regexp_matches(type_check, $pattern$'((?:[^']|'')*)'$pattern$, 'g')
      as literals(matches)
  loop
    execute format(
      'select coalesce((%s), false) from (select $1::varchar as loan_type) as candidate',
      type_check
    ) into is_allowed using candidate;
    if is_allowed and length(trim(candidate)) > 0 then
      insert into csucc_demo_loan_types values (candidate) on conflict do nothing;
    end if;
  end loop;

  if not exists (select 1 from csucc_demo_loan_types) then
    raise exception 'Cannot resolve allowed loan types from CHECK: %. Nothing has been committed.', type_check;
  end if;
end $$;

create temporary table csucc_demo_2026 on commit drop as
with numbered as (
  select n,
         ((n - 1) / 6 + 1)::integer as month_number,
         ((n - 1) % 6 + 1)::integer as slot
  from generate_series(1, 60) as n
), dated as (
  select *, make_date(2026, month_number, 2 + (slot - 1) * 4) as submitted
  from numbered
), details as (
  select *,
    md5('csucc-fictional-demo-2026-v1/member/' || n)::uuid as member_uuid,
    md5('csucc-fictional-demo-2026-v1/application/' || n)::uuid as loan_uuid,
    'DEMO-2026-' || lpad(n::text, 4, '0') as member_code,
    'LA-DEMO-2026-' || lpad(n::text, 4, '0') as application_code,
    'Demo ' || (array['Ana','Miguel','Sofia','Daniel','Isabel','Gabriel'])
      [slot] as first_name,
    (array['Santos','Reyes','Cruz','Garcia','Flores','Ramos','Mendoza',
           'Torres','Rivera','Navarro'])[month_number] as last_name,
    case when slot = 6 then 'associate' else 'regular' end as membership_type,
    (array['Administration','Engineering','Education','Business',
           'Information Technology','Support Services'])[slot] as department,
    allowed.types[((n - 1) % cardinality(allowed.types)) + 1] as loan_type,
    case when slot = 6 then 5000::numeric
         else (10000 + ((n * 7) % 15) * 5000)::numeric
    end as principal,
    (30000 + (n % 9) * 5000)::numeric as income,
    (680 + (n * 11) % 140)::integer as credit_score,
    case when month_number <= 6
           then (array['completed','completed','completed','rejected',
                       'completed','completed'])[slot]
         when month_number <= 9
           then (array['released','overdue','approved','rejected',
                       'released','overdue'])[slot]
         else (array['pending','under review','approved','rejected',
                     'released','pending'])[slot]
    end as loan_status
  from dated
  cross join (
    select array_agg(loan_type order by loan_type) as types
    from csucc_demo_loan_types
  ) as allowed
)
select *,
       case when loan_status in ('approved','released','overdue','completed')
            then submitted + 2 end as approved,
       case when loan_status in ('released','overdue','completed')
            then submitted + 4 end as released,
       case when loan_status = 'completed'
            then (submitted + 4 + interval '3 months')::date end as completed,
       case when loan_status = 'completed' then 3 else 12 end as term_months
from details;

-- Abort the whole transaction if a marker collides with unrelated records.
do $$
begin
  if exists (
    select 1 from public.members m join csucc_demo_2026 d
      on m.id = d.member_uuid or m.member_id = d.member_code
    where m.id <> d.member_uuid or m.member_id <> d.member_code
       or m.first_name <> d.first_name or m.last_name <> d.last_name
       or m.user_id is not null
  ) or exists (
    select 1 from public.loan_applications l join csucc_demo_2026 d
      on l.id = d.loan_uuid or l.application_id = d.application_code
    where l.id <> d.loan_uuid or l.application_id <> d.application_code
       or l.member_id <> d.member_uuid
  ) then
    raise exception 'Demo IDs overlap other data. Nothing has been committed.';
  end if;
end $$;

insert into public.members (
  id, member_id, first_name, last_name, email, income, credit_score,
  date_joined, status, created_at, updated_at, membership_type, department,
  role, must_change_password, in_person_identity_verified
)
select member_uuid, member_code, first_name, last_name,
       'csucc.demo.' || lpad(n::text, 4, '0') || '@example.invalid',
       income, credit_score,
       make_date(2025, ((n - 1) % 6) + 1, 5), 'active',
       make_date(2025, ((n - 1) % 6) + 1, 5)::timestamp at time zone 'Asia/Manila',
       make_date(2025, ((n - 1) % 6) + 1, 5)::timestamp at time zone 'Asia/Manila',
       membership_type, department, 'member', false, false
from csucc_demo_2026 d
where not exists (select 1 from public.members m where m.id = d.member_uuid);

insert into public.loan_applications (
  id, application_id, member_id, member_name, loan_type, amount, purpose,
  status, income, credit_score, date_submitted, date_approved, date_released,
  date_completed, created_at, updated_at, tenure_months, monthly_payment
)
select loan_uuid, application_code, member_uuid, first_name || ' ' || last_name,
       loan_type, principal,
       'Fictional demonstration record: ' || loan_type || '. No actual funds involved.',
       loan_status, income, credit_score, submitted, approved, released, completed,
       (submitted + time '09:00') at time zone 'Asia/Manila',
       (coalesce(completed, released, approved, submitted) + time '15:00')
         at time zone 'Asia/Manila',
       term_months,
       -- Illustrative repayment using 1.5% monthly reducing-balance interest.
       -- This value is sample data, not a quote from the live loan policy.
       round(principal * 0.015 / (1 - power(1.015, -term_months)), 2)
from csucc_demo_2026 d
where not exists (select 1 from public.loan_applications l where l.id = d.loan_uuid);

-- Verify persisted records before committing, including chronological consistency.
do $$
begin
  if (select count(*) from public.members m
        join csucc_demo_2026 d on d.member_uuid = m.id) <> 60
     or (select count(*) from public.loan_applications l
        join csucc_demo_2026 d on d.loan_uuid = l.id) <> 60 then
    raise exception 'Incomplete demo dataset. Nothing has been committed.';
  end if;
  if exists (
    select 1 from public.loan_applications l
      join csucc_demo_2026 d on d.loan_uuid = l.id
    where l.date_approved < l.date_submitted
       or l.date_released < l.date_approved
       or l.date_completed < l.date_released
       or l.date_submitted > date '2026-10-29'
       or l.date_approved > date '2026-10-29'
       or l.date_released > date '2026-10-29'
       or l.date_completed > date '2026-10-29'
       or (l.status in ('approved','released','overdue','completed')
           and l.date_approved is null)
       or (l.status in ('released','overdue','completed')
           and l.date_released is null)
       or (l.status = 'completed' and l.date_completed is null)
  ) then
    raise exception 'Invalid demo lifecycle dates. Nothing has been committed.';
  end if;
end $$;

commit;

-- The Results panel should show ten months with six applications each.
select to_char(date_submitted, 'YYYY-MM') as month,
       count(*) as applications,
       count(*) filter (where status = 'pending') as pending,
       count(*) filter (where status = 'under review') as under_review,
       count(*) filter (where status = 'approved') as approved,
       count(*) filter (where status = 'released') as released,
       count(*) filter (where status = 'completed') as completed,
       count(*) filter (where status = 'overdue') as overdue,
       count(*) filter (where status = 'rejected') as rejected,
       sum(amount) as principal_total
from public.loan_applications
where application_id like 'LA-DEMO-2026-%'
group by 1 order by 1;
