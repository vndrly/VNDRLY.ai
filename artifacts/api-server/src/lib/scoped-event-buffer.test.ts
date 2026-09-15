import { describe, expect, it } from "vitest";
import { createScopedEventBuffer } from "./scoped-event-buffer";

type Event = { seq: number; siteLocationId: number };

describe("scoped event buffer", () => {
  it("reports changes only for events visible in the requested site scope", () => {
    const buffer = createScopedEventBuffer<Event>(10);
    buffer.push({ seq: 11, siteLocationId: 1 });
    buffer.push({ seq: 12, siteLocationId: 2 });
    expect(buffer.poll(10, 12, (event) => event.siteLocationId === 1)).toEqual({ currentSeq: 12, changed: true, gap: false });
    expect(buffer.poll(11, 12, (event) => event.siteLocationId === 1)).toEqual({ currentSeq: 12, changed: false, gap: false });
  });

  it("forces an authoritative refresh when reconnect history has a gap", () => {
    const buffer = createScopedEventBuffer<Event>(2);
    buffer.push({ seq: 20, siteLocationId: 1 });
    buffer.push({ seq: 21, siteLocationId: 1 });
    expect(buffer.poll(10, 21, () => true)).toEqual({ currentSeq: 21, changed: true, gap: true });
  });

  it("does not report an initial connection as a gap", () => {
    const buffer = createScopedEventBuffer<Event>(2);
    buffer.push({ seq: 4, siteLocationId: 1 });
    expect(buffer.poll(0, 4, () => false)).toEqual({ currentSeq: 4, changed: false, gap: false });
  });
});
