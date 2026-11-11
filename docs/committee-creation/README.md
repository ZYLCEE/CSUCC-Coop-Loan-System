# Committee account creation repair

The deployed database had two incompatible behaviors: `handle_new_user()` created a borrower profile for every new Auth identity, including committee reviewers, and committee provisioning required `invited_at` even for temporary-password accounts. The failed request shown by the user has the correct trusted role, email and request marker, but an empty automatic borrower profile and no invitation timestamp.

`20261111223000_committee_account_creation.sql` was validated in a rollback-only transaction and applied to the connected COOP database. It:

- Skips borrower-profile creation for trusted committee roles and matching reserved committee invitations, while retaining normal member creation.
- Separates password provisioning from email invitation evidence. Email invitations still require their invitation timestamp.
- Retains request ownership, leases, stable request IDs, current-password verification and duplicate prevention.
- Archives only a confirmed empty automatic profile belonging to the same creation request before retrying. It checks all foreign keys referencing the member table and refuses profiles with linked records or genuine member information. The archive is private to the service role. Repair does not generate a false account-deletion activity event.
- Stores CRECOM Member 1 / Member 2 on memberships and snapshots the number into assignments and decisions. Chairs have no member number. Old records stay unnumbered until explicitly edited; historical decisions are not renumbered.
- Requires one Member 1, one Member 2 and one chairperson for a new CRECOM panel. Numbered replacements must hold the same position. Existing three-approval and BOD/final-decision rules remain intact.
- Allows active Admin accounts with the explicit `committee.accounts.manage` privilege. Only Super Admin can assign this privilege; it is not granted automatically.

The UI provides the four approval-position choices, field-specific validation, independent eye controls for temporary/confirmation/creator passwords, and a guard against duplicate submission. It follows Details → Review → Creator password → Create → Personal setup. The roster, portal identity, reviewer choices and approval records use the saved numbered position.

For the existing failed request, refresh Committee Accounts and use **Retry creation**. Choose Member 1 or Member 2 if the older request has no number, re-enter temporary credentials, review, and confirm with the creator's own account password. Retry reuses the saved Auth account. The repair is performed during that verified retry; installation does not silently complete the account or set its password.

Validation includes rollback-only creation/invitation/retry cases, preservation of linked member records, explicit Admin permission checks, private writers, personal setup gates, assignment snapshots, API unit tests, browser form/eye/retry checks, the five-step processing regression, and the production build. No real reviewer account was created or password changed by testing.
