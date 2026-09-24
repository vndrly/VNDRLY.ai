import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../lib/locales/en.json";
import es from "../../lib/locales/es.json";

describe("Compliance Card identity guard", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../compliance.tsx"), "utf8");

  it("creates or links a compliance profile before requesting a token", () => {
    expect(source).toContain("if (meRes.employeeId == null)");
    expect(source).toContain('apiFetch<{ employeeId: number }>("/api/field/me/compliance-profile"');
    expect(source).toContain('meRes = await apiFetch<FieldMeResponse>("/api/field/me")');
    expect(source).toContain('if (meRes.employeeId == null) throw new Error(t("compliance.unavailable"))');
    expect(source.indexOf("if (meRes.employeeId == null)")).toBeLessThan(
      source.indexOf("/compliance-token"),
    );
  });

  it("provides a useful fallback in both languages", () => {
    expect(en.compliance.unavailable).toBeTruthy();
    expect(es.compliance.unavailable).toBeTruthy();
  });

  it("keeps PEC credential entry on the Compliance Card", () => {
    expect(source).toContain(
      '<EmployeeCertificationsPanel employeeId={me.employeeId} defaultCertificationName="PEC" />',
    );
    const panelSource = fs.readFileSync(
      path.resolve(__dirname, "../../components/EmployeeCertificationsPanel.tsx"),
      "utf8",
    );
    expect(panelSource).toContain("form.certNumber");
    expect(panelSource).toContain("form.expirationDate");
    expect(panelSource).toContain('testID="button-cert-photo"');
  });
});
