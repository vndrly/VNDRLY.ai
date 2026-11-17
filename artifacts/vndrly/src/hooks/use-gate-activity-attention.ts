import { useEffect, useState } from "react";

export type GateActivityView = "arrivals" | "active" | "departures";
type ActivityRecords = Record<GateActivityView, readonly string[] | null>;
type TabState = { records: readonly string[] | null; unread: boolean };
const views: GateActivityView[] = ["arrivals", "active", "departures"];
const freshTabs = (): Record<GateActivityView, TabState> => ({
  arrivals: { records: null, unread: false },
  active: { records: null, unread: false },
  departures: { records: null, unread: false },
});

/** New record identities stay unread until their loaded view is actually visible. */
export function useGateActivityAttention(
  scope: string,
  records: ActivityRecords,
  visibleView: GateActivityView | null,
) {
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== "hidden");
  const [state, setState] = useState(() => ({ scope, tabs: freshTabs() }));
  // Callers derive arrays from live queries; depend on their contents, not references.
  const signature = JSON.stringify(records);
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const nextRecords = JSON.parse(signature) as ActivityRecords;
    setState(previous => {
      const tabs = { ...(previous.scope === scope ? previous.tabs : freshTabs()) };
      for (const view of views) {
        const incoming = nextRecords[view];
        // A loading/error response cannot erase unread activity or acknowledge it.
        if (incoming === null) continue;
        const last = tabs[view];
        const known = new Set(last.records ?? []);
        const added = last.records !== null && incoming.some(id => !known.has(id));
        tabs[view] = {
          records: [...new Set([...(last.records ?? []), ...incoming])],
          unread: documentVisible && visibleView === view ? false : last.unread || added,
        };
      }
      return { scope, tabs };
    });
  }, [scope, signature, visibleView, documentVisible]);
  return Object.fromEntries(views.map(view => [view, state.scope === scope && state.tabs[view].unread])) as Record<GateActivityView, boolean>;
}
