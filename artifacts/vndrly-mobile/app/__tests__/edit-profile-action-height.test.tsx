import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Edit Profile action heights", () => {
  const source = readFileSync(resolve(__dirname, "../edit-profile.tsx"), "utf8");

  it.each(["button-save-profile", "button-change-password"])(
    "uses the 30-pixel pill standard for %s",
    (testId) => {
      const buttonStart = source.lastIndexOf("<AmberButton", source.indexOf(`testID=\"${testId}\"`));
      const buttonEnd = source.indexOf("</AmberButton>", buttonStart);
      const buttonSource = source.slice(buttonStart, buttonEnd);

      expect(buttonSource).toContain("height={30}");
      expect(buttonSource).not.toContain("height={40}");
    },
  );
});
