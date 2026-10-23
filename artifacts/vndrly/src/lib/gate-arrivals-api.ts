import type { GateArrivalDetail, GateArrivalsResponse } from "@workspace/api-zod";

async function read<T>(siteId: number, suffix = ""): Promise<T> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${base}/api/gate-arrivals${suffix}?siteLocationId=${siteId}`, {
    credentials: "include", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Unable to load gate arrivals (${response.status})`);
  return response.json() as Promise<T>;
}

export const gateArrivalsApi = {
  list: (siteId: number) => read<GateArrivalsResponse>(siteId),
  get: (siteId: number, runId: string) => read<GateArrivalDetail>(siteId, `/${encodeURIComponent(runId)}`),
  visitLinks: (siteId: number, visitId: number) => read<{ runs: GateArrivalDetail[] }>(siteId, `/visit/${visitId}`),
};
