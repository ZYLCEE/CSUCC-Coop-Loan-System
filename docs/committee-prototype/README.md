# CRECOM and BOD prototype

Superseded by [preconfigured shared-login demonstration accounts](../shared-committee-login/README.md). The original prototype URLs now redirect to `/login`; the former public sign-in-card walkthrough below is retained as development history. Use `scripts/shared-committee-login.test.mjs` for the current browser walkthrough.

Open `http://localhost:3000/prototype/committee` while the local app is running. The real login screen and Super Admin Committee Accounts page also link here.

The four public sample identities and their different prototype passwords are displayed on the sign-in cards:

- Prototype CRECOM Member 1
- Prototype CRECOM Member 2
- Prototype CRECOM Chairperson
- Prototype BOD Chairperson

Choose **Use [position]**, then **Open prototype portal**. When recording a sample decision, use that same identity's displayed prototype password. These credentials are valid only in the separate prototype sign-in. They are not Supabase Auth users or credentials for the real login screen.

## Walkthrough

1. Sign in as each of the three CRECOM identities and review **PROTO-2026-0001**. Each person records their own confirmation for the same fictional member.
2. Switch to the BOD chairperson. After all three CRECOM responses, that case is available with a summary of the three individual confirmations.
3. Record BOD's sample decision. **Sample approval flow** shows that the case is ready for Super Admin's final decision, or that a required rejection blocks final approval.
4. Explore assigned applications, sample documents, notifications, review history and profile. Sample passwords remain fixed; the real password-change form is disabled for these demonstration identities.
5. **Reset prototype** restores the original fictional fixtures. It resets only the prototype key in this browser.

PROTO-2026-0002 already includes three sample CRECOM confirmations, so BOD has a case available immediately. PROTO-2026-0003 provides existing sample history for all four identities.

## Separation from real operations

The prototype reuses the portal components through explicit session and service providers. All prototype requests are handled by a browser-local fixture store; there is no fallback to the real service. The prototype user metadata uses the role `prototype`, carries no Auth token and grants no server authority. Existing server authentication, password confirmation, membership, assignment, policy and RLS checks are unchanged.

Progress and sample profile edits use `csucc.committee-prototype.v1` in localStorage. The selected identity uses `csucc.committee-prototype.session.v1` in sessionStorage. Signing out clears only this prototype session; it does not sign out a real Admin/Super Admin session. There are no production database migrations, invitations, real document requests, final decisions or loan releases in this feature.

The automatic handoff and BOD CRECOM-summary display are prototype behavior. Live BOD forwarding still requires authorized staff to assign the chairperson, and its prior-panel read model remains a separate future change. No financial policy or real loan amount is changed by the illustrative sample values.

After the cooperative confirms the actual officers, use the real policy activation and **Committee Accounts → Invite reviewer** process. Create personal accounts using verified officer emails rather than converting these public prototype identities or transferring their sample decisions.

## Validation

- `node --test src/lib/committeePrototype.test.mjs src/lib/committee.test.mjs src/lib/committeeReview.test.mjs`: 22 passed.
- `node scripts/committee-prototype.test.mjs`: real Next.js page walkthrough for all four identities, individual confirmations, BOD handoff and summary, local persistence/reset, document and profile screens, and mobile layout. All `/api/` and Supabase requests are blocked and asserted absent.
- Existing account/portal and reviewer browser regression suites passed with normal service defaults.
- TypeScript, targeted ESLint and Next.js production build passed.
- Screenshots in `screenshots/` show the sign-in, CRECOM dashboard and BOD confirmation views.
