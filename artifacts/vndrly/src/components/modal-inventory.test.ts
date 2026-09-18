import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function productionTsxFiles(directory = srcRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (!entry.name.endsWith(".tsx") || /\.(test|spec)\.tsx$/.test(entry.name)) return [];
    return [path];
  });
}

function sourceFor(relativePath: string): string {
  return readFileSync(resolve(srcRoot, relativePath), "utf8");
}

function relativePath(path: string): string {
  return relative(srcRoot, path).replaceAll("\\", "/");
}

describe("production modal inventory", () => {
  it("keeps page theme state out of shared and custom modal chrome", () => {
    const themeIndependentFiles = [
      "components/ui/dialog.tsx",
      "components/ui/alert-dialog.tsx",
      "components/ui/sheet.tsx",
      "components/notification-send-to-dialog.tsx",
      "components/notifications-modal.tsx",
    ];

    for (const file of themeIndependentFiles) {
      expect(sourceFor(file), file).not.toContain('from "@/hooks/use-theme"');
    }
  });

  it("limits hand-authored dialog roles to the two documented non-modal helpers", () => {
    const actual = productionTsxFiles()
      .filter((file) => /role=["']dialog["']/.test(readFileSync(file, "utf8")))
      .map(relativePath)
      .sort();

    expect(actual).toEqual([
      "components/plate-state-picker.tsx",
      "components/public-askv.tsx",
    ]);
    expect(sourceFor("components/public-askv.tsx")).toContain('aria-modal="false"');
    expect(sourceFor("components/plate-state-picker.tsx")).toContain('aria-haspopup="dialog"');
  });

  it("opts the Find Vendor sheet into modal chrome without changing navigation", () => {
    expect(sourceFor("pages/ticket-detail.tsx")).toMatch(/<SheetContent[^>]*\bmodalChrome\b/);
    expect(sourceFor("components/ui/sidebar.tsx")).not.toContain("modalChrome");
  });

  it("requires every bare dialog consumer to render the shared header", () => {
    const bareDialogFiles = productionTsxFiles().filter((file) => {
      const source = readFileSync(file, "utf8");
      return /<DialogContent[\s\S]{0,300}?\bbare\b/.test(source);
    });

    expect(bareDialogFiles.map(relativePath).sort()).toEqual([
      "components/assistant-panel.tsx",
      "components/change-password-modal.tsx",
      "components/employee-dialog-content.tsx",
      "components/mini-card-dialog-content.tsx",
      "components/notification-send-to-dialog.tsx",
      "components/notifications-modal.tsx",
    ]);
    for (const file of bareDialogFiles) {
      expect(readFileSync(file, "utf8"), relativePath(file)).toContain("<AppModalHeader");
    }
  });
});
