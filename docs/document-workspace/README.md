# Documents workspace

Member Documents groups existing loan attachments by member and application. Required files follow the current loan policy: valid ID and pay slip, plus collateral above the configured threshold. Completeness records uploads; verification records a human decision. Neither operation approves or changes the loan.

Each review records the administrator, Philippine date/time, decision and replacement reason. Reviews belong to a file version. Requested replacements are allowed for Pending or Under Review applications only. The original and earlier replacements remain available in History, and every new version starts To review. Loan Applications opens the latest version.

Shared Documents supports PDF, DOCX, PNG and JPG within the portal upload settings (maximum 10 MB). Staff can save private drafts or confirm publication for all active members or up to 100 selected members. Database and private Storage policies enforce the audience. Existing cooperative uploads stay staff-only; they are never automatically published. Deleting a new shared document removes it from the library and blocks new access while retaining its stored file for audit. Previously issued download links expire within five minutes.

Super Admin has all document actions. Admin review, upload and deletion are separate permissions in Settings → Roles & Permissions. The member app has a Documents drawer entry for shared files, submission reviews, version history and requested replacements.

## Validation

- `node --test src/lib/documentWorkspace.test.mjs`
- `node scripts/action-dialogs.test.mjs` (synthetic browser transport)
- Set `COOP_DOCUMENTS_QA=1` for the dedicated document workflow browser checks.
- Set `COOP_PAGINATION_QA=1` and `COOP_PAGINATION_VIEWS=documents` for desktop/mobile pagination checks.
- TypeScript and targeted ESLint checks.
- `flutter analyze --no-pub lib/documents_screen.dart lib/services/document_center_service.dart lib/drawer_menu.dart`
- `flutter test --no-pub test/document_center_service_test.dart`
- The SQL bootstrap/cases run on the empty staging public schema in one transaction with rollback, never on live member records. Generate the complete test using `node scripts/prepare-document-sql-test.mjs`.
- `node scripts/check-document-live-data.mjs` reads live data shape and prints counts only.

Migration: `supabase/migrations/20261110_document_workspace.sql`, also copied to the shared backend migration directory. It adds four protected tables, review/replacement/sharing RPCs and a private bucket; no historical migration or loan records are rewritten.
