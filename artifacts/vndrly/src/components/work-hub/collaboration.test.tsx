import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWorkspace, CollaborationWorkspace, displayMentionText } from "./collaboration";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  save: vi.fn(),
  user: { userId: 7, role: "vendor", vendorId: 1, partnerId: null, membershipRole: "admin" } as Record<string, any>,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ name: "MidCon Solutions", primary: "#00a6b2", accent: "#f2b134" }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("./navigation", () => ({ useHubPreferences: () => ({ preferences: { favorites: [], drafts: { c1: "Saved draft" } }, save: { mutate: mocks.save } }) }));
vi.mock("@/lib/work-hub-client", async importOriginal => ({ ...await importOriginal<any>(), workHubRequest: mocks.request }));
function mount(chat = true) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollaborationWorkspace chat={chat}/></QueryClientProvider>); }
describe("Work Hub conversations", () => {
  beforeEach(() => {
    mocks.request.mockReset(); mocks.save.mockReset();
    mocks.user = { userId: 7, role: "vendor", vendorId: 1, partnerId: null, membershipRole: "admin" };
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
    expect(screen.getByLabelText("Person").className).toContain("text-sm");
    expect(screen.getByRole("button", { name: "Send Invite" }).className).toContain("w-fit");
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
  it("separates the channel list, header, content, and composer into aligned cards", async () => {
    mount();
    await screen.findByText("Original message");

    const workspace = screen.getByRole("main", { name: "Selected conversation workspace" });
    const header = screen.getByRole("region", { name: "Selected channel" });
    const content = screen.getByRole("region", { name: "Channel content" });
    const composer = screen.getByRole("form", { name: "Message composer" });

    expect(screen.getByRole("complementary", { name: "Conversations panel" })).toBeTruthy();
    expect(workspace.contains(header)).toBe(true);
    expect(workspace.contains(content)).toBe(true);
    expect(workspace.contains(composer)).toBe(true);
    expect([header, content, composer].every((card) => card.className.includes("w-full"))).toBe(true);
  });
  it("uses branded conversation headings, contained selectors, and the wider chat setup card", async () => {
    mount();
    await screen.findByText("Original message");
    const panel = screen.getByRole("complementary", { name: "Conversations panel" });
    expect(panel.parentElement?.className).toContain("minmax(340px,380px)");
    const chatHeading = screen.getByRole("heading", { name: "MidCon Solutions Chat" });
    expect(chatHeading.className).toContain("text-black");
    expect(panel.contains(chatHeading)).toBe(false);
    expect(chatHeading.closest("header")?.querySelector("svg")?.getAttribute("class")).not.toContain("shadow");
    expect(screen.getByLabelText("Find conversations").className).toContain("border-[color:var(--brand-primary)]");
    expect(screen.getByLabelText("Find conversations").className).toContain("bg-white");
    expect(screen.getByLabelText("Conversation filter").className).toContain("bg-white");
    expect(screen.getByLabelText("Conversation filter").className).toContain("text-sm");
    expect(screen.getByLabelText("Conversation filter").parentElement?.className).toContain("relative");
  });
  it("keeps the Company Chat empty-state icon branded and its heading black", async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/chats" || path === "/crews") return [];
      return [];
    });

    mount(true);

    const heading = await screen.findByRole("heading", { name: "Choose a conversation" });
    const emptyState = heading.closest("section");
    expect(heading.className).toContain("text-black");
    expect(heading.className).not.toContain("text-[var(--brand-primary)]");
    expect(emptyState?.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--brand-primary)]");
  });
  it("waits for the explicit action and keeps Group and Person selection mutually exclusive", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init) return { channel: { id: "group-chat" } };
      if (path === "/chats") return [];
      if (path === "/crews") return [{ id: "group-1", name: "Gate Group" }];
      if (path.startsWith("/people")) return [{ id: 42, displayName: "Taylor", organizationName: "Flywheel", role: "Operator" }];
      return [];
    });
    mount(true);
    const group = await screen.findByLabelText("Select Group");
    const person = screen.getByLabelText("Person");
    await screen.findByRole("option", { name: "Gate Group" });
    fireEvent.change(group, { target: { value: "group-1" } });
    expect((person as HTMLSelectElement).value).toBe("");
    expect(mocks.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Start Chat" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/chats/groups", expect.objectContaining({ method: "POST" })));

    fireEvent.change(person, { target: { value: "42" } });
    expect((group as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Send Invite" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Taylor · Flywheel · Operator" })).toBeTruthy();
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

describe("Work Hub activity chrome", () => {
  it("places the shadow-free heading above a full-width card with one branded white search field", async () => {
    mocks.request.mockImplementation(async (path: string) => path === "/home" ? { announcements: [], tasks: [], shifts: [], meetings: [] } : []);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ActivityWorkspace />
      </QueryClientProvider>,
    );
    const workspace = screen.getByTestId("work-hub-activity");
    const heading = screen.getByRole("heading", { name: "Activity" });
    const card = screen.getByTestId("activity-primary-card");
    const icon = heading.closest("header")?.querySelector('[data-work-hub-heading-icon="activity"]');
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute("class")).not.toContain("shadow");
    expect(card.contains(heading)).toBe(false);
    expect(workspace.className).not.toContain("max-w-6xl");
    const search = screen.getByLabelText("Filter activity");
    expect(search.className).toContain("rounded-lg");
    expect(search.className).toContain("border-[color:var(--brand-primary)]");
    expect(search.className).toContain("bg-white");
    expect(screen.getByRole("search", { name: "Search activity" }).hasAttribute("data-work-hub-card")).toBe(false);

    const calendar = screen.getByRole("region", { name: "Upcoming calendar" });
    const review = screen.getByRole("region", { name: "Documents needing review" });
    expect(calendar.className).toContain("bg-white");
    expect(calendar.className).not.toContain("bg-background");
    expect(review.className).toContain("bg-white");
    expect(review.className).not.toContain("bg-background");

    const feed = screen.getByTestId("activity-feed");
    expect(feed.className).toContain("border-2");
    expect(feed.className).toContain("border-border");
    expect(feed.hasAttribute("data-work-hub-card")).toBe(false);
  });
});

describe("Work Hub activity attention surface", () => {
  it("ranks attention groups, limits the calendar to five, and shows review documents", async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/home") return {
        announcements: [
          { announcement: { id: "urgent", title: "Late shift", body: "Ten minutes overdue", urgency: "urgent", acknowledgementRequired: true }, recipient: { acknowledgedAt: null } },
          { announcement: { id: "important", title: "Assignment issued", body: "Please review", urgency: "normal", acknowledgementRequired: true }, recipient: { acknowledgedAt: null } },
        ],
        tasks: [
          { id: "old", title: "Old receipt review", status: "open", updatedAt: "2026-01-01T00:00:00Z" },
          ...Array.from({ length: 7 }, (_, index) => ({ id: `task-${index}`, title: `Upcoming ${index}`, status: "open", dueAt: `2099-01-0${index + 1}T12:00:00Z` })),
        ],
        shifts: [], meetings: [], reviewItems: [{ id: "document", title: "Uploaded receipt", deepLink: "/work-hub/files?review=document" }],
      };
      return [];
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ActivityWorkspace /></QueryClientProvider>);
    const urgent = await screen.findByText("Late shift");
    const important = screen.getByText("Assignment issued");
    const stale = screen.getByText("Old receipt review");
    expect(urgent.compareDocumentPosition(important) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(important.compareDocumentPosition(stale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("region", { name: "Upcoming calendar" }).querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Uploaded receipt" }).getAttribute("href")).toContain("review=document");
  });

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
    const activityCard = screen.getByRole("region", { name: "Activity workspace" });
    const searchRegion = screen.getByRole("search", { name: "Search activity" });
    const primaryCard = screen.getByTestId("activity-primary-card");
    expect(activityCard.contains(searchRegion)).toBe(true);
    expect(primaryCard.className).toContain("rounded-xl");
    expect(searchRegion.hasAttribute("data-work-hub-card")).toBe(false);
    expect(await screen.findByText("Safety briefing")).toBeTruthy();
    expect(screen.getByText("Urgent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText("Acknowledged")).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledWith("/announcements/a1/acknowledge", expect.objectContaining({ method: "POST" }));
  });
});
