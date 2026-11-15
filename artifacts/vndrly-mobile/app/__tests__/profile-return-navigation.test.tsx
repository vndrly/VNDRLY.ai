import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readApp = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, `../${file}`), "utf8");

describe("Profile return navigation", () => {
  it.each(["employees.tsx", "services.tsx"])(
    "%s uses the default in-page history handler",
    (file) => {
      expect(readApp(file)).toContain("<InPageHeader");
      expect(readApp(file)).not.toContain("onBack=");
    },
  );

  it("location consent uses history for Back and preserves the completion destination", () => {
    const source = readApp("location-consent.tsx");
    expect(source).toContain("fleetConsentReturnRoute(params.returnTo)");
    expect(source).not.toContain("onBack=");
    expect(source).toContain("router.replace(returnRoute as never)");
  });

  it.each([
    ["edit-profile.tsx", 'testIdPrefix="edit-profile"'],
    ["compliance.tsx", 'testIdPrefix="compliance"'],
  ])("%s uses the shared portal header", (file, expectedPrefix) => {
    const source = readApp(file);
    expect(source).toContain("<PortalPageHeader");
    expect(source).toContain(expectedPrefix);
  });

  it("uses the previous history entry", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/PortalPageHeader.tsx"),
      "utf8",
    );
    expect(source).toContain('if (router.canGoBack()) router.back();');
    expect(source).not.toContain("router.dismissTo");
    expect(source).not.toContain('router.replace("/(tabs)/change-over")');
  });

  it("Edit Profile still returns to Profile after a successful save", () => {
    expect(readApp("edit-profile.tsx")).toContain('router.replace("/profile")');
  });

  it("Profile uses the shared Gate back navigation", () => {
    expect(readApp("(tabs)/profile.tsx")).toMatch(
      /<GatePage\s+title=\{c\("My Profile", "Mi perfil"\)\}\s+back\b/,
    );
    const shared = fs.readFileSync(
      path.resolve(__dirname, "../../components/gate/GateChrome.tsx"),
      "utf8",
    );
    expect(shared).toContain("router.canGoBack()");
    expect(shared).toContain("router.back()");
  });
});
