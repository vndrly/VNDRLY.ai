import { describe, expect, it } from "vitest";
import { substitute1099Placeholders } from "./sendgrid";

describe("substitute1099Placeholders", () => {
  const vars = {
    vendorName: "Acme Repair",
    partnerName: "Big Box Co",
    taxYear: 2024,
    formType: "NEC" as const,
    totalReportable: "1,234.56",
  };

  it("substitutes all supported placeholders", () => {
    const out = substitute1099Placeholders(
      "Hi {{vendorName}}, your {{formLabel}} ({{formType}}) for {{taxYear}} from {{partnerName}}: ${{totalReportable}}",
      vars,
    );
    expect(out).toBe(
      "Hi Acme Repair, your 1099-NEC (NEC) for 2024 from Big Box Co: $1,234.56",
    );
  });

  it("derives formLabel from formType for MISC and K", () => {
    expect(
      substitute1099Placeholders("{{formLabel}}", { ...vars, formType: "MISC" }),
    ).toBe("1099-MISC");
    expect(
      substitute1099Placeholders("{{formLabel}}", { ...vars, formType: "K" }),
    ).toBe("1099-K");
  });

  it("tolerates whitespace inside braces", () => {
    expect(substitute1099Placeholders("{{ vendorName }}", vars)).toBe(
      "Acme Repair",
    );
  });

  it("leaves unknown placeholders untouched so partners notice typos", () => {
    expect(substitute1099Placeholders("{{vendor}} {{vendorName}}", vars)).toBe(
      "{{vendor}} Acme Repair",
    );
    expect(substitute1099Placeholders("{{unknown}}", vars)).toBe("{{unknown}}");
  });

  it("supports Spanish localization with multiple substitutions", () => {
    const out = substitute1099Placeholders(
      "Hola {{vendorName}}, adjunto Formulario {{formLabel}} del año {{taxYear}} de {{partnerName}}.",
      vars,
    );
    expect(out).toBe(
      "Hola Acme Repair, adjunto Formulario 1099-NEC del año 2024 de Big Box Co.",
    );
  });
});
