import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Edit Profile action heights", () => {
  const source = readFileSync(
    resolve(__dirname, "../../components/EditProfileForm.tsx"),
    "utf8",
  );

  it.each(["button-save-profile", "button-change-password"])(
    "uses the 44-pixel touch target for %s",
    (testId) => {
      const buttonStart = source.lastIndexOf(
        "<ProfileMiniCardButton",
        source.indexOf(`testID=\"${testId}\"`),
      );
      const buttonEnd = source.indexOf("</ProfileMiniCardButton>", buttonStart);
      const buttonSource = source.slice(buttonStart, buttonEnd);

      expect(buttonSource).toContain(testId);
      expect(readFileSync(resolve(__dirname, "../../components/ProfileMiniCardButton.tsx"), "utf8")).toContain("minHeight: 44");
    },
  );
});
