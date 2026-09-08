import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("keeps payroll while hiding tax and accounting reports by default", async () => {
  vi.stubEnv("VITE_ENABLE_TAX_REPORTING", "");
  vi.stubEnv("VITE_ENABLE_ACCOUNTING", "");
  const { reportEnabled } = await import("./release-features");
  expect(reportEnabled("/vendor/1/crew-cost")).toBe(true);
  expect(reportEnabled("/vendor/1/payroll")).toBe(true);
  expect(reportEnabled("/partner/2/1099-fire")).toBe(false);
  expect(reportEnabled("/vendor/1/sales-tax")).toBe(false);
  expect(reportEnabled("/vendor/1/revenue")).toBe(false);
});

it("restores tax surfaces independently from other accounting", async () => {
  vi.stubEnv("VITE_ENABLE_TAX_REPORTING", "true");
  vi.stubEnv("VITE_ENABLE_ACCOUNTING", "");
  const { TAX_REPORTING_ENABLED, reportEnabled } = await import("./release-features");
  expect(TAX_REPORTING_ENABLED).toBe(true);
  expect(reportEnabled("/partner/2/1099-fire")).toBe(true);
  expect(reportEnabled("/vendor/1/revenue")).toBe(false);
});
