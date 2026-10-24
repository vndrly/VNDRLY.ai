import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: request }));
import { NoteEditor, noteFilename } from "./note-editor";
import { NoteMessage, noteMessageBody } from "./note-message";
const savedFile = { id: "doc-1", canManage: true, data: { name: "Watch.txt", channelId: "chat-1", state: "active" } };
let rows: typeof savedFile[];
beforeEach(() => {
  rows = [];
  request.mockImplementation(async (path: string) => {
    if (path.startsWith("/file-library?")) return rows;
    if (path === "/file-library/reserve") return { resource: { documentId: "doc-1", fileId: "version-1", uploadURL: "https://mock.invalid/upload" } };
    if (path === "/file-library/finalize") { rows = [savedFile]; return {}; }
    if (path === "/channels/chat-1/messages") return {};
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "Existing watch notes" }));
  vi.spyOn(Blob.prototype, "arrayBuffer").mockResolvedValue(new ArrayBuffer(4));
  vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new ArrayBuffer(32));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); request.mockReset(); });
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><NoteEditor channelId="chat-1" owner={{ type: "vendor", id: 1 }} /></QueryClientProvider>); }
function fill() {
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Watch" } });
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Check the gate" } });
}
it("saves a text file to only this conversation and refreshes Files", async () => {
  show(); fill();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText(/Saved to conversation & Files/);
  const reserve = request.mock.calls.find(c => c[0] === "/file-library/reserve")!;
  expect(JSON.parse(reserve[1].body).payload).toMatchObject({ scope: "channel", channelId: "chat-1", fileName: "Watch.txt", contentType: "text/plain" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(await screen.findByRole("option", { name: "Watch.txt" })).toBeTruthy();
  expect(JSON.parse(request.mock.calls.find(c => c[0] === "/channels/chat-1/messages")![1].body).payload.body).toBe("Saved note: Watch.txt\n/api/work-hub/file-library/doc-1/download");
});
it("opens and edits the same document as a new version, excluding other chats", async () => {
  rows = [savedFile, { ...savedFile, id: "other", data: { ...savedFile.data, name: "Private.txt", channelId: "other-chat" } }];
  show(); await screen.findByRole("option", { name: "Watch.txt" });
  expect(screen.queryByRole("option", { name: "Private.txt" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Open saved note"), { target: { value: "doc-1" } });
  await screen.findByDisplayValue("Existing watch notes");
  fireEvent.change(screen.getByLabelText("Note body"), { target: { value: "Updated watch notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText(/Saved to conversation & Files/);
  expect(JSON.parse(request.mock.calls.find(c => c[0] === "/file-library/reserve")![1].body).payload.documentId).toBe("doc-1");
});
it("reuses the reservation and finalize operation after an uncertain save", async () => {
  const base = request.getMockImplementation()!;
  let attempts = 0;
  request.mockImplementation(async (...args: any[]) => {
    if (args[0] === "/file-library/finalize" && attempts++ === 0) throw new Error("Connection lost");
    return base(...args);
  });
  show(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
  await screen.findByText(/Saved to conversation & Files/);
  expect(request.mock.calls.filter(c => c[0] === "/file-library/reserve")).toHaveLength(1);
  const writes = request.mock.calls.filter(c => c[0] === "/file-library/finalize");
  expect(writes[0][1].body).toBe(writes[1][1].body);
});
it("supports plain-text checklists, undo/redo, and a local download without saving", async () => {
  show(); fill();
  fireEvent.click(screen.getByRole("button", { name: "Checklist" }));
  expect((screen.getByLabelText("Note body") as HTMLTextAreaElement).value).toBe("[ ] Check the gate");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect((screen.getByLabelText("Note body") as HTMLTextAreaElement).value).toBe("Check the gate");
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect((screen.getByLabelText("Note body") as HTMLTextAreaElement).value).toBe("[ ] Check the gate");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Download note (.txt)" }));
  expect(click).toHaveBeenCalledOnce();
  expect(request.mock.calls.every(c => !c[1]?.method)).toBe(true);
  expect(noteFilename('Gate/notes.txt')).toBe('Gate_notes.txt');
});
it("retries only the conversation link after the file has saved", async () => {
  const base = request.getMockImplementation()!;
  let attempts = 0;
  request.mockImplementation(async (...args: any[]) => {
    if (args[0] === "/channels/chat-1/messages" && attempts++ === 0) throw new Error("Connection lost");
    return base(...args);
  });
  show(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText(/File saved; the conversation link was not confirmed/);
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await screen.findByText(/Saved to conversation & Files/);
  expect(fetch).toHaveBeenCalledOnce();
  expect(request.mock.calls.filter(c => c[0] === "/file-library/finalize")).toHaveLength(1);
  const messages = request.mock.calls.filter(c => c[0] === "/channels/chat-1/messages");
  expect(messages).toHaveLength(2);
  expect(messages[0][1].body).toBe(messages[1][1].body);
});
it("renders a note link to the same stored file", () => {
  const id = "12345678-1234-1234-1234-123456789012";
  render(<NoteMessage body={noteMessageBody("Watch.txt", id)} />);
  expect(screen.getByRole("link", { name: "Watch.txt" }).getAttribute("href")).toBe(`/api/work-hub/file-library/${id}/download`);
});
