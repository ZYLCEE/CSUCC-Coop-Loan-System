# Loan borrower lookup repair — November 11, 2026

Loan Applications failed with PostgREST PGRST201 because loan_applications now has two relationships to members: member_id for the borrower and co_maker_member_id for the co-maker. Unqualified members embeds became ambiguous.

The application list, active loans, loan details, repayment details, dashboard and document workspace now explicitly select the borrower foreign key while preserving the existing members response alias. The approval lookup preserves its inner join and existing eligibility checks while selecting that same borrower relationship.

Live read-only checks passed for all seven query shapes. The application list returned 17 records, each linked to its borrower; Documents returned 66 application records and 20 files without warnings. The authenticated Super Admin SQL read and workflow summary also succeeded.

Validation: 25 loan/dashboard/document tests and 16 staged backend/security tests passed, as did TypeScript, targeted ESLint and the optimized production build.

The deployed secure-admin-action version 11 is the previously verified version-10 source plus the borrower qualifier only. Its gateway JWT verification remains enabled. The exact staged source is preserved beside this report, with hashes in deployment-manifest.json. No database migration, real approval, account operation or financial transaction was performed for this repair.
