import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useGateLiveMonitor } from "./use-gate-live-monitor";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Array<(ev: MessageEvent) => void>>();

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = Boolean(init?.withCredentials);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close() {}

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

(globalThis as { EventSource: unknown }).EventSource = FakeEventSource;

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("useGateLiveMonitor", () => {
  it('anchors the live stream to the selected gate and reconnects when that gate changes',()=>{
    const {rerender}=renderHook(({gate})=>useGateLiveMonitor({enabled:true,siteLocationId:309,gateStationId:gate,visits:[],queryKey:['gatekeeper-visits']}),{wrapper:wrapper(),initialProps:{gate:'outer'}});
    expect(FakeEventSource.instances.at(-1)?.url).toMatch(/gateStationId=outer$/);
    rerender({gate:'independent'});
    expect(FakeEventSource.instances.at(-1)?.url).toMatch(/gateStationId=independent$/);
  });
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the visits SSE channel and flashes a remote check-in", () => {
    const { result } = renderHook(
      () =>
        useGateLiveMonitor({
          enabled: true,
          siteLocationId: 309,
          visits: [],
          queryKey: ["gatekeeper-visits"],
        }),
      { wrapper: wrapper() },
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toMatch(/\/api\/visits\/events$/);
    expect(FakeEventSource.instances[0].withCredentials).toBe(true);

    act(() => {
      FakeEventSource.instances[0].onopen?.(new Event("open"));
      FakeEventSource.instances[0].emit("visit.checked_in", {
        type: "visit.checked_in",
        visit: {
          id: 88,
          firstName: "Pat",
          lastName: "Reyes",
          company: "Acme",
          vehiclePlate: "ABC1234",
          plateState: "OK",
          platePhotoUrl: "/plates/abc.jpg",
          siteName: "Energy Spur",
          siteLocationId: 309,
          checkInTime: "2026-08-23T17:00:00.000Z",
        },
      });
    });

    expect(result.current.liveStatus).toBe("live");
    expect(result.current.flash?.firstName).toBe("Pat");
    expect(result.current.flash?.kind).toBe("checked_in");
    expect(result.current.flash?.vehiclePlate).toBe("ABC1234");
    expect(result.current.flash?.plateState).toBe("OK");
  });

  it("flashes a remote check-out using the on-site list when the event has no name", () => {
    const { result } = renderHook(
      () =>
        useGateLiveMonitor({
          enabled: true,
          siteLocationId: 309,
          visits: [
            {
              id: 44,
              firstName: "Sam",
              lastName: "Ortiz",
              company: "Cactus",
              vehiclePlate: "TX-991",
              plateState: "TX",
              platePhotoUrl: "/p.jpg",
              siteName: "Energy Spur",
              siteLocationId: 309,
            },
          ],
          queryKey: ["gatekeeper-visits"],
        }),
      { wrapper: wrapper() },
    );

    act(() => {
      FakeEventSource.instances[0].onopen?.(new Event("open"));
      FakeEventSource.instances[0].emit("visit.checked_out", {
        type: "visit.checked_out",
        visitId: 44,
        siteLocationId: 309,
        checkOutTime: "2026-08-23T18:10:00.000Z",
      });
    });

    expect(result.current.flash?.kind).toBe("checked_out");
    expect(result.current.flash?.firstName).toBe("Sam");
    expect(result.current.flash?.vehiclePlate).toBe("TX-991");
    expect(result.current.flash?.plateState).toBe("TX");
  });
});
