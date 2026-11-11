# First-login password setup

The first-login handler used `auth.updateUser()` on a server SDK client with only an Authorization header. The installed SDK requires a stored SDK session for this method and returned `AuthSessionMissingError` before contacting Auth. The handler now verifies the caller, checks live membership admission, and updates that same caller through the Auth user endpoint using the verified bearer and public API key. It does not collect refresh tokens or use an administrative password override. The related committee profile update uses the same authenticated helper.

`20261111233000_committee_password_setup.sql` was applied after rollback validation. Personal setup no longer requires an email invitation timestamp when a completed temporary-password creation request is bound to the same Auth user and membership. Inactive, banned, unconfirmed, incomplete and borrower-linked accounts remain blocked. Completion remains service-only and is invoked only after Auth confirms a successful password update for the verified identity.

Same-password, weak-password, expired-session and provider errors have specific safe messages and never complete setup. Already-configured accounts using setup as a reset path still need recent recovery evidence checked against the explicit verified JWT. Missing access data now produces an error instead of pretending admission succeeded.

The shared `ui/PasswordInput` adds independent show/hide controls to the remaining password fields across the admin and committee web portals: setup, committee profile/review, loan confirmations, policy activation and privilege dialogs. Existing login, profile, account-creation and reset controls retain their visibility buttons.

Validation covers the installed SDK failure, authenticated Auth request and actor scoping, failure exclusion, setup-call ordering, service-only SQL completion, private setup gates, idempotence, CRECOM/BOD dashboard redirects, retry/double-submit behavior, eye controls, mobile layout, existing dialog/review/account regressions, static checks and the production build. Database fixtures were rolled back. No real reviewer password was changed by testing.

For the existing reviewer, refresh the current setup page and choose a personal password different from the temporary password. The account remains awaiting personal setup until the reviewer successfully submits it; installation does not bypass that step.
