import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BulkLoginUploadDialog, { parseBulkLoginCsv } from "./bulk-login-upload-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, values?: { defaultValue?: string }) => values?.defaultValue ?? key }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    primary: "#00a9c8",
    accent: "#00a9c8",
    logoUrl: null,
    logoSquareUrl: null,
    name: "MidCon Solutions",
    isOrgBranded: true,
  }),
}));

// Lock in the contract between the CSV the admin uploads and the rows
// we send to POST /api/field-employees/bulk-login. Drift here corrupts
// the per-row error mapping users rely on to fix their CSV.

describe("parseBulkLoginCsv", () => {
  it("parses a basic CSV with all columns", () => {
    const csv = [
      "employeeId,email,password,displayName,language",
      "12,alice@example.com,Password123,Alice,en",
      "34,bob@example.com,Password123,,es",
    ].join("\n");
    const { rows, fileError } = parseBulkLoginCsv(csv);
    expect(fileError).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      employeeId: "12",
      email: "alice@example.com",
      password: "Password123",
      displayName: "Alice",
      language: "en",
      parseError: undefined,
    });
    expect(rows[1].displayName).toBe("");
    expect(rows[1].language).toBe("es");
  });

  it("flags rows missing required fields", () => {
    const csv = "employeeId,email,password\n,foo@example.com,Password123";
    const { rows } = parseBulkLoginCsv(csv);
    expect(rows[0].parseError).toMatch(/required/i);
  });

  it("flags non-numeric employeeId", () => {
    const csv = "employeeId,email,password\nabc,foo@example.com,Password123";
    const { rows } = parseBulkLoginCsv(csv);
    expect(rows[0].parseError).toMatch(/whole number/i);
  });

  it("flags short passwords (<8 chars)", () => {
    const csv = "employeeId,email,password\n1,foo@example.com,short";
    const { rows } = parseBulkLoginCsv(csv);
    expect(rows[0].parseError).toMatch(/8 characters/);
  });

  it("flags unsupported languages", () => {
    const csv = "employeeId,email,password,language\n1,foo@example.com,Password123,fr";
    const { rows } = parseBulkLoginCsv(csv);
    expect(rows[0].parseError).toMatch(/'en' or 'es'/);
  });

  it("rejects files missing required columns", () => {
    const { rows, fileError } = parseBulkLoginCsv("employeeId,email\n1,foo@example.com");
    expect(rows).toHaveLength(0);
    expect(fileError).toMatch(/Missing required column/);
    expect(fileError).toMatch(/password/);
  });

  it("rejects empty files", () => {
    const { fileError } = parseBulkLoginCsv("");
    expect(fileError).toMatch(/empty/i);
  });

  it("strips a UTF-8 BOM before matching headers", () => {
    const csv = `\uFEFFemployeeId,email,password\n1,foo@example.com,Password123`;
    const { rows, fileError } = parseBulkLoginCsv(csv);
    expect(fileError).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0].parseError).toBeUndefined();
  });

  it("normalises header case and accepts 'preferredLanguage' as an alias for 'language'", () => {
    const csv = "Employee_ID,EMAIL,Password,Display Name,preferredLanguage\n1,foo@example.com,Password123,Foo,EN";
    const { rows, fileError } = parseBulkLoginCsv(csv);
    expect(fileError).toBeNull();
    expect(rows[0]).toMatchObject({ employeeId: "1", language: "EN", displayName: "Foo" });
  });

  it("ignores trailing blank rows", () => {
    const csv = "employeeId,email,password\n1,foo@example.com,Password123\n,,\n";
    const { rows } = parseBulkLoginCsv(csv);
    expect(rows).toHaveLength(1);
  });
});
it("uses the green rollover pill for the CSV template download", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BulkLoginUploadDialog visible />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByTestId("button-open-bulk-login-upload"));
  const download = await screen.findByTestId("button-download-bulk-login-template");
  const sources = Array.from(download.querySelectorAll("img"), (image) => image.getAttribute("src") ?? "");
  expect(sources.some((source) => source.includes("pill_green"))).toBe(true);
});
