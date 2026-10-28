import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWorkspace, CollaborationWorkspace, displayMentionText, conversationCategory } from "./collaboration";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  save: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  user: { userId: 7, role: "vendor", vendorId: 1, partnerId: null, membershipRole: "admin" } as Record<string, any>,
  preferences: { favorites: [] as string[], drafts: { c1: "Saved draft" } as Record<string, string>, lastConversationId: "c1" as string | null },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ name: "MidCon Solutions", primary: "#00a6b2", accent: "#f2b134" }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("./navigation", () => ({ useHubPreferences: () => ({ preferences: mocks.preferences, save: { mutate: mocks.save, error: null } }) }));
vi.mock("@/lib/work-hub-client", async importOriginal => ({ ...await importOriginal<any>(), workHubRequest: mocks.request }));
vi.mock("@/lib/notifications-api", async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    notificationsApi: {
      ...actual.notificationsApi,
      list: mocks.listNotifications,
      markRead: mocks.markNotificationRead,
    },
  };
});
function mount(chat = true) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollaborationWorkspace chat={chat}/></QueryClientProvider>); }
describe("Work Hub conversations", () => {
  it("groups site channels, crew conversations, and chats without duplicate entries", () => {
    expect(conversationCategory({ contextKind: "gate" })).toBe("Channels");
    expect(conversationCategory({ contextKind: "crew" })).toBe("Channels");
    expect(conversationCategory({ contextKind: "chat", contextId: "group:crew" })).toBe("Channels");
    expect(conversationCategory({ contextKind: "chat", contextId: "7:8" })).toBe("Chats");
  });
  it("lets ordinary users start chats while hiding channel creation", async () => {
    mocks.user.membershipRole = "member";
    mount(); await screen.findByText("Original message");
    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    const channel = screen.getByRole("tab", { name: "Channel" });
    expect(channel.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByLabelText("Find chat participants")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Poll" }).hasAttribute("disabled")).toBe(false);
  });
  beforeEach(() => {
    window.history.replaceState(null, "", "/work-hub/chat");
    mocks.request.mockReset(); mocks.save.mockReset();
    mocks.listNotifications.mockReset(); mocks.markNotificationRead.mockReset();
    mocks.user = { userId: 7, role: "vendor", vendorId: 1, partnerId: null, membershipRole: "admin" };
    mocks.preferences = { favorites: [], drafts: { c1: "Saved draft" }, lastConversationId: "c1" };
    mocks.listNotifications.mockResolvedValue([]);
    mocks.markNotificationRead.mockResolvedValue(undefined);
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init) return { resource: {} };
      if (path === "/channels?limit=100") return [{ id: "c1", name: "Operations", ownerOrgType: "vendor", ownerOrgId: 1, unreadCount: 2 }, { id: "c2", name: "Dispatch", ownerOrgType: "vendor", ownerOrgId: 1, unreadCount: 0 }];
      if (path === "/channels/c1/messages") return [{ id: "m1", body: "Original message", authorUserId: 7, createdAt: "2026-09-09T12:00:00Z", version: 2 }];
      if (path === "/form-campaigns") return { campaigns: [] };
      if (path === "/form-campaigns/options") return { people: [] };
      return [];
    });
  });
  it("opens a linked gate channel even when it is absent from the chat-only list", async () => {
    window.history.replaceState(null, "", "/work-hub/chat?channel=gate");
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init) return {};
      if (path === "/channels?limit=100") return [{ id: "gate", name: "GasGo Gate", ownerOrgType: "vendor", ownerOrgId: 1 }];
      if (path === "/channels/gate/messages") return [{ id: "gate-message", body: "Mock gate conversation", authorUserId: 8, createdAt: "2026-10-24T12:00:00Z" }];
      return [];
    });
    mount();
    expect(await screen.findByRole("heading", { name: "GasGo Gate" })).toBeTruthy();
    expect(await screen.findByText("Mock gate conversation")).toBeTruthy();
    window.history.replaceState(null, "", "/work-hub/chat");
  });
  it("loads saved drafts and sends a reply with its thread root", async () => {
    mount();
    expect(await screen.findByDisplayValue("Saved draft")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByLabelText("Find chat participants")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start Chat" }).className).toContain("w-fit");
    fireEvent.click(await screen.findByRole("button", { name: "Reply in thread" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Reply content" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/c1/messages", expect.objectContaining({ method: "POST" })));
    const call = mocks.request.mock.calls.find(([path, init]) => path === "/channels/c1/messages" && init?.method === "POST")!;
    expect(JSON.parse(call[1].body).payload).toMatchObject({ body: "Reply content", rootMessageId: "m1", parentMessageId: "m1" });
  });
  it("moves the full horizontal tool row into a left-card drawer controlled by the round button", async () => {
    mount();
    await screen.findByText("Original message");
    const panel = screen.getByRole("complementary", { name: "Conversations panel" });
    const selectedChannel = screen.getByRole("region", { name: "Selected channel" });
    const drawer = screen.getByRole("toolbar", { name: "Conversation controls drawer" });
    const masterSelector = screen.getByRole("button", { name: "Collapse conversation controls" });
    const selectorRow = masterSelector.parentElement!;
    expect(masterSelector.querySelector(".lucide-layers-3")).toBeTruthy();
    expect(window.getComputedStyle(panel).paddingTop).toBe("8px");
    expect(window.getComputedStyle(panel).paddingLeft).toBe("8px");
    expect(window.getComputedStyle(selectorRow).position).toBe("absolute");
    expect(window.getComputedStyle(selectorRow).top).toBe("8px");
    expect(window.getComputedStyle(selectorRow).left).toBe("8px");
    expect(drawer.getAttribute("aria-orientation")).toBe("horizontal");
    expect(panel.contains(drawer)).toBe(true);
    expect(selectedChannel.contains(drawer)).toBe(false);
    [
      "Choose a conversation",
      "Create new",
      "People and groups",
      "Delete channel",
      "Download transcript (.txt)",
      "History",
      "Files",
      "Notes",
      "Receipts",
    ].forEach((name) => expect(drawer.contains(screen.getByLabelText(name))).toBe(true));
    expect(drawer.contains(screen.getByRole("separator", { name: "Conversation control groups" }))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Collapse conversation controls" }));
    expect(screen.queryByRole("toolbar", { name: "Conversation controls drawer" })).toBeNull();
    expect(screen.getByRole("region", { name: "Selected channel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand conversation controls" }));
    expect(screen.getByRole("toolbar", { name: "Conversation controls drawer" })).toBeTruthy();
  });
  it("keeps only one selector or conversation tool open at a time", async () => {
    mount();
    await screen.findByText("Original message");

    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    expect(screen.getByRole("region", { name: "Create a channel, chat, or poll" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Choose a conversation" }));
    expect(screen.queryByRole("region", { name: "Create a channel, chat, or poll" })).toBeNull();
    expect(screen.getByRole("region", { name: "Conversation chooser" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.queryByRole("region", { name: "Conversation chooser" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Original message")).toBeTruthy();
  });
  it("cancels the active tool when the master selector retracts and reopens at the chooser", async () => {
    mount();
    await screen.findByText("Original message");

    fireEvent.click(screen.getByRole("tab", { name: "Receipts" }));
    expect(screen.getByRole("region", { name: "Receipt editor" })).toBeTruthy();
    expect(screen.queryByText("Original message")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse conversation controls" }));
    expect(screen.queryByRole("toolbar", { name: "Conversation controls drawer" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Receipt editor" })).toBeNull();
    expect(screen.getByText("Original message")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Expand conversation controls" }));
    expect(screen.getByRole("toolbar", { name: "Conversation controls drawer" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Conversation chooser" })).toBeTruthy();
  });
  it("opens the chooser with Polls, Channels, Chats, then collapsed Notifications and remembers a selection", async () => {
    mocks.preferences.lastConversationId = null;
    mount();
    const chooser = await screen.findByRole("region", { name: "Conversation chooser" });
    expect(chooser.className).toContain("hub-conversation-chooser-card");
    expect(chooser.querySelector(".hub-conversation-chooser-scroll")).toBeTruthy();
    expect(chooser.contains(screen.getByLabelText("Find conversations"))).toBe(true);
    expect(screen.queryByRole("option", { name: "All" })).toBeNull();
    const polls = screen.getByText("Polls");
    const channels = screen.getByText("Channels");
    const chats = screen.getByText("Chats");
    expect(polls.compareDocumentPosition(channels) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(channels.compareDocumentPosition(chats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const notifications = screen.getByRole("group", { name: "Notifications" });
    expect(chats.compareDocumentPosition(notifications) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notifications.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Operations"));
    expect(await screen.findByText("Original message")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Conversation chooser" })).toBeNull();
    expect(mocks.save).toHaveBeenCalledWith({ lastConversationId: "c1" });
  });
  it("shows collapsible notification categories with unread counters and two-line rows", async () => {
    mocks.listNotifications.mockResolvedValue([
      { id: 7, userId: 7, type: "ticket_assigned", category: "tickets", dedupeKey: null, title: "Assigned inspection", body: "Inspect Pump 14 before noon.", link: "/tickets/14", isRead: false, createdAt: "2026-10-27T05:00:00.000Z" },
      { id: 8, userId: 7, type: "safety_event_update", category: "safety", dedupeKey: null, title: "Safety review updated", body: "Supervisor notes are available.", link: "/safety/events/8", isRead: true, createdAt: "2026-10-27T04:00:00.000Z" },
    ]);
    mount();
    await screen.findByText("Original message");
    fireEvent.click(screen.getByRole("button", { name: "Choose a conversation" }));

    const tree = await screen.findByRole("group", { name: "Notifications" });
    fireEvent.click(tree.querySelector("summary")!);
    expect(tree.querySelector("details[aria-label='Tickets notifications']")).toBeTruthy();
    expect(tree.querySelector("details[aria-label='Safety Incidents notifications']")).toBeTruthy();
    expect(screen.getByLabelText("1 unread Tickets notification")).toBeTruthy();
    expect(screen.getByLabelText("0 unread Safety Incidents notifications")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assigned inspection: Inspect Pump 14 before noon." })).toBeTruthy();
  });
  it("opens a notification above its tree and closes that layer with X or Mark read", async () => {
    mocks.listNotifications.mockResolvedValue([
      { id: 7, userId: 7, type: "ticket_assigned", category: "tickets", dedupeKey: null, title: "Assigned inspection", body: "Inspect Pump 14 before noon.", link: "/tickets/14", isRead: false, createdAt: "2026-10-27T05:00:00.000Z" },
    ]);
    mount();
    await screen.findByText("Original message");
    fireEvent.click(screen.getByRole("button", { name: "Choose a conversation" }));
    const tree = await screen.findByRole("group", { name: "Notifications" });
    fireEvent.click(tree.querySelector("summary")!);
    const row = screen.getByRole("button", { name: "Assigned inspection: Inspect Pump 14 before noon." });

    fireEvent.click(row);
    const detail = screen.getByRole("dialog", { name: "Assigned inspection" });
    expect(screen.getByRole("region", { name: "Conversation chooser" }).contains(detail)).toBe(true);
    expect(tree.isConnected).toBe(true);
    expect(detail.textContent).toContain("Inspect Pump 14 before noon.");
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(screen.queryByRole("dialog", { name: "Assigned inspection" })).toBeNull();
    expect(tree.isConnected).toBe(true);

    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assigned inspection" })).toBeNull());
    expect(screen.getByRole("group", { name: "Notifications" })).toBeTruthy();
  });
  it("restores the remembered conversation and lets Menu reopen the chooser", async () => {
    mocks.preferences.lastConversationId = "c2";
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path, init) => path === "/channels/c2/messages" && !init
      ? Promise.resolve([{ id: "m2", body: "Remembered dispatch", authorUserId: 8, createdAt: "2026-09-09T13:00:00Z", version: 1 }])
      : original(path, init));
    mount();
    expect(await screen.findByText("Remembered dispatch")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Conversation chooser" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose a conversation" }));
    expect(screen.getByRole("region", { name: "Conversation chooser" })).toBeTruthy();
  });
  it("closes Create New and reclaims its space after a channel is created", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path, init) => {
      if (path === "/channels" && init?.method === "POST") return { resource: { id: "c3" } };
      return original(path, init);
    });
    mount();
    await screen.findByText("Original message");
    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    fireEvent.click(screen.getByRole("tab", { name: "Channel" }));
    fireEvent.change(screen.getByLabelText("New channel name"), { target: { value: "Safety" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Channel" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Create a channel, chat, or poll" })).toBeNull());
    expect(mocks.save).toHaveBeenCalledWith({ lastConversationId: "c3" });
  });
  it("starts a poll with its question, choices, expiry, and selected notification audience", async () => {
    const campaignId = "11111111-1111-4111-8111-111111111111";
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/form-campaigns/options" && !init) {
        return { people: [{ userId: 8, name: "Casey Example", role: "member" }] };
      }
      if (path === "/form-campaigns" && !init) return { campaigns: [] };
      if (path === "/form-campaigns" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return { operationId: body.operationId, appliedAt: "2026-10-25T12:00:00.000Z", replayed: false, resource: { campaignId, state: { status: "draft", version: 0 } } };
      }
      if (path === `/form-campaigns/${campaignId}/publish` && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return { operationId: body.operationId, appliedAt: "2026-10-25T12:00:01.000Z", replayed: false, resource: { campaignId, state: { status: "published", version: 1 } } };
      }
      return original(path, init);
    });
    mount();
    await screen.findByText("Original message");
    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    fireEvent.click(screen.getByRole("tab", { name: "Poll" }));
    fireEvent.change(await screen.findByLabelText("Poll title"), { target: { value: "Crew lunch" } });
    fireEvent.change(screen.getByLabelText("Poll description"), { target: { value: "Choose today" } });
    fireEvent.change(screen.getByLabelText("Poll question"), { target: { value: "Where should we eat?" } });
    fireEvent.change(screen.getByLabelText("Poll possible answers"), { target: { value: "Diner\nTacos\nBBQ" } });
    fireEvent.change(screen.getByLabelText("Poll expiration"), { target: { value: "72" } });
    fireEvent.change(screen.getByLabelText("Who should be notified"), { target: { value: "selected" } });
    const audience = await screen.findByLabelText("Select people to notify");
    fireEvent.click(audience.querySelector("input")!);
    const start = screen.getByRole("button", { name: "Start Poll" });
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(`/form-campaigns/${campaignId}/publish`, expect.objectContaining({ method: "POST" })));
    const create = mocks.request.mock.calls.find(([path, init]) => path === "/form-campaigns" && init?.method === "POST")!;
    const createBody = JSON.parse(create[1].body);
    expect(createBody.payload).toMatchObject({
      title: "Crew lunch",
      description: "Choose today",
      question: "Where should we eat?",
      durationHours: 72,
      audience: { mode: "selected", userIds: [8] },
      choices: [{ label: "Diner" }, { label: "Tacos" }, { label: "BBQ" }],
    });
  });
  it("filters conversations with Search and persists a favorite", async () => {
    mount();
    await screen.findByText("Original message");
    fireEvent.click(screen.getByRole("button", { name: "Choose a conversation" }));
    await screen.findByText("Dispatch");
    fireEvent.change(screen.getByLabelText("Find conversations"), { target: { value: "Operations" } });
    expect(screen.queryByText("Dispatch")).toBeNull();
    fireEvent.click(screen.getByLabelText("Favorite Operations"));
    expect(mocks.save).toHaveBeenCalledWith({ favorites: ["c1"] });
  });
  it("requires confirmation before deleting the selected channel", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount();
    await screen.findByText("Original message");
    const remove = screen.getByRole("button", { name: "Delete channel" });
    expect(screen.getByRole("complementary", { name: "Conversations panel" }).contains(remove)).toBe(true);
    expect(screen.getByRole("region", { name: "Selected channel" }).contains(remove)).toBe(false);
    fireEvent.click(remove);
    expect(mocks.request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    confirm.mockReturnValue(true);
    fireEvent.click(remove);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/c1", expect.objectContaining({ method: "DELETE" })));
    confirm.mockRestore();
  });
  it("lets admins delete but not edit another person's message", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path, init) => path === "/channels/c1/messages" && !init
      ? Promise.resolve([{ id: "other", body: "Other person's message", authorUserId: 9, version: 1 }])
      : original(path, init));
    mount();
    await screen.findByText("Other person's message");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/c1/messages/other", expect.objectContaining({ method: "DELETE" })));
    expect(screen.getByRole("button", { name: "Reply in thread" })).toBeTruthy();
  });
  it("does not expose edit or delete on another person's message to a regular user", async () => {
    mocks.user.membershipRole = "member";
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((path, init) => path === "/channels/c1/messages" && !init
      ? Promise.resolve([{ id: "other", body: "Other person's message", authorUserId: 9, version: 1 }])
      : original(path, init));
    mount();
    await screen.findByText("Other person's message");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
  it("edits and deletes only the selected message using its current version", async () => {
    mount();
    await screen.findByText("Original message");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Edited mock message" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/c1/messages/m1", expect.objectContaining({ method: "PATCH" })));
    const edit = mocks.request.mock.calls.find(([path, init]) => path === "/channels/c1/messages/m1" && init?.method === "PATCH")!;
    expect(JSON.parse(edit[1].body)).toMatchObject({ expectedVersion: 2, payload: { body: "Edited mock message" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/c1/messages/m1", expect.objectContaining({ method: "DELETE" })));
  });
  it("nests the conversation workspace as the bottom layer of the conversations card", async () => {
    mount();
    await screen.findByText("Original message");

    const panel = screen.getByRole("complementary", { name: "Conversations panel" });
    const workspace = screen.getByRole("main", { name: "Selected conversation workspace" });
    const header = screen.getByRole("region", { name: "Selected channel" });
    const content = screen.getByRole("region", { name: "Channel content" });
    const composer = screen.getByRole("form", { name: "Message composer" });

    expect(panel.contains(workspace)).toBe(true);
    expect(workspace.parentElement).toBe(panel);
    expect(panel.lastElementChild).toBe(workspace);
    expect(workspace.contains(header)).toBe(true);
    expect(workspace.contains(content)).toBe(true);
    expect(workspace.contains(composer)).toBe(true);
    expect([header, content, composer].every((card) => card.className.includes("w-full"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Choose a conversation" }));
    const chooser = screen.getByRole("region", { name: "Conversation chooser" });
    expect(chooser.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("reclaims the empty band above the selected conversation title", async () => {
    mount();
    await screen.findByText("Original message");

    const workspace = screen.getByRole("main", { name: "Selected conversation workspace" });
    const header = screen.getByRole("region", { name: "Selected channel" });
    expect(window.getComputedStyle(workspace).paddingTop).toBe("40px");
    expect(header.style.paddingTop).toBe("");
    expect(header.style.paddingBottom).toBe("");
  });
  it("reduces the composer bottom spacing by forty percent", async () => {
    mount();
    await screen.findByText("Original message");

    const panel = screen.getByRole("complementary", { name: "Conversations panel" });
    const composer = screen.getByRole("form", { name: "Message composer" });
    const bottomSpacing = Number.parseFloat(window.getComputedStyle(panel).paddingBottom)
      + Number.parseFloat(window.getComputedStyle(composer).paddingBottom);
    expect(bottomSpacing).toBeCloseTo(19.2, 5);
  });
  it("places the message space directly against the composer border", async () => {
    mount();
    await screen.findByText("Original message");

    const content = screen.getByRole("region", { name: "Channel content" });
    const composer = screen.getByRole("form", { name: "Message composer" });
    expect(content.nextElementSibling).toBe(composer);
    expect(window.getComputedStyle(composer).paddingTop).toBe("0px");
  });
  it("renders the right conversation card without an outer border", async () => {
    mount();
    await screen.findByText("Original message");
    const selectedChannel = screen.getByRole("region", { name: "Selected channel" });
    expect(window.getComputedStyle(selectedChannel.parentElement!).borderWidth).toBe("0px");
  });
  it("closes the receipt form when Receipts is selected again", async () => {
    mount();
    await screen.findByText("Original message");
    const receipts = screen.getByRole("tab", { name: "Receipts" });
    fireEvent.click(receipts);
    expect(await screen.findByRole("region", { name: "Receipt editor" })).toBeTruthy();
    fireEvent.click(receipts);
    expect(screen.queryByRole("region", { name: "Receipt editor" })).toBeNull();
    expect(screen.getByText("Original message")).toBeTruthy();
  });
  it("uses branded conversation headings, contained selectors, and the wider chat setup card", async () => {
    mount();
    await screen.findByText("Original message");
    const panel = screen.getByRole("complementary", { name: "Conversations panel" });
    expect(panel.parentElement?.className).toContain("hub-conversation-layout");
    expect(panel.parentElement?.getAttribute("data-controls-collapsed")).toBe("false");
    const chatHeading = screen.getByRole("heading", { name: "Conversations" });
    expect(chatHeading.className).toContain("text-black");
    expect(panel.contains(chatHeading)).toBe(false);
    expect(chatHeading.closest("header")?.querySelector("svg")?.getAttribute("class")).not.toContain("shadow");
    fireEvent.click(screen.getByRole("button", { name: "Choose a conversation" }));
    expect(screen.getByRole("region", { name: "Conversation chooser" }).className).toContain("hub-conversation-chooser-card");
    expect(screen.getByLabelText("Find conversations").className).toContain("border-[color:var(--brand-primary)]");
    expect(screen.getByLabelText("Find conversations").className).toContain("bg-white");
  });
  it("keeps the Company Chat empty-state icon branded and its heading black", async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/channels?limit=100" || path === "/crews") return [];
      return [];
    });

    mount(true);

    const heading = await screen.findByRole("heading", { name: "Choose a conversation" });
    const emptyState = heading.closest("section");
    expect(heading.className).toContain("text-black");
    expect(heading.className).not.toContain("text-[var(--brand-primary)]");
    expect(emptyState?.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--brand-primary)]");
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
    expect(screen.queryByLabelText("Mention teammate")).toBeNull();
    fireEvent.change(screen.getByDisplayValue("Saved draft"), { target: { value: "Hello @[7] @Casey Example" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Connection interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0].operationId).toBe(sent[1].operationId);
    expect(sent[0].payload.mentionUserIds).toEqual([]);
  });
  it("renders mention display names without exposing user IDs", () => {
    expect(displayMentionText("Review @[7] and @[99]", [{ userId: 7, displayName: "Casey Example" }])).toBe("Review @Casey Example and @teammate");
  });

  it("creates and opens a Group without a conversation surface", async () => {
    let groupCreated = false;
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/crews" && init?.method === "POST") {
        groupCreated = true;
        return { id: "crew-1" };
      }
      if (path === "/crews") {
        return groupCreated
          ? [{ id: "crew-1", name: "Review Group", role: "admin" }]
          : [];
      }
      return [];
    });

    mount(false);
    const name = await screen.findByLabelText("New group name");
    fireEvent.change(name, { target: { value: "Review Group" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Group" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Review Group" }));
    expect(screen.getByLabelText("Group name")).toBeTruthy();
    expect(screen.queryByLabelText("Conversations")).toBeNull();
    expect(screen.queryByRole("main", { name: "Selected conversation workspace" })).toBeNull();
  });

  it("does not offer Group creation or lifecycle actions to a non-admin member", async () => {
    mocks.user = { userId: 7, role: "vendor", vendorId: 1, partnerId: null, membershipRole: "member" };
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/crews") return [{ id: "crew-1", name: "Gate Crew", role: "owner" }];
      return [];
    });

    mount(false);
    await screen.findByRole("button", { name: "Edit Gate Crew" });
    expect(screen.queryByRole("button", { name: "Create Group" })).toBeNull();
  });

  it("opens a branded crew manager with role, archive, and delete controls", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init) return { resource: {} };
      if (path === "/channels") return [];
      if (path === "/crews") return [{ id: "crew-1", name: "Gate Crew", role: "admin", status: "active" }];
      if (path === "/crews/crew-1/channels") return [];
      if (path === "/crews/crew-1/members") return [{ userId: 8, displayName: "Bill Crew", mode: "owner" }];
      return [];
    });

    mount(false);

    const manager = await screen.findByRole("region", { name: "Manage groups" });
    expect(manager.className).toContain("rounded-xl");
    expect(manager.className).toContain("border-2");
    fireEvent.click(await screen.findByRole("button", { name: "Edit Gate Crew" }));

    expect(await screen.findByRole("heading", { name: "Edit Gate Crew" })).toBeTruthy();
    expect(screen.getByLabelText("Group name").className).toContain("h-9");
    expect((await screen.findByLabelText("Role for Bill Crew")).className).toContain("h-9");
    expect(screen.getByRole("button", { name: "Remove Bill Crew" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive group" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete group" })).toBeTruthy();
  });});

describe("Work Hub home chrome", () => {
  it("keeps the main panels and removes the two bottom information cards", async () => {
    mocks.request.mockImplementation(async (path: string) => path.startsWith("/home") ? { announcements: [], tasks: [], shifts: [], meetings: [] } : []);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ActivityWorkspace /></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "Work Hub" })).toBeTruthy();
    const today = screen.getByRole("region", { name: "Today" });
    const communications = screen.getByRole("region", { name: "Communications" });
    const extras = screen.getByRole("region", { name: "More from Work Hub" });
    expect(today.compareDocumentPosition(communications) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(communications.compareDocumentPosition(extras) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Work Hub snapshot" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Needs Attention" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Latest activity" })).toBeNull();
    expect(screen.queryByRole("search", { name: "Search activity" })).toBeNull();
    expect(screen.getByRole("link", { name: /^Needs Attention/ })).toBeTruthy();
  });
});

describe("Work Hub activity attention surface", () => {
  it("refreshes attention data when the Work Hub event stream changes", async () => {
    class FakeEventSource {
      static current: FakeEventSource | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() { FakeEventSource.current = this; }
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    let homeReads = 0;
    mocks.request.mockImplementation(async (path: string) => { if (path === "/home") { homeReads += 1; return { announcements: [], tasks: [], shifts: [], meetings: [] }; } return []; });
    const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ActivityWorkspace /></QueryClientProvider>);
    await waitFor(() => expect(homeReads).toBe(1));
    FakeEventSource.current?.onmessage?.(new MessageEvent("message"));
    await waitFor(() => expect(homeReads).toBeGreaterThan(1));
    view.unmount();
    vi.unstubAllGlobals();
  });
});
