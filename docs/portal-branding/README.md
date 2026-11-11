# Cooperative portal branding

The Admin and Super Admin letterhead and footer use the wording from the user-provided `HEADER.docx`. Its original 800 × 800 seal was extracted from `word/media/image1.jpeg` and copied unchanged to `public/images/coop-official-seal.jpg`; both files have the same SHA-256 hash.

`src/lib/cooperativeBranding.ts` holds the name, address, phone, CDA number, affiliations, motto and seal path. `CooperativeLetterhead.tsx` presents that identity beside the existing date and notification bell. The logo remains an ordinary accessible image; the cooperative name is a paragraph, leaving one page-level heading in the content container.

The header stays in normal layout flow with sticky positioning. Its three desktop columns place an 88 px seal in the left lane, centered identity text in the middle, and the date and notification controls on the right. They stay on one row from 900 px viewport width; smaller devices use an additional utility row to keep the full wording readable. Desktop height remains approximately 104–105 px when the wording fits. The slightly smaller seal follows the latest annotated size guide without increasing header height. A ResizeObserver publishes its actual height for incoming alert positioning. Existing sidebar identity and compact page headings remain in their containers. The sidebar seal is removed. The account card sits slightly lower, and navigation sections spread vertically so My Profile reaches approximately 80–87% of desktop height. On short screens the reserved lower space contracts before navigation needs to scroll.

One decorative seal is fixed in the center of the workspace below the header. Its desktop size is 560 px, capped by available width and height with 24 px vertical clearance on shorter screens. This lets it extend farther down to the latest annotated lower guide. Scrolling, pagination and changes between pages do not resize or reposition it. It uses 6.5% opacity, a 1.25 px blur, reduced color saturation and a multiply layer to remain visible without overpowering text, including in empty Notifications and Committee Accounts, Settings and Profile. The layer is hidden from assistive technology, receives no pointer events and occupies no layout space. The header, sidebar, menus and dialogs remain above it. There are no repeated per-table or per-card seals.

The footer contains only the document's motto, centered in italic serif text with the portal's green and gold colors. Six-pixel vertical padding keeps it compact. It follows long content and rests at the bottom of short pages. The Super Admin live-status indicator and sound control now sit in the header, with an accessible label and hover title, so they cannot offset the centered motto or cover pagination. Actual incoming alert cards continue to appear below the measured header.

## Validation

- `COOP_BRANDING_QA=1 node scripts/action-dialogs.test.mjs`: real shared shell/header/sidebar/footer and representative page components with synthetic data and isolated transports. Checks the exact identity text, original image loading, notification bell, table pagination, one centered stationary watermark, expanded/collapsed sidebar, header/content bounds at 1440, 1280, 1024, 900, 768, 390 and 320 px, and a centered compact footer. It also checks balanced menu placement and non-scrolling sidebar content at desktop heights 900, 768, 693, 640 and 620 px and captures the actual Notifications, Committee Accounts, Settings and Profile components.
- TypeScript, targeted ESLint and the optimized Next.js build passed.
- Screenshots in `screenshots/` were inspected after the final layout pass. They use sample records rather than live member data.
- `screenshots/logo-sizing-prototype.png` previews the latest logo sizing and softer background at the approximate dimensions and zoom of the user's annotated screenshot.

No database migration or account/loan policy change is required for this presentation update.
