import { registerGateHelper, type GateHelperContext, type GateHelperDefinition, type GateHelperKey } from "./gate-helper-registry";

export type GateControlTarget = { targetId: string; prompt: string };
const validSite = (context: GateHelperContext) => Number.isSafeInteger(context.siteId) && Number(context.siteId) > 0;
function gateHref(path: string, context: GateHelperContext, calendar = false) {
  const query = new URLSearchParams({
    ...(validSite(context) ? { siteId: String(context.siteId) } : {}),
    ...(context.stationId ? { stationId: context.stationId } : {}),
    ...(calendar && context.shiftId ? { shiftId: context.shiftId } : {}),
    ...(calendar && context.day ? { date: context.day } : {}),
    ...(!calendar && context.vehicleId != null ? { vehicleId: String(context.vehicleId) } : {}),
    ...(calendar && context.employeeUserId ? { employee: String(context.employeeUserId) } : {}),
  });
  return `${path}${query.size ? `?${query}` : ""}`;
}
function definition(key: GateHelperKey, title: string, description: string, keywords: string[], access: GateHelperDefinition["access"], path: string, actionTitle: string, steps?: readonly string[]): GateHelperDefinition {
  return { key, title, description, keywords, access, create: context => ({
    id: key, kind: "gate-operation", title, description, steps, priority: key === "gate-staffing-recovery" ? 1 : 30,
    context: { siteName: context.siteName ?? "", stationName: context.stationName ?? "", ...context },
    action: { title: actionTitle, href: gateHref(path, context, path === "/work-hub/calendar") },
    message: !validSite(context) || !context.stationId ? "Choose an authorized site and gate before continuing. This guide uses your existing controls and never saves for you." : undefined,
  }) };
}

/** On-demand lessons only. Current saved blockers are offered separately by their owning controls. */
export const gateOperationalHelpers: readonly GateHelperDefinition[] = [
  definition("gate-staffing-recovery", "Restore gate staffing", "Review the actual gap, explicitly acknowledge responsibility if authorized, then assign or personally cover the saved watch. Only a saved active watch restores coverage.", ["staffing recovery", "staffing gap", "cover a gate", "restore gate staffing", "falta de cobertura"], "office", "/work-hub/calendar", "Open saved staffing calendar"),
  definition("gate-watch-handoff", "Prepare and receive a watch handoff", "Review open items and notes, sign the saved handoff, then let the incoming operator explicitly review and Assume Watch. Navigation never ends the watch.", ["watch handoff", "handover a watch", "prepare turnover", "receive a watch", "assume watch", "how to assume watch", "relevo de guardia"], "gate", "/gate/change-over", "Open watch and handover"),
  definition("gate-vehicle-check-in", "Check in a vehicle", "Verify the physical gate, vehicle plate and person, then save the existing check-in form. A saved visit records who entered and the intended destination.", ["vehicle check in", "vehicle check-in", "check in a vehicle", "check a visitor in", "registrar entrada"], "gate", "/gate", "Open Gate check-in"),
  definition("gate-inner-arrival", "Confirm an inner arrival", "Choose the actual saved vehicle at this inner gate and confirm its physical arrival. An intended destination is not a confirmed location.", ["inner arrival", "confirm arrival", "arriving at inner gate", "confirmar llegada"], "gate", "/gate", "Open saved arrival queue"),
  definition("gate-vehicle-check-out", "Check out a vehicle", "Record departure at the current inner gate, then let the outer gate save the final site checkout. Each saved movement keeps the Gate Log accurate.", ["vehicle check out", "vehicle check-out", "check out a vehicle", "leave the site", "registrar salida"], "gate", "/gate", "Open saved departure queue"),
  definition("gate-early-turnaround", "Record an early turnaround", "Use the actual outer-gate vehicle record when it exits before reaching its intended inner destination. Save site checkout to cancel that pending arrival.", ["early turnaround", "turned around", "exited before inner arrival", "salida anticipada"], "gate", "/gate", "Open the saved outer-gate record"),
  definition("gate-return-to-inner", "Confirm a return to the inner gate", "Find the actual vehicle already on site and confirm its return at this inner gate. The saved arrival clears an obsolete pending outer departure.", ["return to inner", "return-to-inner", "unexpected arrival", "returned inside", "regreso al acceso interior"], "gate", "/gate", "Find the saved vehicle"),
  definition("gate-map-and-log", "Read the Gate map and log", "Compare the last gate-confirmed location with the intended destination, then inspect the saved Gate Log. These are recorded facts, not live vehicle GPS.", ["gate map and log", "gate map", "gate log", "last confirmed location", "mapa y registro"], "gate", "/gate/map", "Open the Gate map"),
  definition("gate-shift-scheduling", "Schedule and assign a gate shift", "Open the exact site, gate and date, define a shift if needed, then review and save eligible assignments. Scheduling never starts a watch.", ["shift scheduling", "schedule a gate shift", "assign a gatekeeper", "reassign a gate shift", "programar guardia"], "office", "/work-hub/calendar", "Open Gate shift scheduling"),
  definition("gate-station-management", "Manage a gate station", "Review the station configuration for an authorized site.", ["manage a gate station", "move a gate", "edit a gate", "gate links"], "admin", "/gate/map", "Open Gate administration", [
    "Choose the authorized site and existing station, or use Add Gate Location for a new station.",
    "Use Create Gate or Edit Gate in Administrative functions. Edit Gate includes moving the location.",
    "Save Gate Changes saves name and location; Save relationship and Save link save their own sections. Remove Gate requires confirmation and retains history. Check the server result before leaving.",
  ]),
  definition("gate-staff-visibility", "Reveal staff on the Gate Map", "View staff locations available to your current account.", ["reveal staff", "show staff", "staff visibility"], "gate", "/gate/map", "Open Gate Map", [
    "Choose the site on the Gate Map.",
    "Open Reveal Staff and choose a group or an individual.",
    "Select Show if staff locations are hidden. If a position is unavailable, wait for a current location.",
  ]),
];
for (const helper of gateOperationalHelpers) registerGateHelper(helper);

export function gateGuideScope(section: string, context: GateHelperContext) {
  return `gate-guide:${section}:${context.siteId ?? "none"}:${context.stationId ?? "none"}:${context.vehicleId ?? context.alertId ?? ""}`;
}
export function gateGuideMatches(selected: { id: string; context?: GateHelperContext | null } | null | undefined, key: GateHelperKey, actual: GateHelperContext) {
  if (selected?.id !== key) return false;
  const chosen = selected.context;
  if (chosen?.siteId != null && chosen.siteId !== actual.siteId || chosen?.stationId && chosen.stationId !== actual.stationId || chosen?.shiftId && actual.shiftId && chosen.shiftId !== actual.shiftId) return false;
  if (actual.alertId && chosen?.alertId !== actual.alertId) return false;
  if (actual.vehicleId != null && (chosen?.vehicleId == null || String(chosen.vehicleId) !== String(actual.vehicleId))) return false;
  return true;
}
export function gateCheckInTarget(facts: { firstName: string; lastName: string; plate: string; gateReady: boolean; online: boolean; busy?: boolean }): GateControlTarget | null {
  if (!facts.online || facts.busy) return null;
  if (!facts.gateReady) return { targetId: "choose-gate", prompt: "Choose the physical gate where you are recording this arrival." };
  if (!facts.plate.trim()) return { targetId: "plate", prompt: "Enter or read the vehicle plate so this arrival uses the correct vehicle record." };
  if (!facts.firstName.trim()) return { targetId: "first-name", prompt: "Enter the arriving person's first name." };
  if (!facts.lastName.trim()) return { targetId: "last-name", prompt: "Enter the arriving person's last name. Check the company, purpose and destination before saving." };
  return { targetId: "save-check-in", prompt: "Review this gate, vehicle and person, then select Check in. Continue only after the server confirms the saved visit." };
}
export function gateMovementTarget(key: GateHelperKey, facts: { open: boolean; online: boolean; canManage: boolean; inner?: boolean; inside?: boolean; expectedHere?: boolean; expectedInner?: boolean; expectedSiteExit?: boolean; previouslyEntered?: boolean; showAll?: boolean }): GateControlTarget | null {
  if (!facts.open || !facts.online || !facts.canManage) return null;
  if (key === "gate-return-to-inner" && facts.inner && !facts.inside && facts.previouslyEntered) return facts.showAll ? { targetId: "enter", prompt: "Confirm this selected vehicle has physically returned to this inner gate. The saved arrival clears its pending outer departure." } : { targetId: "find-vehicle", prompt: "Open the existing on-site vehicle list, then confirm the selected vehicle's return at this gate." };
  if (key === "gate-inner-arrival" && facts.inner && !facts.inside && facts.expectedHere) return { targetId: "enter", prompt: "Confirm this selected vehicle has physically arrived at this inner gate. An expected destination alone is not an arrival." };
  if (key === "gate-vehicle-check-out" && facts.inner && facts.inside) return { targetId: "leave", prompt: "Review the next destination, then save this vehicle's departure from the inner gate. Final site checkout remains with the outer gate." };
  if (key === "gate-vehicle-check-out" && !facts.inner && !facts.inside) return { targetId: "site-exit", prompt: "Confirm this selected vehicle has left the site, then save the final outer-gate checkout." };
  if (key === "gate-early-turnaround" && !facts.inner && !facts.inside && facts.expectedInner) return { targetId: "site-exit", prompt: "Save checkout for this vehicle that exited before its intended inner arrival. This cancels its pending inner arrival." };
  return null;
}
export function gateStaffingTarget(facts: { status: string; severity: string; canAcknowledge: boolean; paused?: boolean }): GateControlTarget | null {
  if (facts.status === "resolved") return null;
  if (facts.severity === "warning") return { targetId: "calendar", prompt: "Review this upcoming watch in the saved calendar. A future warning does not mean the booth is currently empty." };
  if (facts.status === "open" && facts.canAcknowledge && !facts.paused) return { targetId: "acknowledge", prompt: "Review the actual staffing shortage, then explicitly confirm responsibility. Acknowledgment stops shared reminders; it does not restore coverage." };
  return { targetId: "calendar", prompt: "Open this saved site, gate, shift and date to arrange coverage or personally Assume Watch using your current permissions." };
}
