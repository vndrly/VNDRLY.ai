import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGateActivityAttention, type GateActivityView } from "./use-gate-activity-attention";

type Props = { scope: string; records: Record<GateActivityView, string[] | null>; visible: GateActivityView | null };
const initial = (): Props => ({ scope: "user-1:gate-1", records: { arrivals: [], active: [], departures: [] }, visible: null });
const mount = (props: Props) => renderHook((value: Props) => useGateActivityAttention(value.scope, value.records, value.visible), { initialProps: props });

describe("Gate activity attention", () => {
  it.each<GateActivityView>(["arrivals", "active", "departures"])("keeps %s unread until viewed and alerts again on a new identity at the same count", view => {
    const props = initial();
    const { result, rerender } = mount(props);
    const first = { ...props, records: { ...props.records, [view]: ["first"] } };
    rerender(first);
    expect(result.current[view]).toBe(true);
    rerender({ ...first });
    expect(result.current[view]).toBe(true);
    rerender({ ...first, visible: view });
    expect(result.current[view]).toBe(false);
    rerender(first);
    expect(result.current[view]).toBe(false);
    rerender({ ...props, records: { ...props.records, [view]: ["replacement"] } });
    expect(result.current[view]).toBe(true);
  });

  it("does not treat existing history, reordered records, or removals as new", () => {
    const props = initial();
    props.records.arrivals = ["a", "b"];
    const { result, rerender } = mount(props);
    expect(result.current.arrivals).toBe(false);
    for (const arrivals of [["b", "a"], ["a"], ["a", "b"]]) {
      rerender({ ...props, records: { ...props.records, arrivals } });
      expect(result.current.arrivals).toBe(false);
    }
  });

  it("acknowledges only the visible tab and preserves unread records during failed refreshes", () => {
    const props = initial();
    const { result, rerender } = mount(props);
    const next = { ...props, records: { arrivals: ["a"], active: ["b"], departures: ["c"] } };
    rerender(next);
    expect(result.current).toEqual({ arrivals: true, active: true, departures: true });
    rerender({ ...next, visible: "arrivals" });
    expect(result.current).toEqual({ arrivals: false, active: true, departures: true });
    rerender({ ...next, visible: "active", records: { ...next.records, active: null } });
    expect(result.current.active).toBe(true);
    rerender({ ...next, visible: "active" });
    expect(result.current.active).toBe(false);
    rerender({ ...next, scope: "user-2:gate-2" });
    expect(result.current).toEqual({ arrivals: false, active: false, departures: false });
  });

  it("does not acknowledge a selected tab while the browser is hidden", () => {
    const props = initial();
    props.visible = "active";
    const { result, rerender } = mount(props);
    const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      rerender({ ...props, records: { ...props.records, active: ["new"] } });
      expect(result.current.active).toBe(true);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(result.current.active).toBe(false);
    } finally {
      if (visibility) Object.defineProperty(document, "visibilityState", visibility);
      else delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
  });
});
