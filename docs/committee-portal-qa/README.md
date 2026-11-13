# Committee portal simplification

Implemented for CRECOM and BOD using the existing Next.js, React, Tailwind and Supabase architecture.

- Loan Applications table uses borrower/member ID, loan type, amount, own decision, actual approval progress and a three-dot action menu.
- Review Application opens a tabbed modal: Loan Details, Requirements, Committee Approvals and My Decision. Existing direct review URLs open this modal over the application list.
- Assigned documents use the existing version-scoped, five-minute signed file endpoint in a child modal.
- Approve/Reject retain the existing personal password, explicit acknowledgment, request-ID retry and stale-state checks. Clarification and Unable to Review remain available as secondary actions. Recorded decisions remain immutable.
- Approval progress is read from actual individual decisions after the JWT-scoped workspace/application RPC admits the assignment. Only the admitted review cycles are queried; private reasons from other reviewers are not selected. Two approvals remain two of three, and rejection is never counted as approval.
- Notification bell opens an anchored popover with recipient-filtered Supabase INSERT/UPDATE subscriptions, reconnect/focus/visibility refresh, fallback polling, unread filtering and persisted read actions. Bell and full inbox synchronize read state in the same tab. Eligible notification links open the review modal; revoked assignments are still denied by the existing backend.
- Removed duplicated Applications/Review History descriptions and the nested Active Logs heading/description in committee portals. The shared admin logs page remains intact.

Validation completed November 12, 2026:

- 219 source tests passed (source-tests.txt).
- TypeScript and targeted ESLint passed.
- Optimized Next.js production build passed.
- Isolated Edge browser checks passed for CRECOM/BOD table actions, tabs, child document/security dialogs, notification realtime events and unread/read synchronization, read failures, revoked access, mobile layouts, immutable decisions, clarification pause and existing final-decision gates.
- Desktop/mobile screenshots were visually inspected; UTF-8 text was corrected.

Browser tests use synthetic transports and recipient events. No live accounts, committee decisions or loan records were changed. No new database migration, GitHub push or remote deployment was performed.
