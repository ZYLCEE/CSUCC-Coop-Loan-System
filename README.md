# CSUCC Cooperative Admin System

Administrative and committee portals for the CSUCC cooperative loan system, built with Next.js, React, TypeScript, Tailwind CSS and Supabase.

The portal supports Super Admin, Admin, CRECOM and BOD accounts, member/account management, documents, active logs, notifications, loan processing, release and active-loan management. Loan processing follows Requirements → CRECOM → BOD → Final Decision → Release.

## Local setup

Install dependencies in a fresh checkout:

```powershell
npm ci
Copy-Item .env.example .env.local
```

Set the Supabase project URL, publishable key and server-only service-role key in `.env.local`. Keep the service-role key on the server; it must never use a `NEXT_PUBLIC_` variable.

```powershell
npm run dev
```

Open http://localhost:3000. For a production build, run `npm run build` followed by `npm start`.

## Database and member app

Database migrations, Edge Functions and database tests are under `supabase/`. Follow [Supabase setup](SUPABASE_SETUP.md) for the deployed project's configuration. Existing databases have legacy migration version names, so review migration dependencies before applying a batch of changes.

Borrower agreement receipts are saved by the updated member app and displayed in the admin evidence dialog. See [consent integration](docs/application-evidence/integration/README.md), [committee account setup](docs/committee-creation/PASSWORD-SETUP.md), and [active logs](docs/active-logs/README.md).

## Validation

Run `npm run build` to check the production build. Unit/API tests live alongside the source as `*.test.mjs`; browser workflow checks are in `scripts/action-dialogs.test.mjs`. Database rollback validations are documented with each feature.

Local environment files, build output, Supabase CLI link/cache files and generated QA screenshots are not required to run the system and are kept out of publication.
