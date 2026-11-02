# My Profile

`ProfileWorkspace` is the active page for both Admin and Super Admin routes.
It loads the signed-in account through `/api/admin/profile`, edits personal
details, displays the latest ten own audit events, and uses `PasswordSection`
for password changes. Authorization fields are read-only. Super Admin can use
Change email to edit their own sign-in address after current-password verification.
The normal Auth confirmation flow is preserved, and pending email changes are
displayed until confirmation. Admin accounts cannot use this email-change endpoint.

The server derives the target user from the verified bearer token. It accepts
only first name, last name, contact number, department and job title. Accounts
without a member record save their details in Auth user metadata. Linked accounts
also synchronize first name, last name, contact number and department to their
own member row. Failed synchronization is reported explicitly and can be retried.
Saving refreshes the authentication context so the header name updates immediately.

Password changes validate the current password in an isolated temporary Auth
session, verify that the identity matches the requesting account, and update
through that session. The browser's session is never replaced by verification.
Temporary sessions are signed out after the attempt. Passwords are never logged
or included in audit details. Tests use mocked Auth clients; browser verification
does not change live credentials.

Inactive/non-admin sessions and attempts to edit identity, email, role, account
status or privileges through profile edits are rejected. The dedicated PATCH
email endpoint accepts only an email and current password, targeting the verified
Super Admin account. Audit failures are shown as warnings after
successful saves instead of incorrectly reporting that the update failed.
