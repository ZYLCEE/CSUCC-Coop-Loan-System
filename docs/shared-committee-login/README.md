# Preconfigured committee demonstration accounts

The four demonstration identities now sign in through the existing `/login` page. Two CRECOM members and the CRECOM chairperson go to `/crecom/dashboard`; the BOD chairperson goes to `/bod/dashboard`. No second prototype login or Super Admin account-creation step is required.

The supplied emails and passwords were configured privately in the local environment. They are not reproduced in source files or this guide. Passwords are stored as salted scrypt hashes; the server issues an eight-hour signed HttpOnly, SameSite cookie after verification. The same account password is checked by the server when confirming a sample review. Role and position are fixed by the private configuration, never selected by the person signing in.

## Demonstration

1. Open `http://localhost:3000/login` and use a configured committee email/password.
2. Review sample **PROTO-2026-0001** using each of the three CRECOM accounts. Use **Switch account** to return to the same login page.
3. Sign in as the BOD chairperson. Once all three CRECOM responses exist, that sample application appears with their recorded confirmation summary.
4. Confirm BOD's sample decision. **Sample approval flow** shows readiness for Super Admin's final decision, or blocks approval when a required reviewer rejected.

Sample applications, decisions, notifications and profile edits remain in this browser's separate prototype data store. **Reset sample data** clears only that store. Account passwords are never displayed in the portal, saved in browser storage or sent to the prototype fixture recorder. Old `/prototype/committee` bookmarks redirect to `/login`.

## Boundaries

These are preconfigured, authenticated demonstration accounts. They are separate from live Supabase users and membership records. No existing member account, Admin account, password, live policy or loan was created, overwritten or approved. The demonstration cookie is not a Supabase access token and is not accepted by real business APIs. Ordinary Admin/Super Admin and live committee sign-ins continue through the existing provider when the email is not a configured demonstration identity.

The real financial workflow still requires its approved policy and verified officer memberships. The system team will configure the actual officers after confirmation at the cooperative office. Sample decisions must not be migrated or represented as actual officer approvals.

## Private configuration

Use `scripts/configure-committee-demo-accounts.mjs` with `COOP_DEMO_ACCOUNT_INPUT` supplied privately at execution time. The input is a JSON array of four records with `id`, `name`, `email`, and `password`. Required IDs are `crecom-1`, `crecom-2`, `crecom-chair`, and `bod-chair`. Positions are fixed by the script.

It writes only `COOP_COMMITTEE_DEMO_ACCOUNTS` (encoded records containing salted password hashes) and `COOP_COMMITTEE_DEMO_SESSION_SECRET` into ignored `.env.local`. Other environment settings are preserved. Reconfiguration rotates sessions. For hosting, configure those two values privately in the host environment; do not add the local environment file to source control.

## Validation

- Model/API tests cover exact positions, password verification, signed/expired/rotated sessions, no credential disclosure, confirmation gates, cross-origin rejection, throttling, fixture isolation and existing real account/review API behavior.
- `scripts/shared-committee-login.test.mjs`, using the privately supplied credentials, verifies all four sign-ins through the original page, correct portal routing, individual password confirmations, CRECOM/BOD sample handoff, persistence and sign-out. Live Auth and business API requests are blocked and asserted absent.
- Existing committee account and review browser regression suites, TypeScript, ESLint and the production build are checked.
- Screenshots in `screenshots/` show the signed-in CRECOM and BOD views without passwords.
