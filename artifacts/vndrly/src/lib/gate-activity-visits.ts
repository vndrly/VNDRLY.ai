import { parallelGateGroup, type AreaVisit, type GateAreaTrafficResponse } from "@workspace/gate-booth";

/** A later movement by the same visitor is new activity even if totals are unchanged. */
export function gateActivityEventKey(visit: AreaVisit, view: "arrivals" | "on_site" | "departures", gateId?: string): string {
  const relevant = visit.movements.filter(movement => view === "departures"
    ? movement.kind === "leave" && movement.gateId === gateId || movement.kind === "site_exit"
    : view === "arrivals"
      ? (visit.presence.expectedGateId === gateId && (movement.kind === "route" || movement.kind === "leave")) || movement.kind === "enter" && movement.gateId === gateId
      : movement.kind === "enter");
  const latest = relevant.reduce<typeof relevant[number] | undefined>((last, movement) =>
    !last || Date.parse(movement.at) >= Date.parse(last.at) ? movement : last, undefined);
  return `visit:${visit.id}:${view === "departures" ? visit.checkOutTime ?? "" : ""}:${latest?.operationId ?? ""}`;
}

/** Shared by the movement list and its counters so both use the same gate scope. */
export function gateActivityVisits(
  data: GateAreaTrafficResponse | undefined,
  gateId: string | undefined,
  view: "arrivals" | "on_site" | "departures" | "all",
  showAll = false,
): AreaVisit[] {
  const gates = data?.gates ?? [];
  const gate = gates.find(row => row.id === gateId);
  if (!gate || !gates.some(row => row.topology?.area || row.topology?.destinations?.length)) return [];
  const area = gate.topology?.area;
  const root = !area;
  const rootGates = parallelGateGroup(gates, gateId);
  return (data?.visits ?? []).filter(visit => {
    if (root && visit.entryGateId && !rootGates.has(visit.entryGateId)) return false;
    if (showAll) return !visit.checkOutTime;
    if (view === "arrivals") return (root && visit.entryGateId === gateId) || visit.presence.expectedGateId === gateId || visit.movements.some(movement => movement.gateId === gateId && movement.kind === "enter");
    if (view === "departures") return root ? visit.presence.expectedSiteExit || !!visit.checkOutTime : visit.movements.some(movement => movement.gateId === gateId && movement.kind === "leave");
    const inside = gates.find(row => row.id === visit.presence.currentGateId)?.topology?.area === area;
    if (view === "on_site") return !visit.checkOutTime && (root || inside);
    return root || inside || visit.movements.some(movement => movement.area === area);
  });
}
