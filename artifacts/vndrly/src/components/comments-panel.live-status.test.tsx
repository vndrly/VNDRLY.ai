import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import CommentsPanel from "./comments-panel";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1, role: "partner" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const liveStatusMock = vi.fn<(opts: unknown) => "live">(() => "live");
vi.mock("@/hooks/use-live-connection-status", () => ({
  useLiveConnectionStatus: (opts: {
    url: string;
    helloEventName?: string;
    enabled?: boolean;
  }) => liveStatusMock(opts),
}));

const originalFetch = globalThis.fetch;
const originalEventSource = (globalThis as { EventSource?: unknown })
  .EventSource;

// Capture EventSource construction so we can verify the panel opens
// the per-job hotlist comments stream and dispatches its own
// created/updated/deleted listener (Task #676).
type FakeES = {
  url: string;
  listeners: Map<string, Set<EventListener>>;
  dispatch: (event: string, data: unknown) => void;
  close: () => void;
};
const fakeEventSources: FakeES[] = [];

class FakeEventSource implements FakeES {
  url: string;
  listeners = new Map<string, Set<EventListener>>();
  closed = false;
  constructor(url: string) {
    this.url = url;
    fakeEventSources.push(this);
  }
  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  close(): void {
    this.closed = true;
  }
  dispatch(type: string, data: unknown): void {
    const ls = this.listeners.get(type);
    if (!ls) return;
    const evt = { data: JSON.stringify(data) } as MessageEvent;
    for (const l of ls) l(evt);
  }
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return {
    qc,
    ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>),
  };
}

beforeEach(() => {
  liveStatusMock.mockReset();
  liveStatusMock.mockReturnValue("live");
  fakeEventSources.length = 0;
  (globalThis as { EventSource?: unknown }).EventSource =
    FakeEventSource as unknown;
  globalThis.fetch = vi.fn(
    async () =>
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  ) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEventSource === undefined) {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  } else {
    (globalThis as { EventSource?: unknown }).EventSource =
      originalEventSource;
  }
});

describe("CommentsPanel — live-status header (Task #672 / Task #676)", () => {
  it("renders the live SSE pill for ticket comments", async () => {
    renderWithClient(
      <CommentsPanel
        source="ticket"
        parentId={42}
        testIdPrefix="ticket-comments"
      />,
    );

    expect(
      await screen.findByTestId("ticket-comments-live-connection-pill"),
    ).toBeTruthy();

    // Verify the hook is wired to the ticket events stream + ticket.hello.
    const lastCall = liveStatusMock.mock.calls.at(-1)?.[0] as
      | { url: string; helloEventName?: string }
      | undefined;
    expect(lastCall?.url).toContain("/api/tickets/events");
    expect(lastCall?.helloEventName).toBe("ticket.hello");

    // Ticket panels should NOT open the per-job hotlist comments stream.
    expect(
      fakeEventSources.find((es) =>
        es.url.includes("/api/hotlist/jobs/"),
      ),
    ).toBeUndefined();
  });

  it("renders the live SSE pill for hotlist comments and subscribes to the per-job stream", async () => {
    renderWithClient(
      <CommentsPanel
        source="hotlist"
        parentId={7}
        testIdPrefix="hotlist-comments"
      />,
    );

    expect(
      await screen.findByTestId("hotlist-comments-live-connection-pill"),
    ).toBeTruthy();

    // The pre-Task #676 "Not live" pill + Refresh button must be gone.
    expect(screen.queryByTestId("hotlist-comments-not-live-pill")).toBeNull();
    expect(screen.queryByTestId("hotlist-comments-refresh")).toBeNull();

    // Hook is wired to the per-job hotlist comments stream + hello.
    const hookCall = liveStatusMock.mock.calls.at(-1)?.[0] as
      | { url: string; helloEventName?: string }
      | undefined;
    expect(hookCall?.url).toContain("/api/hotlist/jobs/7/comments/events");
    expect(hookCall?.helloEventName).toBe("hotlist.comment.hello");

    // The panel must also open the SSE channel directly so it can listen
    // for the per-event hotlist.comment.created/updated/deleted refresh
    // hints (in addition to the hello-with-gap path the hook handles).
    const opened = fakeEventSources.find((es) =>
      es.url.includes("/api/hotlist/jobs/7/comments/events"),
    );
    expect(opened).toBeTruthy();
  });

  it("re-fetches the hotlist comment thread when a hotlist.comment.created arrives", async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    renderWithClient(
      <CommentsPanel
        source="hotlist"
        parentId={9}
        testIdPrefix="hotlist-comments"
      />,
    );

    await screen.findByTestId("hotlist-comments-live-connection-pill");
    const opened = fakeEventSources.find((es) =>
      es.url.includes("/api/hotlist/jobs/9/comments/events"),
    );
    expect(opened).toBeTruthy();

    const callsBefore = fetchSpy.mock.calls.filter((args) =>
      String(args[0]).includes("/api/hotlist/jobs/9/comments"),
    ).length;

    await act(async () => {
      opened!.dispatch("hotlist.comment.created", {
        type: "hotlist.comment.created",
        jobId: 9,
        commentId: 123,
        partnerId: null,
        bidderVendorIds: [],
        seq: 1,
      });
      // Allow react-query's invalidate → refetch microtask to flush.
      await new Promise((r) => setTimeout(r, 0));
    });

    const callsAfter = fetchSpy.mock.calls.filter((args) =>
      String(args[0]).includes("/api/hotlist/jobs/9/comments"),
    ).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});
