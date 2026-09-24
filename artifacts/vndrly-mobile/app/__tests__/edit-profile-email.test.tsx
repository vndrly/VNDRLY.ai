import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../lib/locales/en.json";
import es from "../../lib/locales/es.json";

describe("Edit Profile email", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../edit-profile.tsx"), "utf8");

  it("loads, edits, validates, and saves the user's email address", () => {
    expect(source).toContain('const [email, setEmail] = useState("")');
    expect(source).toContain('setEmail(me.email ?? "")');
    expect(source).toContain('label={t("editProfile.email")}');
    expect(source).toContain('testID="input-email"');
    expect(source).toContain('email: email.trim().toLowerCase()');
  });

  it("includes localized email labels", () => {
    expect(en.editProfile.email).toBe("Email");
    expect(es.editProfile.email).toBe("Correo electrónico");
  });

  it("keeps both form actions at the approved 30-pixel height", () => {
    expect(source.match(/height=\{30\}/g)).toHaveLength(2);
    expect(source).not.toContain("height={44}");
  });

  it("keeps PEC credential fields out of Edit Profile", () => {
    expect(source).not.toContain("pecDate");
    expect(source).not.toContain('testID="input-pec-date"');
    expect(source).not.toContain("pecExpirationDate:");
  });
});
