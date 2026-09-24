import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readApp = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, `../${file}`), "utf8");

describe("Profile return navigation", () => {
  it.each(["employees.tsx", "services.tsx", "location-consent.tsx"])(
    "%s returns to Profile instead of the Dashboard fallback",
    (file) => {
      expect(readApp(file)).toContain('onBack={() => router.replace("/profile")}');
    },
  );

  it.each([
    ["edit-profile.tsx", 'testIdPrefix="edit-profile"'],
    ["compliance.tsx", 'testIdPrefix="compliance"'],
  ])("%s uses the shared portal header", (file, expectedPrefix) => {
    const source = readApp(file);
    expect(source).toContain("<PortalPageHeader");
    expect(source).toContain(expectedPrefix);
  });

  it("dismisses back to the existing Profile route instead of the Dashboard history entry", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/PortalPageHeader.tsx"),
      "utf8",
    );
    expect(source).toContain('fallbackHref = "/profile"');
    expect(source).toContain("router.dismissTo(fallbackHref as never)");
    expect(source).not.toContain('router.replace("/(tabs)/change-over")');
  });

  it("Edit Profile still returns to Profile after a successful save", () => {
    expect(readApp("edit-profile.tsx")).toContain('router.replace("/profile")');
  });

  it("Profile Back follows the real navigation history even when Settings is open", () => {
    const source = readApp("(tabs)/profile.tsx");
    expect(source).toContain("if (router.canGoBack())");
    expect(source).toContain("router.back()");
    expect(source).not.toContain("if (settingsOpen)");
    expect(source).not.toContain('router.replace("/(tabs)/change-over"');
  });
});
