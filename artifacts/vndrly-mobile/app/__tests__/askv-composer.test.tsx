import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../lib/locales/en.json";
import es from "../../lib/locales/es.json";

describe("Ask V composer", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../(tabs)/askv.tsx"), "utf8");

  it("uses the approved invitation in both languages", () => {
    expect(en.askv.inputPlaceholder).toBe("What can Ask V do for you?");
    expect(es.askv.inputPlaceholder).toBe("¿Qué puede hacer Ask V por ti?");
  });

  it("uses the branded paper-plane send control", () => {
    expect(source).toContain('<LayeredPillButton\n            color={brand.primary}');
    expect(source).toContain('<Feather name="send" size={18} color="#ffffff" />');
    expect(source).not.toContain('<Feather name="message-circle" size={18} color="#ffffff" />');
  });
});
