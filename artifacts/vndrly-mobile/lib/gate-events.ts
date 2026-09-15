import { apiFetch } from "@/lib/api";

type GateEventPollResult = { currentSeq: number; changed: boolean; gap: boolean };
type GateEventFetcher = (path: string) => Promise<GateEventPollResult>;

export function createGateEventPoller(fetcher: GateEventFetcher = apiFetch) {
  let cursor = 0;
  let selectedSiteId: number | null = null;
  let stopped = false;

  const pollOnce = async (siteLocationId: number, onChanged: () => void) => {
    if (selectedSiteId !== siteLocationId) {
      selectedSiteId = siteLocationId;
      cursor = 0;
    }
    const result = await fetcher(`/api/visits/events?transport=poll&after=${cursor}&siteLocationId=${siteLocationId}`);
    if (stopped) return;
    cursor = result.currentSeq;
    if (result.changed || result.gap) onChanged();
  };

  return {
    pollOnce,
    start(siteLocationId: number, onChanged: () => void, intervalMs = 1_500) {
      stopped = false;
      const poll = () => { void pollOnce(siteLocationId, onChanged).catch(() => undefined); };
      poll();
      const timer = setInterval(poll, intervalMs);
      return () => { stopped = true; clearInterval(timer); };
    },
  };
}
