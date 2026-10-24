import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: request }));
import { ConversationTranscript, formatTranscript } from "./conversation-transcript";
afterEach(() => { vi.restoreAllMocks(); request.mockReset(); });
it("formats dates, senders, multiline messages and replies", () => {
  const text = formatTranscript({ title: "Night watch", messages: [{ id: "2", createdAt: "2026-10-24T12:00:00Z", authorName: "Isaac", body: "First line\nSecond line", parentMessageId: "1" }] });
  expect(text).toContain("Night watch\r\n1 messages · Times in UTC");
  expect(text).toContain("[2026-10-24T12:00:00.000Z] Isaac (reply to 1)");
  expect(text).toContain("First line\nSecond line");
});
it("downloads a text file using only a transcript read", async () => {
  request.mockResolvedValue({ title: "Mock chat", messages: [] });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ConversationTranscript channelId="mock-channel" />);
  fireEvent.click(screen.getByRole("button", { name: "Download transcript (.txt)" }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledExactlyOnceWith("/channels/mock-channel/transcript");
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
});
