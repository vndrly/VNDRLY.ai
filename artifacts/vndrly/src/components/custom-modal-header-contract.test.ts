import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const customModalFiles = [
  "assistant-panel.tsx",
  "change-password-modal.tsx",
  "employee-dialog-content.tsx",
  "mini-card-dialog-content.tsx",
  "notification-send-to-dialog.tsx",
  "notifications-modal.tsx",
] as const;

function sourceFor(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

describe("custom modal header contract", () => {
  for (const file of customModalFiles) {
    it(`${file} consumes the shared AppModalHeader`, () => {
      const source = sourceFor(file);
      expect(source).toContain('from "@/components/app-modal-header"');
      expect(source).toContain("<AppModalHeader");
    });
  }

  it("foreman-schedule-pick-dialog.tsx uses the standard shared dialog header path", () => {
    const source = sourceFor("foreman-schedule-pick-dialog.tsx");
    expect(source).not.toContain("<DialogContent bare");
    expect(source).toContain("<DialogHeader>");
  });

  for (const file of ["notification-send-to-dialog.tsx", "notifications-modal.tsx"]) {
    it(`${file} no longer varies modal chrome with the page theme`, () => {
      const source = sourceFor(file);
      expect(source).not.toContain('from "@/hooks/use-theme"');
      expect(source).toContain("NOTIFICATIONS_MODAL_DARK");
    });
  }
});
