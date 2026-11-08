# Supabase Setup for Admin Web

This document explains how to set up the admin web application to connect to Supabase.

## Environment Variables

Set the following variables in the admin app's ignored `.env.local` file for local development, or in the deployment environment when hosting the app:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted for projects using a legacy anon key. Admin API routes require `SUPABASE_SERVICE_ROLE_KEY` in the server environment. Keep this key out of browser code and never give it a `NEXT_PUBLIC_` prefix.

## Architecture

### Supabase Clients

The browser client uses the publishable or anon key and the signed-in administrator's Supabase Auth session. Row-level security controls the browser client's access. Admin API routes and Edge Functions check the signed-in administrator and use server-side credentials for privileged operations.

### API Layer

- The loan applications page reads from Supabase. Approval, rejection, and release use password-confirmed actions.
- All Accounts loads through the `list-admin-accounts` Edge Function. Account changes use the `secure-admin-action` Edge Function.
- Admin privileges are saved through `/api/admin/privileges`.

## Data Flow

```
Flutter App → Supabase (PostgreSQL + RLS)
Admin Web → Supabase (PostgreSQL + Auth session + RLS)
```

Both the Flutter app and admin web connect to the same Supabase database:
- **Flutter app** uses the anon key with member-scoped RLS policies.
- **Admin web** uses the same project with an authenticated admin session.

## Real-time Updates

The loan applications page refreshes on changes to `loan_applications`, and the Super Admin portal displays alerts for new pending applications. These features require `loan_applications` in the project's Supabase Realtime publication and read access for the signed-in administrator.

## Running the Admin Web

1. Install dependencies:
```bash
cd coop_frontend_admin
npm install
```

2. Set the environment variables above for the admin app.

3. Run the development server:
```bash
npm run dev
```

4. Open http://localhost:3000

## Security Notes

- Never commit the `.env.local` file to version control
- Create admin users in Supabase Auth and set their server-managed `app_metadata.role` to `coop_admin`.
- Client-side role checks are for navigation; RLS in migration 005 is the data authorization boundary.
- Apply all migrations through `005_shared_admin_and_app_fields.sql` before signing in.

To assign the role to an existing Supabase Auth user, run this in the SQL Editor with that user's email:

```sql
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"coop_admin"}'::jsonb
WHERE email = 'admin@example.com';
```

Sign out and back in after changing the role so the refreshed session contains the new claim.

## Database Schema

The admin web expects the following Supabase tables:

- `members` - Member information
- `loan_applications` - Loan applications
- `loan_payments` - Loan payment records
- `savings_accounts` - Savings account information
- `notifications` - User notifications

Make sure you've applied the database migrations from `supabase/migrations/` in the Flutter project.
