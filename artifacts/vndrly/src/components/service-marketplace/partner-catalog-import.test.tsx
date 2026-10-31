import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerCatalogImport from "./PartnerCatalogImport";
import i18n from "@/lib/i18n";
const calls: any[] = [];
beforeEach(async () => {
  calls.length = 0; await i18n.changeLanguage("en");
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (!options?.body) return Response.json({ items: [] });
    const body = JSON.parse(options.body); calls.push(body);
    return Response.json({ sourceHash: "hash", fileName: body.fileName, rows: [{ row: 2, code: "G1", name: "Gatekeeping", unit: "per_day", outcome: body.mode === "preview" ? "new" : "created", workTypeId: body.mode === "import" ? 101 : undefined }], created: body.mode === "import" ? 1 : 0, duplicates: 0, conflicts: 0, ...(body.mode === "import" ? { importId: 901 } : {}) });
  }));
});
afterEach(() => vi.unstubAllGlobals());
it("previews original bytes before creating services and offers the preserved source afterward", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PartnerCatalogImport partnerId={9} /></QueryClientProvider>);
  const source = "code,name,unit\r\nG1,Gatekeeping,per_day\r\n";
  const file = new File([source], "original.csv", { type: "text/csv" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode(source).buffer });
  fireEvent.change(screen.getByLabelText("Original CSV file"), { target: { files: [file] } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Preview import" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
  await screen.findByText("Gatekeeping");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ fileName: "original.csv", sourceBase64: btoa(source), mode: "preview" });
  fireEvent.click(screen.getByRole("button", { name: "Preserve original and import new services" }));
  const download = await screen.findByRole("link", { name: "Download preserved original CSV" });
  expect(calls[1]).toMatchObject({ mode: "import", sourceBase64: calls[0].sourceBase64 });
  expect(download.getAttribute("href")).toBe("/api/partners/9/catalog-imports/901/source");
  client.clear();
});
