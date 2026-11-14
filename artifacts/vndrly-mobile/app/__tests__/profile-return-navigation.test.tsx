import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readApp = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, `../${file}`), "utf8");

describe("Profile return navigation", () => {
  it.each(["employees.tsx", "services.tsx"])(
    "%s returns to Profile instead of the Dashboard fallback",
    (file) => {
      expect(readApp(file)).toContain(
        'onBack={() => router.replace("/profile")}',
      );
    },
  );

  it("location consent preserves Profile back navigation unless an exact Fleet run return was validated", () => {
    const source = readApp("location-consent.tsx");
    expect(source).toContain("fleetConsentReturnRoute(params.returnTo)");
    expect(source).toContain(
      'onBack={() => router.replace((fleetReturn ?? "/profile") as never)}',
    );
  });

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

  it("Profile uses the shared Gate back navigation", () => {
    expect(readApp("(tabs)/profile.tsx")).toContain(
      '<GatePage title={c("My Profile", "Mi perfil")} back>',
    );
    const shared = fs.readFileSync(
      path.resolve(__dirname, "../../components/gate/GateChrome.tsx"),
      "utf8",
    );
    expect(shared).toContain("router.canGoBack()");
    expect(shared).toContain("router.back()");
  });
});
