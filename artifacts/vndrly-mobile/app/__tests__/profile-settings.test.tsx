import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../lib/locales/en.json";
import es from "../../lib/locales/es.json";

describe("Profile settings", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../(tabs)/profile.tsx"), "utf8");

  it("keeps the identity centered and adds a right-side settings control", () => {
    expect(source).toContain('const [settingsOpen, setSettingsOpen] = useState(false)');
    expect(source).toContain('testID="button-profile-settings"');
    expect(source).toContain('name={settingsOpen ? "x" : "settings"}');
    expect(source).toContain('styles.profileIconActions');
    expect(source).toContain('styles.profileIconButton');
  });

  it("keeps language, location, and audio backup devices inside the settings panel", () => {
    expect(source).toContain('testID="profile-settings-panel"');
    expect(source).toContain('{settingsOpen ? (');
    expect(source).toContain('testID={`button-lang-${lng}`}');
    expect(source).toContain('testID="button-toggle-location-consent"');
    expect(source).toContain('import WorkHubDeviceSettings from "@/components/WorkHubDeviceSettings"');
    const panelSource = source.slice(
      source.indexOf('testID="profile-settings-panel"'),
      source.indexOf('{canManageCompany ? ('),
    );
    expect(panelSource).toContain("<WorkHubDeviceSettings />");
    expect(panelSource.indexOf('testID="button-edit-profile"')).toBeGreaterThan(
      panelSource.indexOf(') : null}'),
    );
    expect(panelSource.indexOf('testID="button-compliance-card"')).toBeGreaterThan(
      panelSource.indexOf(') : null}'),
    );
  });

  it("opens Settings when Work Hub links directly to audio settings", () => {
    expect(source).toContain("useLocalSearchParams");
    expect(source).toContain('openSettings === "audio"');
    expect(source).toContain("setSettingsOpen(true)");
  });

  it("keeps Edit Profile and Compliance Card as regular Profile actions", () => {
    expect(source).toContain('testID="button-edit-profile"');
    expect(source).toContain('testID="button-compliance-card"');
    expect(source).toContain('style={styles.actionBtn}');
    expect(source).toContain('user?.role !== "partner"');
  });

  it("keeps one sign-out control beside Settings", () => {
    expect(source.match(/testID="button-sign-out"/g)).toHaveLength(1);
    expect(source).toContain("styles.profileIconActions");
    expect(source.indexOf('testID="button-profile-settings"')).toBeLessThan(
      source.indexOf('testID="button-sign-out"'),
    );
  });

  it("renders Sign Out and Settings as white icons without visible button chrome", () => {
    const actions = source.slice(
      source.indexOf("<View style={styles.profileIconActions}>"),
      source.indexOf("</View>", source.indexOf('testID="button-sign-out"')) + 7,
    );
    expect(actions.match(/color="#ffffff"/g)).toHaveLength(2);
    expect(actions).not.toContain("backgroundColor:");
    expect(actions).not.toContain("borderColor:");
    const iconStyle = source.slice(
      source.indexOf("profileIconButton:"),
      source.indexOf("avatarWrap:"),
    );
    expect(iconStyle).not.toContain("borderWidth:");
  });

  it("keeps Sign Out and Settings at the same 40-pixel size", () => {
    const iconStyle = source.slice(
      source.indexOf("profileIconButton:"),
      source.indexOf("avatarWrap:"),
    );
    expect(iconStyle).toContain("height: 40");
    expect(iconStyle).toContain("width: 40");
  });

  it("labels the settings affordance in both languages", () => {
    expect(en.profile.settings).toBe("Settings");
    expect(es.profile.settings).toBe("Configuración");
  });

  it("shows company administration actions only to administrative accounts", () => {
    expect(source).toContain('const canManageCompany =');
    expect(source).toContain('user?.role === "admin"');
    expect(source).toContain('["admin", "office"].includes(user.vendorRole ?? "")');
    expect(source.match(/\{canManageCompany \? \(/g)).toHaveLength(2);
    expect(source).not.toContain('const canManageEmployees = user?.role === "vendor"');
  });
});
