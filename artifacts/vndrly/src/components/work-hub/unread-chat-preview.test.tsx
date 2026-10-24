vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, activeMembershipId: 1 } }) }));
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import UnreadChatPreview from "./unread-chat-preview";
import CalendarSummaryCards from "./calendar-summary-cards";
import { workHubRequest } from "@/lib/work-hub-client";

vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: vi.fn() }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#c9a84c" }) }));
const request = vi.mocked(workHubRequest);
let messages: { id: string; body: string; authorName: string; createdAt: string }[];
beforeEach(() => {
  request.mockReset();
  messages = Array.from({ length: 12 }, (_, i) => ({ id: String(i), body: `Unread ${i}`, authorName: "Mock gatekeeper", createdAt: "2026-10-24T12:00:00Z" }));
  request.mockImplementation(async (path, init) => {
    if (path === "/channels") return [
      { id: "crew", name: "Gate crew", unreadCount: messages.length },
      { id: "office", name: "Office", unreadCount: 3 },
    ];
    if (init?.method === "PUT") {
      messages = messages.filter(message => !path.endsWith(`/messages/${message.id}/read`));
      return { read: true };
    }
    const page = Math.max(0, Math.min(Number(path.split("page=")[1]), Math.ceil(messages.length / 10) - 1));
    return { messages: messages.slice(page * 10, page * 10 + 10), page, total: messages.length, hasNext: (page + 1) * 10 < messages.length };
  });
});
function SummaryHarness() {
  const channels = useQuery<{ id: string; name: string; unreadCount: number }[]>({
    queryKey: ["work-hub", "channels", 7, 1],
    queryFn: () => workHubRequest("/channels"),
  });
  return <CalendarSummaryCards channels={channels.data ?? []} />;
}
it("removes a read message and updates both the chat counter and overall unread total", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SummaryHarness /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Unread conversations\s*15/ }));
  fireEvent.click(screen.getByRole("button", { name: /Gate crew\s*12 unread messages/ }));
  await screen.findByText("Unread 0");
  fireEvent.click(within(screen.getAllByTestId("unread-message")[0]).getByRole("button", { name: "MARK AS READ" }));
  await waitFor(() => {
    expect(screen.queryByText("Unread 0")).toBeNull();
    expect(screen.getByRole("button", { name: /Gate crew\s*11 unread messages/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unread conversations\s*14/ })).toBeTruthy();
  });
  expect(screen.getByRole("button", { name: /Office\s*3 unread messages/ })).toBeTruthy();
  expect(screen.getAllByTestId("unread-message")).toHaveLength(10);
  expect(request.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><UnreadChatPreview channel={{ id: "crew", name: "Gate crew", unreadCount: 12 }} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Gate crew/ }));
}
it("pages ten unread messages without writes and links to the selected chat", async () => {
  mount();
  await waitFor(() => expect(screen.getAllByTestId("unread-message")).toHaveLength(10));
  expect(screen.getByRole("link", { name: "View chat" }).getAttribute("href")).toBe("/work-hub/chat?channel=crew");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(screen.getAllByTestId("unread-message")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(screen.getAllByTestId("unread-message")).toHaveLength(10));
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it("opens the selected Work Hub chat through client-side navigation without a document reload", async () => {
  const previousUrl = window.location.pathname + window.location.search;
  mount();
  await screen.findByText("Unread 0");
  const defaultAllowed = fireEvent.click(screen.getByRole("link", { name: "View chat" }), { button: 0 });
  expect(defaultAllowed).toBe(false);
  expect(window.location.pathname).toBe("/work-hub/chat");
  expect(new URLSearchParams(window.location.search).get("channel")).toBe("crew");
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  window.history.replaceState(null, "", previousUrl);
});
it("marks only the explicitly chosen message and refreshes the count", async () => {
  mount();
  await screen.findByText("Unread 0");
  fireEvent.click(within(screen.getAllByTestId("unread-message")[0]).getByRole("button", { name: "MARK AS READ" }));
  await waitFor(() => expect(screen.queryByText("Unread 0")).toBeNull());
  expect(request.mock.calls.filter(([, init]) => init?.method === "PUT")).toEqual([["/channels/crew/messages/0/read", { method: "PUT", body: "{}" }]]);
  expect(messages).toHaveLength(11);
  expect(screen.getByRole("button", { name: /Gate crew/ }).textContent).toContain("11");
});
it("keeps unread messages when marking fails", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, init) => init?.method ? Promise.reject(new Error("Mock failure")) : original(path, init));
  mount();
  await screen.findByText("Unread 0");
  fireEvent.click(screen.getAllByRole("button", { name: "MARK AS READ" })[0]);
  expect((await screen.findByRole("alert")).textContent).toContain("Could not mark");
  expect(messages).toHaveLength(12);
  expect(screen.getByText("Unread 0")).toBeTruthy();
});
