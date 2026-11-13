import type { FirstWatchContext, NextStepWorkflow, GateWorkflowContext } from "./next-steps-model";
import type { GateGuidedWorkflowKey } from "@workspace/gate-booth";

export type GateHelperKey = GateGuidedWorkflowKey;
export type GateHelperContext = GateWorkflowContext;
export type GateCompletionProof = { recordType: "gate-watch" | "gate-visit" | "gate-scheduled-shift"; recordId: number | string; siteId: number };
export type GateHelperStep = Partial<Pick<NextStepWorkflow, "action" | "message" | "context" | "description">>;
export type GateHelperDefinition = {
  key: GateHelperKey; title: string; description: string;
  keywords: readonly string[];
  access: "gate" | "office" | "admin";
  /** Resolve only existing records/context and existing page actions. Null means unavailable. */
  create: (context: GateHelperContext) => NextStepWorkflow | null;
};

const definitions = new Map<GateHelperKey, GateHelperDefinition>();
const listeners = new Set<() => void>();
let revision = 0;
export function registerGateHelper(definition: GateHelperDefinition) {
  definitions.set(definition.key, definition); revision++; listeners.forEach(listener => listener());
  return () => { if (definitions.get(definition.key) === definition) { definitions.delete(definition.key); revision++; listeners.forEach(listener => listener()); } };
}
export function registeredGateHelpers() { return [...definitions.values()]; }
export function gateHelperDefinition(key: GateHelperKey) { return definitions.get(key) ?? null; }
export function subscribeGateHelpers(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function gateHelpersRevision() { return revision; }
export function findGateHelperForQuestion(question: string) {
  const normalized = question.toLocaleLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, " ").trim();
  return registeredGateHelpers().find(definition => definition.keywords.some(keyword => normalized.includes(keyword.toLocaleLowerCase()))) ?? null;
}

registerGateHelper({
  key: "first-watch", title: "Set up your first gate watch", access: "gate",
  description: "Choose a direct or contracted employee, save Gatekeeper site access, schedule and assign the shift, then Assume Watch.",
  keywords: ["first gate watch", "add an employee", "add employee", "add a gatekeeper", "gate employee", "contracted employee", "subcontracted worker", "primera guardia", "agregar empleado"],
  create: context => {
    const site = Number.isSafeInteger(context.siteId) && Number(context.siteId) > 0;
    const query = new URLSearchParams({ ...(site ? { siteId: String(context.siteId) } : {}), ...(context.stationId ? { stationId: context.stationId } : {}), ...(context.shiftId ? { shiftId: context.shiftId } : {}), ...(context.day ? { day: context.day } : {}), ...(context.employeeUserId ? { employee: String(context.employeeUserId) } : {}) });
    return { id: "first-watch", kind: "first-watch", title: "Set up a gate employee and watch", priority: 0,
      action: { title: site ? "Choose or add a gate employee" : "Choose a gate site and station", href: site ? `/field-employees?${query}` : "/mapping" },
      context: site && context.siteName && context.stationName ? context as FirstWatchContext : null,
    };
  },
});
