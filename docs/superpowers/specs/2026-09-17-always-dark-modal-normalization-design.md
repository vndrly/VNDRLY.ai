# Always-Dark Modal Normalization Design

Date: 2026-09-17

## Goal

Make every web modal independent of the page-level Dark/Light toggle. Every modal must use the approved dark Ask V-style header and shell, while retaining the current light-gray body and white form controls. This is a web-only change; it does not update the API, mobile app, OTA channel, or TestFlight.

## Approved visual contract

- The header and outer shell always use the existing APP_MODAL_DARK treatment.
- The header follows the Ask V reference: faded dark header image, consistent height, company square logo at the left, title and supporting text in the header, and Settings/Close controls inset at the right.
- The body remains light gray with dark readable text.
- Inputs, dropdowns, text areas, scrollbars, and checkboxes remain light-mode controls. Existing organization-brand borders, hover states, and check colors remain intact.
- The page theme may change the page, but it must not change an open modal.
- Dialog behavior, permissions, data loading, submission, focus trapping, keyboard escape rules, and destructive confirmations must not change.

## Inventory baseline

The source audit found the following modal-like surfaces under artifacts/vndrly/src:

| Surface | Current occurrences | Treatment |
| --- | ---: | --- |
| DialogContent | 90 | Pin to dark theme; migrate headers to shared Ask V header |
| AlertDialogContent | 19 | Pin to dark theme; use the same header contract for confirmations |
| MiniCardDialogContent | 5 | Preserve its approved Ask V layout; remove page-theme dependence |
| SheetContent | 2 | Migrate the Find Vendor modal sheet; explicitly exclude the mobile navigation drawer |
| Custom role=dialog surfaces | 2 | Audit individually; migrate real modals and document intentional non-modal popovers |

Test-only mock occurrences do not count as production surfaces, but their stubs may need updates if the shared interface changes.

## Architecture

### 1. One immutable modal theme

Add a single exported APP_MODAL_ALWAYS_DARK alias or resolver in app-modal-tokens.ts. Shared modal components consume this value directly rather than reading useTheme.

DialogContent, AlertDialogContent, and their title/description helpers must all consume the same theme contract. SheetContent gains an optional modalChrome boolean that defaults to false; the Find Vendor sheet sets it to true, while the mobile navigation drawer remains unchanged. This removes page-theme branching from modal roots and prevents future call sites from accidentally restoring light modal chrome.

### 2. One reusable Ask V-style header

Create a shared modal header component owned by the modal system. It accepts:

- title
- optional description
- optional icon
- optional company logo override
- optional settings content/control
- optional close-control suppression for forced flows

The component owns the approved header height, faded image, logo dimensions, title placement, settings placement, and close placement. MiniCardDialogContent becomes a thin consumer of this shared header instead of maintaining parallel header constants.

Existing DialogLogoHeader remains as a compatibility adapter during migration, but it registers the logo with the shared header rather than rendering a separate centered logo area.

### 3. Complete call-site migration

Audit every production occurrence in the inventory. Each modal is classified as one of:

- standard form/detail modal
- destructive or confirmation modal
- Ask V/summary flyout
- blocking account/onboarding modal
- sheet/drawer modal
- intentional non-modal popover

All real modals move to the shared header. Custom bare dialogs keep their custom body layout but receive the shared header unless they are the Ask V conversation panel itself, in which case the existing approved Ask V header is retained through the same shared primitives.

Intentional non-modal popovers, such as compact public helpers or combobox popovers, are not changed merely because they use role=dialog; the audit records why each exclusion is not a modal.

### 4. Light body controls

The modal body wrapper explicitly establishes color-scheme: light. This prevents native scrollbars, date/time controls, selects, and checkboxes from inheriting the page's dark native chrome. Existing branded component styles remain the source of truth for borders and active colors.

## Testing

### Shared contract tests

- Render DialogContent under page light and page dark; assert identical dark shell/header and light body.
- Repeat for AlertDialogContent and SheetContent with modalChrome enabled.
- Assert the shared header uses the approved height, image, logo placement, title/description placement, and inset controls.
- Assert modal body controls keep color-scheme: light in both page themes.

### Migration tests

- Maintain an inventory test that scans production TSX sources and fails when a modal-like surface bypasses the approved shared primitives without an explicit audited exemption.
- Update focused tests for custom bare dialogs, account flows, employee dialogs, Ask V flyouts, and destructive confirmations.
- Run the web type-check, web test suite, and production web build.

### Live verification

After the verified commit advances main, publish only the web workflow. Verify the public site and manually sample representative modal categories in both page themes before telling the user to refresh.

## Rollout and risk controls

- No database migration.
- No API behavior change.
- No mobile source change.
- No OTA or TestFlight workflow.
- Preserve all existing modal interaction behavior.
- If a custom modal cannot adopt the shared header without changing its flow, stop and record it as an explicit exception rather than forcing a visual-only refactor that could break behavior.

## Completion criteria

- Every production modal occurrence is covered by a shared primitive or a documented intentional non-modal exemption.
- Switching the page between Dark and Light does not alter modal chrome.
- All real modal headers conform to the shared Ask V reference.
- Bodies and native controls remain light and readable.
- Focus, close, settings, submission, and confirmation behavior remains unchanged.
- Focused tests, the full web test suite, type-check, production build, web publication, and live verification all pass.
