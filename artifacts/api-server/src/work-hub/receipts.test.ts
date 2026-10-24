import { afterEach, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { readReceipt, receiptFields, receiptInput, receiptImage, receiptCsv, receiptExcel, type ReceiptData } from "./receipts";
const fields = { merchant: "Mock Fuel Stop", date: "2026-10-24", subtotal: "10", tax: "0.83", tip: "0", total: "10.83", currency: "USD", category: "Fuel", siteProject: "Mock gate", note: "Mock receipt" };
const data: ReceiptData = { schemaVersion: 1, channelId: "mock", photoDocumentId: "mock", photoFileId: "mock", fields: receiptFields.parse(fields), version: 1, reviewedBy: 1, reviewedAt: "2026-10-24T12:00:00Z" };
afterEach(() => vi.unstubAllEnvs());
it("requires reviewed fields and valid exact decimal amounts/dates", () => {
  expect(receiptFields.parse(fields).subtotal).toBe("10.00");
  for (const total of ["NaN", "-1", "1.234", "=1+1"]) expect(receiptFields.safeParse({ ...fields, total }).success).toBe(false);
  expect(receiptFields.safeParse({ ...fields, date: "2026-02-30" }).success).toBe(false);
  expect(receiptInput.safeParse({ fields, reviewed: false, photoDocumentId: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
});
it("rejects invalid image signatures and too-large OCR images", () => {
  expect(() => receiptImage(Buffer.alloc(40).toString("base64"), "image/jpeg")).toThrow();
  expect(() => receiptImage("a".repeat(4 * 1024 * 1024 + 1), "image/jpeg")).toThrow();
});
it("extracts only reviewable receipt fields with a mocked OCR provider", async () => {
  vi.stubEnv("OPENAI_API_KEY", "mock-key");
  const image = Buffer.alloc(40); image.set([255, 216, 255]);
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...fields, tax: null, cardNumber: "not-returned" }) } }] }) });
  const result = await readReceipt(image.toString("base64"), "image/jpeg", fetcher);
  expect(result.fields.tax).toBe(""); expect(result.fields.total).toBe("10.83"); expect(result.fields).not.toHaveProperty("cardNumber"); expect(result.needsReview).toBe(true);
});
it("fails safely when OCR is unavailable without fabricating fields", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const image = Buffer.alloc(40); image.set([255, 216, 255]);
  await expect(readReceipt(image.toString("base64"), "image/jpeg", vi.fn())).rejects.toThrow("manually");
});
it("exports escaped CSV without executable formulas", () => {
  const csv = receiptCsv([{ id: "mock", data: { ...data, fields: { ...data.fields, merchant: '=HYPERLINK("evil")', note: "line1\nline2" } } }]);
  expect(csv).toContain('"\'=HYPERLINK(""evil"")"'); expect(csv).toContain('"line1\nline2"'); expect(csv).toContain('"10.83"');
});
it("exports an actual XLSX with numeric money and string-only user text", async () => {
  const zip = await JSZip.loadAsync(await receiptExcel([{ id: "mock", data: { ...data, fields: { ...data.fields, merchant: "=1+1" } } }]));
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  expect(sheet).toContain('<c r="G2"><v>10.83</v></c>'); expect(sheet).toContain('t="inlineStr"'); expect(sheet).toContain("=1+1"); expect(sheet).not.toContain("<f>");
  expect(zip.file("[Content_Types].xml")).toBeTruthy();
});
