import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWorkspace, CollaborationWorkspace, displayMentionText } from "./collaboration";
const mocks = vi.hoisted(() => ({ request: vi.fn(), save: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, role: "vendor", vendorId: 1, partnerId: null } }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("./navigation", () => ({ useHubPreferences: () => ({ preferences: { favorites: [], drafts: { c1: "Saved draft" } }, save: { mutate: mocks.save } }) }));
vi.mock("@/lib/work-hub-client", async importOriginal => ({ ...await importOriginal<any>(), workHubRequest: mocks.request }));
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollaborationWorkspace chat/></QueryClientProvider>); }
describe("Work Hub conversations", () => {
  beforeEach(() => {
    mocks.request.mockReset(); mocks.save.mockReset();
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init) return { resource: {} };
      if (path === "/chats") return [{ id: "c1", name: "Operations", ownerOrgType: "vendor", ownerOrgId: 1, unreadCount: 2 }, { id: "c2", name: "Dispatch", ownerOrgType: "vendor", ownerOrgId: 1, unreadCount: 0 }];
      if (path === "/channels/c1/messages") return [{ id: "m1", body: "Original message", authorUserId: 7, createdAt: "2026-09-09T12:00:00Z", version: 2 }];
      return [];
    });
  });
  it("loads saved drafts and sends a reply with its thread root", async () => {
    mount();
    expect(await screen.findByDisplayValue("Saved draft")).toBeTruthy();
    fireEvent.click(await screen.findByText("Reply in thread"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Reply content" } });
    fireEvent.click(screen.getByText("Send message"));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/c1/messages", expect.objectContaining({ method: "POST" })));
    const call = mocks.request.mock.calls.find(([path, init]) => path === "/channels/c1/messages" && init?.method === "POST")!;
    expect(JSON.parse(call[1].body).payload).toMatchObject({ body: "Reply content", rootMessageId: "m1", parentMessageId: "m1" });
  });
  it("filters conversations by unread state and persists a favorite", async () => {
    mount();
    await screen.findByText("Dispatch");
    fireEvent.change(screen.getByLabelText("Conversation filter"), { target: { value: "unread" } });
    expect(screen.queryByText("Dispatch")).toBeNull();
    fireEvent.click(screen.getByLabelText("Favorite Operations"));
    expect(mocks.save).toHaveBeenCalledWith({ favorites: ["c1"] });
  });
  it("retries an interrupted send with the original operation ID", async () => {
    const original = mocks.request.getMockImplementation()!;
    const sent: any[] = [];
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/channels/c1/messages" && init?.method === "POST") {
        sent.push(JSON.parse(String(init.body)));
        if (sent.length === 1) throw new Error("Connection interrupted");
      }
      return original(path, init);
    });
    mount();
    await screen.findByDisplayValue("Saved draft");
    fireEvent.click(screen.getByText("Send message"));
    await screen.findByText("Connection interrupted");
    fireEvent.click(screen.getByText("Send message"));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0].operationId).toBe(sent[1].operationId);
  });
  it("renders mention display names without exposing user IDs", () => {
    expect(displayMentionText("Review @[7] and @[99]", [{ userId: 7, displayName: "Casey Example" }])).toBe("Review @Casey Example and @teammate");
  });});

describe("Work Hub recipient announcements", () => {
  it("lets a recipient acknowledge an urgent announcement and refreshes its state", async () => {
    let acknowledged = false;
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/announcements/a1/acknowledge" && init?.method === "POST") { acknowledged = true; return {}; }
      if (path === "/home") return { announcements: [{ announcement: { id: "a1", title: "Safety briefing", body: "Read before arrival", urgency: "urgent", acknowledgementRequired: true }, recipient: { acknowledgedAt: acknowledged ? "2026-09-09T12:00:00Z" : null } }] };
      return [];
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ActivityWorkspace /></QueryClientProvider>);
    expect(await screen.findByText("Safety briefing")).toBeTruthy();
    expect(screen.getByText("Urgent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText("Acknowledged")).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledWith("/announcements/a1/acknowledge", expect.objectContaining({ method: "POST" }));
  });
});
