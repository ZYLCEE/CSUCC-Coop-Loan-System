# Per-admin privileges

Settings → Roles & Permissions lists existing `admin` / `coop_admin` Auth accounts.
Super Admin selects an account, edits its privileges and verifies their own
account password to save. Empty privileges preserve the existing Admin view
access. Super Admin access is fixed and cannot be edited through this screen.

Supported privileges:

- `documents.upload`: cooperative document uploads.
- `documents.delete`: cooperative upload deletion; loan attachments are excluded.
- `notifications.send`: immediate member notifications and outgoing history.
  Sending still requires the acting admin's own password and confirmation.
- `settings.manage`: cooperative name and document upload settings.

`/api/admin/privileges` stores grants in server-controlled Auth `app_metadata`,
preserves other metadata, rejects non-admin/inactive targets and unknown keys,
checks a version to catch stale edits, and logs successful changes. GET and PUT
are restricted to active Super Admin accounts. No new database migration is needed.

Resource and notification write endpoints call Auth `getUser` on every request
and enforce current grants, including before notification execution. Revocation
therefore takes effect on the next server request. The portal reloads current
Auth metadata on focus and every 30 seconds while visible. A stale browser token
does not authorize server writes. Admins cannot set their own `app_metadata`.

The UI exposes only the delegated operations implemented by these endpoints.
Account management, loans, payments, loan policy, announcements and scheduled
notifications retain their existing Super Admin backend requirements. Read
access remains governed by the existing Admin role and database policies.

Tests cover default denial, per-account isolation, invalid/unauthorized grants,
metadata preservation, save/revoke behavior, audit warnings, and direct endpoint
enforcement. Browser verification loads real admins without changing live access.
