import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: request }));
vi.mock("./conversation-attachments", () => ({ ConversationAttachments: ({ onSelect }: { onSelect: (f: File) => void }) => <button onClick={() => onSelect(new File(["mock image"], "mock-receipt.jpg", { type: "image/jpeg" }))}>Mock photo</button> }));
import { ReceiptEditor } from "./receipt-editor";
const fields = { merchant: "Mock Fuel", date: "2026-10-24", subtotal: "10.00", tax: "1.00", tip: "0.00", total: "11.00", currency: "USD", category: "", siteProject: "", note: "" };
const saved = { id: "receipt-1", canEdit: true, data: { fields, photoDocumentId: "doc-1", photoFileId: "file-1", version: 1 } };
beforeEach(() => {
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/ocr")) return { fields, needsReview: true };
    if (path === "/file-library/reserve") return { resource: { documentId: "doc-1", fileId: "file-1", uploadURL: "https://mock.invalid/upload" } };
    if (path === "/file-library/finalize") return {};
    if (init?.method) return { resource: saved };
    if (path.endsWith("/receipt-1")) return saved;
    return { rows: [], hasMore: false };
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn() } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,bW9jaw==");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(Blob.prototype, "arrayBuffer").mockResolvedValue(new ArrayBuffer(4)); vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new ArrayBuffer(32));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); request.mockReset(); });
function show(initialReceiptId?: string) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReceiptEditor channelId="chat-1" owner={{ type: "vendor", id: 1 }} initialReceiptId={initialReceiptId} /></QueryClientProvider>); }
it("reads a mock photo, requires review, and saves the photo and edited fields only after Save", async () => {
  show(); fireEvent.click(screen.getByRole("button", { name: "Mock photo" }));
  await screen.findByDisplayValue("Mock Fuel");
  expect(request.mock.calls.filter(c => c[0] === "/file-library/reserve")).toHaveLength(0);
  expect((screen.getByRole("button", { name: "Save receipt" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "Reviewed Fuel" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save receipt" }));
  await screen.findByText("Receipt saved. Its link is in the conversation.");
  const call = request.mock.calls.find(c => c[0] === "/channels/chat-1/receipts" && c[1]?.method === "POST")!;
  expect(JSON.parse(call[1].body).payload).toMatchObject({ fields: { merchant: "Reviewed Fuel" }, reviewed: true, photoDocumentId: "doc-1" });
});
it("allows manual entry after OCR fails without inventing receipt amounts", async () => {
  const base = request.getMockImplementation()!;
  request.mockImplementation(async (...args: any[]) => { if (args[0].endsWith("/ocr")) throw new Error("OCR unavailable. Enter manually."); return base(...args); });
  show(); fireEvent.click(screen.getByRole("button", { name: "Mock photo" }));
  await screen.findByText("OCR unavailable. Enter manually.");
  expect((screen.getByLabelText("Total") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Merchant") as HTMLInputElement).disabled).toBe(false);
});
it("opens the receipt link, exports by receipt ID, and edits with version checking", async () => {
  show("receipt-1"); await waitFor(() => expect((screen.getByLabelText("Merchant") as HTMLInputElement).value).toBe("Mock Fuel"));
  expect(screen.getByRole("link", { name: "EXCEL", exact: true }).getAttribute("href")).toBe("/api/work-hub/channels/chat-1/receipts/export?format=xlsx&id=receipt-1");
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Fuel" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save receipt" }));
  await screen.findByText("Receipt saved. Its link is in the conversation.");
  const call = request.mock.calls.find(c => c[1]?.method === "PATCH")!;
  expect(JSON.parse(call[1].body).expectedVersion).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("retries an uncertain receipt save without uploading another photo", async () => {
  const base = request.getMockImplementation()!; let count = 0;
  request.mockImplementation(async (...args: any[]) => { if (args[0] === "/channels/chat-1/receipts" && args[1]?.method === "POST" && count++ === 0) throw new Error("Connection lost"); return base(...args); });
  show(); fireEvent.click(screen.getByRole("button", { name: "Mock photo" })); await screen.findByDisplayValue("Mock Fuel");
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save receipt" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
  await screen.findByText("Receipt saved. Its link is in the conversation.");
  expect(fetch).toHaveBeenCalledOnce();
  const saves = request.mock.calls.filter(c => c[0] === "/channels/chat-1/receipts" && c[1]?.method === "POST");
  expect(saves[0][1].body).toBe(saves[1][1].body);
});
