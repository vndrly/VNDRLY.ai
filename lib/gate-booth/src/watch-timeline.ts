export interface GateWatchTimeline {
  radar: {
    shiftId: string;
    siteId: number;
    siteName: string;
    stationId: string;
    gateName: string;
    title: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
  }[];
  sites: {
    siteId: number;
    siteName: string;
    previous: {
      watchId: string;
      stationId: string;
      gateName: string;
      userId: number;
      name: string;
      startedAt: string;
      endedAt: string;
      notes: string | null;
      filedAt: string | null;
      handoffId: string | null;
    } | null;
    next: {
      shiftId: string;
      stationId: string;
      gateName: string;
      startsAt: string;
      endsAt: string;
      timezone: string;
      people: { userId: number; name: string }[];
    } | null;
  }[];
}
