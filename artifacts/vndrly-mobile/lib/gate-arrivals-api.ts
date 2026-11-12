import type { GateArrivalDetail, GateArrivalsResponse } from "@workspace/api-zod";
import { apiFetch } from "./api";
function read<T>(siteId: number, suffix = "") {
 return apiFetch<T>(`/api/gate-arrivals${suffix}?siteLocationId=${siteId}`);
}
/** Read-only candidates; admission remains an explicit gatekeeper check-in. */
export const gateArrivalsApi = {
 list: (siteId:number) => read<GateArrivalsResponse>(siteId),
 get: (siteId:number,runId:string) => read<GateArrivalDetail>(siteId, '/' + encodeURIComponent(runId)),
 visitLinks: (siteId:number,visitId:number) => read<{runs:GateArrivalDetail[]}>(siteId, '/visit/' + visitId),
};
