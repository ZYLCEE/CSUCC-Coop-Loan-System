# Agreed loan approval workflow

Implementation in progress. Scope: Pending → requirements → all three CRECOM confirmations → BOD confirmation → password-confirmed final staff decision → separate release. Returned applications require a reason and the acting staff account password. Resubmission starts a new requirements check and four fresh confirmations; old evidence remains in history.

Committee accounts remain separate from members. Each reviewer uses the shared login and a role-specific portal. Every decision requires the reviewer's own password. The live workflow is enforced by database procedures as well as the interface. Existing approved/released loans retain their history.

The user selected **Configure email delivery later**. Returns create in-app notices and an email outbox record; no email is reported as sent without a configured delivery service.

Work items:
- [ ] Database status, return/resubmit boundaries, committee routing and final approval permissions.
- [ ] Password-confirmed staff API actions and dedicated committee account creation.
- [ ] Pending/Returned administration and member corrections/resubmission.
- [ ] Cooperative-branded committee portals, dashboard, history and notifications.
- [ ] Integration/security tests, visual checks, deployment verification and handover.
