# Always-Dark Modal Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Normalize every production web modal to the approved dark Ask V-style header and shell while preserving light-gray bodies, white controls, and all existing behavior.

**Architecture:** Shared modal primitives own the immutable dark theme and header layout. Standard and confirmation dialog headers render into a shared header host, custom bare dialogs consume the same header component directly, and only the Find Vendor sheet opts into modal chrome. A source inventory test prevents future modal surfaces from bypassing the contract.

**Tech Stack:** React 19, TypeScript 5.9, Radix Dialog and AlertDialog, Tailwind CSS, Vitest, Testing Library, Vite.

**Spec:** docs/superpowers/specs/2026-09-17-always-dark-modal-normalization-design.md

## Global Constraints

- Web only: do not change API, database, mobile, OTA, or TestFlight sources or workflows.
- Modal header and shell always use the existing APP_MODAL_DARK treatment.
- Modal body remains light gray with dark readable text.
- Inputs, dropdowns, text areas, scrollbars, and checkboxes remain light-mode native controls with existing brand styling.
- Preserve focus trapping, close rules, escape behavior, submissions, permissions, and destructive confirmations.
- The mobile navigation drawer is not a modal and must remain unchanged.
- Use TDD for every behavior change: red test, minimal implementation, green test.

## File structure

- Create artifacts/vndrly/src/components/app-modal-header.tsx: reusable Ask V-style header.
- Create artifacts/vndrly/src/components/app-modal-header.test.tsx: header geometry and control contract.
- Create artifacts/vndrly/src/components/ui/modal-theme-contract.test.tsx: theme-invariance coverage for Dialog and AlertDialog.
- Create artifacts/vndrly/src/components/ui/sheet-modal-theme.test.tsx: modalChrome behavior and navigation-sheet exclusion.
- Create artifacts/vndrly/src/components/modal-inventory.test.ts: production modal inventory enforcement.
- Modify artifacts/vndrly/src/components/app-modal-tokens.ts: immutable modal theme export.
- Modify artifacts/vndrly/src/components/ui/dialog.tsx: dark theme, header host, light body controls.
- Modify artifacts/vndrly/src/components/ui/alert-dialog.tsx: dark theme and shared header host.
- Modify artifacts/vndrly/src/components/ui/sheet.tsx: opt-in modalChrome contract.
- Modify artifacts/vndrly/src/components/mini-card-dialog-content.tsx: consume shared header.
- Modify custom bare-dialog components identified by the inventory: assistant-panel.tsx, change-password-modal.tsx, employee-dialog-content.tsx, foreman-schedule-pick-dialog.tsx, notification-send-to-dialog.tsx, notifications-modal.tsx, onboarding-account-created-dialog.tsx.
- Modify artifacts/vndrly/src/pages/ticket-detail.tsx: opt the Find Vendor sheet into modalChrome.
- Audit artifacts/vndrly/src/components/public-askv.tsx and artifacts/vndrly/src/components/plate-state-picker.tsx and add explicit inventory exemptions: PublicAskV is a persistent non-modal helper (`aria-modal=false`), while PlateStatePicker is an input-owned popover picker rather than a page-blocking modal.

---

### Task 1: Immutable modal theme contract

**Files:**
- Modify: artifacts/vndrly/src/components/app-modal-tokens.ts
- Create: artifacts/vndrly/src/components/ui/modal-theme-contract.test.tsx
- Modify: artifacts/vndrly/src/components/ui/dialog.tsx
- Modify: artifacts/vndrly/src/components/ui/alert-dialog.tsx

**Interfaces:**
- Produces: APP_MODAL_ALWAYS_DARK: AppModalTheme
- Produces: appModalTheme(): AppModalTheme returning the immutable dark contract for compatibility
- Consumes: existing APP_MODAL_DARK token

- [ ] **Step 1: Write the failing theme-invariance tests**

Render DialogContent and AlertDialogContent under mocked light and dark page themes. Assert both render the same dark shell, dark header image, light-gray body, and light native color scheme.

~~~tsx
for (const resolved of ["light", "dark"] as const) {
  mockedResolvedTheme = resolved;
  const { unmount } = renderStandardDialog();
  expect(screen.getByRole("dialog").className).toContain("bg-[#3a3d42]");
  expect(screen.getByTestId("modal-body").className).toContain("bg-[#d1d5db]");
  expect(screen.getByTestId("modal-body").style.colorScheme).toBe("light");
  unmount();
}
~~~

- [ ] **Step 2: Run the focused tests and verify red**

Run:

~~~powershell
pnpm --dir C:UsersJohnElerickDEVVNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/ui/modal-theme-contract.test.tsx
~~~

Expected: light-page cases fail because DialogContent and AlertDialogContent still call useTheme and select APP_MODAL_LIGHT.

- [ ] **Step 3: Implement the immutable token**

In app-modal-tokens.ts:

~~~ts
export const APP_MODAL_ALWAYS_DARK: AppModalTheme = APP_MODAL_DARK;

export function appModalTheme(_resolved?: "light" | "dark"): AppModalTheme {
  return APP_MODAL_ALWAYS_DARK;
}
~~~

Update DialogContent, useModalTheme, AlertDialogContent, AlertDialogTitle, and AlertDialogDescription to consume APP_MODAL_ALWAYS_DARK directly. Add style colorScheme: "light" to each shared body wrapper and expose data-testid="modal-body".

- [ ] **Step 4: Run the focused tests and verify green**

Run the Task 1 command. Expected: all theme-invariance cases pass.

- [ ] **Step 5: Commit Task 1**

~~~powershell
git add artifacts/vndrly/src/components/app-modal-tokens.ts artifacts/vndrly/src/components/ui/dialog.tsx artifacts/vndrly/src/components/ui/alert-dialog.tsx artifacts/vndrly/src/components/ui/modal-theme-contract.test.tsx
git commit -m "Pin web modals to dark theme"
~~~

### Task 2: Shared Ask V-style header

**Files:**
- Create: artifacts/vndrly/src/components/app-modal-header.tsx
- Create: artifacts/vndrly/src/components/app-modal-header.test.tsx
- Modify: artifacts/vndrly/src/components/ui/dialog.tsx

**Interfaces:**
- Produces: AppModalHeaderProps with title, description, icon, logo, settings, hideClose, and closeControl
- Produces: AppModalHeader(props: AppModalHeaderProps): JSX.Element
- Produces: ModalHeaderHostContext for standard DialogHeader portal rendering
- Consumes: APP_MODAL_HEADER_HEIGHT_PX, APP_MODAL_ALWAYS_DARK, useBrand, DialogClose

- [ ] **Step 1: Write the failing shared-header test**

Assert the header uses the approved dark image, company square logo on the left, title and description beside it, and Settings then Close controls inset on the right.

~~~tsx
render(
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Example modal</DialogTitle>
        <DialogDescription>Example definition</DialogDescription>
      </DialogHeader>
    </DialogContent>
  </Dialog>,
);
expect(screen.getByTestId("app-modal-header")).toBeTruthy();
expect(screen.getByTestId("app-modal-header-logo")).toBeTruthy();
expect(screen.getByTestId("app-modal-header-controls").className).toContain("right-4");
expect(screen.getByText("Example modal").closest("[data-testid=app-modal-header]")).toBeTruthy();
~~~

- [ ] **Step 2: Run the header test and verify red**

Run:

~~~powershell
pnpm --dir C:UsersJohnElerickDEVVNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/app-modal-header.test.tsx
~~~

Expected: AppModalHeader and header host do not exist.

- [ ] **Step 3: Implement AppModalHeader and header hosting**

Build AppModalHeader with the existing dark accent image and Ask V geometry. It must use the shared entity-logo lookup, render a 48-pixel square logo, and own Settings/Close placement. Add a header host inside DialogContent. DialogHeader uses React createPortal when a host is present, so existing standard call sites move into the header without per-page rewrites.

~~~ts
type AppModalHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  logo?: DialogLogoSpec | null;
  settings?: React.ReactNode;
  hideClose?: boolean;
};
~~~

- [ ] **Step 4: Run header and dialog contract tests**

Run both Task 1 and Task 2 test files. Expected: all pass.

- [ ] **Step 5: Commit Task 2**

~~~powershell
git add artifacts/vndrly/src/components/app-modal-header.tsx artifacts/vndrly/src/components/app-modal-header.test.tsx artifacts/vndrly/src/components/ui/dialog.tsx
git commit -m "Add shared Ask V modal header"
~~~

### Task 3: Confirmation dialogs use the shared header

**Files:**
- Modify: artifacts/vndrly/src/components/ui/alert-dialog.tsx
- Modify: artifacts/vndrly/src/components/ui/modal-theme-contract.test.tsx
- Test representative consumers: artifacts/vndrly/src/components/account-actions.tsx, artifacts/vndrly/src/pages/field-employee-detail.tsx, artifacts/vndrly/src/components/partner-vendor-approvals-card.tsx

**Interfaces:**
- Consumes: AppModalHeader and ModalHeaderHostContext from Task 2
- Produces: AlertDialogHeader portal behavior matching DialogHeader

- [ ] **Step 1: Extend the failing contract test**

Render an AlertDialog with title, description, action, and cancel. Assert title and description are inside app-modal-header while action and cancel remain in the light body.

~~~tsx
expect(screen.getByText("Remove access").closest("[data-testid=app-modal-header]")).toBeTruthy();
expect(screen.getByRole("button", { name: "Remove" }).closest("[data-testid=modal-body]")).toBeTruthy();
~~~

- [ ] **Step 2: Run the test and verify red**

Expected: AlertDialogHeader remains inside the body.

- [ ] **Step 3: Add the alert header host**

Use the same header-host interface as DialogContent. Keep AlertDialogAction and AlertDialogCancel unchanged. Do not alter destructive button semantics.

- [ ] **Step 4: Run contract and representative focused tests**

Run modal-theme-contract.test.tsx plus the focused tests for account actions, field employee deletion, and vendor revocation. Expected: all pass.

- [ ] **Step 5: Commit Task 3**

~~~powershell
git add artifacts/vndrly/src/components/ui/alert-dialog.tsx artifacts/vndrly/src/components/ui/modal-theme-contract.test.tsx
git commit -m "Normalize confirmation modal headers"
~~~

### Task 4: Custom and bare dialog migration

**Files:**
- Modify: artifacts/vndrly/src/components/mini-card-dialog-content.tsx
- Modify: artifacts/vndrly/src/components/assistant-panel.tsx
- Modify: artifacts/vndrly/src/components/change-password-modal.tsx
- Modify: artifacts/vndrly/src/components/employee-dialog-content.tsx
- Modify: artifacts/vndrly/src/components/foreman-schedule-pick-dialog.tsx
- Modify: artifacts/vndrly/src/components/notification-send-to-dialog.tsx
- Modify: artifacts/vndrly/src/components/notifications-modal.tsx
- Modify: artifacts/vndrly/src/components/onboarding-account-created-dialog.tsx
- Modify existing focused tests adjacent to each component

**Interfaces:**
- Consumes: AppModalHeader from Task 2
- Produces: no new public interface; bare consumers provide title, description, icon, settings, and hideClose explicitly

- [ ] **Step 1: Add failing tests for every custom family**

For each component family, assert app-modal-header exists once, uses dark chrome in both page themes, and preserves its existing controls. Include forced-password no-outside-close behavior, Ask V panel controls, flyout Settings/Close order, notification actions, and onboarding blocking behavior.

- [ ] **Step 2: Run the custom-dialog focused suite and verify red**

Run the named component tests. Expected: existing parallel headers lack app-modal-header or still branch on page theme.

- [ ] **Step 3: Migrate each bare dialog**

Replace duplicated header images, logo blocks, and control clusters with AppModalHeader. Keep each component's body DOM and callbacks intact. MiniCardDialogContent passes its current icon, label, definition, settings, and company logo into AppModalHeader.

- [ ] **Step 4: Run each focused test after its component migration**

Expected: every custom family passes before moving to the next file.

- [ ] **Step 5: Commit Task 4**

~~~powershell
git add artifacts/vndrly/src/components/mini-card-dialog-content.tsx artifacts/vndrly/src/components/assistant-panel.tsx artifacts/vndrly/src/components/change-password-modal.tsx artifacts/vndrly/src/components/employee-dialog-content.tsx artifacts/vndrly/src/components/foreman-schedule-pick-dialog.tsx artifacts/vndrly/src/components/notification-send-to-dialog.tsx artifacts/vndrly/src/components/notifications-modal.tsx artifacts/vndrly/src/components/onboarding-account-created-dialog.tsx
git commit -m "Normalize custom modal headers"
~~~

### Task 5: Modal sheet and custom dialog-role audit

**Files:**
- Modify: artifacts/vndrly/src/components/ui/sheet.tsx
- Create: artifacts/vndrly/src/components/ui/sheet-modal-theme.test.tsx
- Modify: artifacts/vndrly/src/pages/ticket-detail.tsx
- Audit: artifacts/vndrly/src/components/public-askv.tsx
- Audit: artifacts/vndrly/src/components/plate-state-picker.tsx

**Interfaces:**
- Produces: SheetContentProps.modalChrome?: boolean
- Consumes: APP_MODAL_ALWAYS_DARK and AppModalHeader

- [ ] **Step 1: Write the failing modal-sheet test**

Render one SheetContent without modalChrome and one with modalChrome. Assert the default remains unchanged and modalChrome receives dark shell, shared header, light body, and light native controls.

~~~tsx
expect(screen.getByTestId("navigation-sheet").className).toContain("bg-background");
expect(screen.getByTestId("modal-sheet").className).toContain("bg-[#3a3d42]");
~~~

- [ ] **Step 2: Run the sheet test and verify red**

Expected: modalChrome is not a recognized prop and both sheets use generic styling.

- [ ] **Step 3: Implement modalChrome and migrate Find Vendor**

Add modalChrome?: boolean with false default. When true, render the shared header and light body. Set modalChrome on the Find Vendor sheet in ticket-detail.tsx. Leave the sidebar navigation SheetContent unchanged.

- [ ] **Step 4: Record the two audited non-modal role=dialog exemptions**

PublicAskV is a persistent non-modal helper with aria-modal=false and remains an explicit exemption. PlateStatePicker is an input-owned popover picker, opened by a trigger with `aria-haspopup="dialog"`, and remains an explicit exemption. Record both reasons in modal-inventory.test.ts.

- [ ] **Step 5: Run sheet and focused consumer tests**

Expected: modal sheet passes; navigation remains unchanged; ticket Find Vendor flow and picker behavior pass.

- [ ] **Step 6: Commit Task 5**

~~~powershell
git add artifacts/vndrly/src/components/ui/sheet.tsx artifacts/vndrly/src/components/ui/sheet-modal-theme.test.tsx artifacts/vndrly/src/pages/ticket-detail.tsx artifacts/vndrly/src/components/public-askv.tsx artifacts/vndrly/src/components/plate-state-picker.tsx
git commit -m "Normalize modal sheet chrome"
~~~

### Task 6: Inventory enforcement, full verification, and web-only release

**Files:**
- Create: artifacts/vndrly/src/components/modal-inventory.test.ts
- Modify: only files required by failures found during the complete production inventory

**Interfaces:**
- Produces: explicit MODAL_ROLE_EXEMPTIONS containing only PublicAskV and PlateStatePicker when confirmed non-modal
- Consumes: production TSX source tree

- [ ] **Step 1: Write the failing inventory test**

The test scans non-test TSX files and asserts:

- all modal roots use DialogContent, AlertDialogContent, MiniCardDialogContent, or SheetContent with modalChrome
- useTheme is absent from modal primitive implementations
- production role=dialog occurrences are in the explicit audited exemptions
- generic SheetContent is not treated as a modal unless modalChrome is present

- [ ] **Step 2: Run the inventory test and verify red**

Expected: any remaining bypass or page-theme dependency is listed by file and line.

- [ ] **Step 3: Resolve every inventory failure**

Migrate true modals to the shared primitives. Add an exemption only when the surface is demonstrably non-modal and the test records its reason.

- [ ] **Step 4: Run focused and full web verification**

Run:

~~~powershell
pnpm --dir C:UsersJohnElerickDEVVNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/app-modal-header.test.tsx src/components/ui/modal-theme-contract.test.tsx src/components/ui/sheet-modal-theme.test.tsx src/components/modal-inventory.test.ts
pnpm --dir C:UsersJohnElerickDEVVNDRLY.ai run test:web
pnpm --dir C:UsersJohnElerickDEVVNDRLY.ai --filter @workspace/vndrly run typecheck
$env:BASE_PATH='/'; pnpm --dir C:UsersJohnElerickDEVVNDRLY.ai --filter @workspace/vndrly run build
~~~

Expected: all commands exit zero.

- [ ] **Step 5: Review the complete diff and commit**

Confirm no API, database, mobile, OTA, or TestFlight files changed.

~~~powershell
git diff --check
git status --short
git add artifacts/vndrly/src docs/superpowers/plans/2026-09-17-always-dark-modal-normalization.md
git commit -m "Normalize all web modal headers"
~~~

- [ ] **Step 6: Publish web only**

Fetch remote main, verify the release commit descends from it, push the working branch and main non-force, and monitor .github/workflows/publish.yml only. Do not dispatch API, mobile-ota, or mobile-testflight workflows.

- [ ] **Step 7: Verify live before refresh handoff**

Run scripts/check-live.mjs and manually inspect representative standard, confirmation, custom flyout, blocking account, and Find Vendor sheet categories in both page themes. Tell the user to refresh only after the public bundle and representative modal checks are confirmed.
