import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Task #710 — verify the @-mention picker calmly backs off when the
// `participants.rate_limited` 429 lands. The contract under test:
//
//   * the participants query is parked for the Retry-After window —
//     subsequent invalidations (e.g. SSE-driven refresh hints) must
//     NOT re-fetch it and re-trip the limiter, and
//   * the comments thread itself is independent: parking the picker
//     must not silence the comments query.

import CommentsPanel from "./comments-panel";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1, role: "partner" } }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/hooks/use-live-connection-status", () => ({
  useLiveConnectionStatus: () => "live",
}));

const originalFetch = globalThis.fetch;
const originalEventSource = (globalThis as { EventSource?: unknown })
  .EventSource;

class FakeEventSource {
  url: string;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return {
    qc,
    ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { EventSource?: unknown }).EventSource =
    FakeEventSource as unknown;
  fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url ?? "");
    if (u.includes("comments-participants")) {
      return new Response(
        JSON.stringify({
          error: "rate_limited",
          code: "participants.rate_limited",
          retryAfterSeconds: 120,
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEventSource === undefined) {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  } else {
    (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
  }
});

function participantsCallCount(): number {
  return fetchMock.mock.calls.filter((args) =>
    String(args[0] ?? "").includes("comments-participants"),
  ).length;
}

function commentsListCallCount(): number {
  return fetchMock.mock.calls.filter((args) => {
    const u = String(args[0] ?? "");
    // Match the base ticket-comments path but exclude the participants
    // sibling endpoint and the per-comment path-suffixed variants
    // (POST /:id, DELETE /:id, etc. — those are mutations, not the
    // list query under test).
    return /\/api\/tickets\/\d+\/comments(\?|$)/.test(u);
  }).length;
}

describe("comments panel — participants rate-limit gate (Task #710)", () => {
  it("parks the participants query after a 429 and suppresses subsequent refetches", async () => {
    const { qc } = renderWithClient(
      <CommentsPanel source="ticket" parentId={42} />,
    );

    // Initial mount fires one participants call which 429s. The gate
    // must mark the query disabled so any follow-up invalidation
    // (e.g. SSE-driven roster refresh) does NOT re-fetch.
    await waitFor(() => {
      expect(participantsCallCount()).toBe(1);
    });

    // Let the chain of effects settle: query reports error → gate
    // hook flips rateLimited to true → component useEffect flips its
    // mirror state → next render disables the query. We flush a few
    // macrotasks so the final render has `enabled: false`.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Force an invalidation — this is the "next poll" equivalent for a
    // query that has no refetchInterval. With the gate parked, react-
    // query will see `enabled: false` and skip the refetch entirely.
    await act(async () => {
      await qc.invalidateQueries({
        queryKey: ["comments-participants", "ticket", 42],
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(participantsCallCount()).toBe(1);
  });

  it("does NOT park the comments query — only the participants resource is gated", async () => {
    renderWithClient(<CommentsPanel source="ticket" parentId={42} />);

    // The comments list query lives at the parent base path; it must
    // continue to fire normally (the participants 429 is scoped to its
    // own resource). We just need to see at least one comments fetch,
    // proving the picker's gate didn't accidentally silence the thread.
    await waitFor(() => {
      expect(commentsListCallCount()).toBeGreaterThanOrEqual(1);
    });
  });

  it("ignores 429s coded for a different resource (cross-resource isolation)", async () => {
    // Re-mock fetch so participants returns the wrong code; the gate
    // must NOT trip and the next invalidation MUST re-fetch normally.
    fetchMock.mockReset();
    let participantsCalls = 0;
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url ?? "");
      if (u.includes("comments-participants")) {
        participantsCalls += 1;
        if (participantsCalls === 1) {
          return new Response(
            JSON.stringify({
              error: "rate_limited",
              code: "comments.rate_limited", // wrong code for the picker gate
              retryAfterSeconds: 60,
            }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { qc } = renderWithClient(
      <CommentsPanel source="ticket" parentId={42} />,
    );

    await waitFor(() => {
      expect(participantsCallCount()).toBeGreaterThanOrEqual(1);
    });

    await act(async () => {
      await qc.invalidateQueries({
        queryKey: ["comments-participants", "ticket", 42],
      });
      await Promise.resolve();
    });

    // With the wrong code, the picker gate stays open — invalidating
    // must trigger a real refetch, proving cross-resource isolation.
    expect(participantsCallCount()).toBeGreaterThan(1);
  });
});
