import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { CHATGPT_WRITE_CAPABILITIES } from "./chatgpt-write-capabilities";
type AvailableTool = { name: string; workHubFamily?: string };
const DOMAIN_SCOPES: Record<string, readonly string[]> = {
  field_operations: ["tickets", "workforce", "sites", "catalog", "crew"],
  fleet: ["trips", "crew"], inventory: ["assets"], safety: ["safety"],
  finance: ["finance"], administration: ["onboarding", "invitations", "subscriptions"],
};

// These are navigation identities, not independent authority or extra model calls.
const SPECIALISTS = [
  { id: "gate", name: "Gate", style: "Brief and attentive to access exceptions", matches: /gate|visitor|visits|shift_notes|paid_travel/ },
  { id: "field_operations", name: "Field Operations", style: "Practical and focused on the next job step", matches: /ticket|crew|workforce/ },
  { id: "fleet", name: "Felix", style: "Dispatch-focused and explicit about location freshness", matches: /field_trips|driving_route|mileage/ },
  { id: "inventory", name: "Ivy", style: "Precise about custody, condition, and availability", matches: /asset_custody/ },
  { id: "work_hub", name: "Work Hub", style: "Organized and clear about commitments", matches: /work_hub/ },
  { id: "safety", name: "Sage", style: "Evidence-focused and explicit about unresolved hazards", matches: /incident|safety|certification|compliance/ },
  { id: "finance", name: "Finn", style: "Methodical about amounts, dates, and accounting evidence", matches: /payment|invoice|finance|accounting/ },
  { id: "administration", name: "Administration", style: "Guides setup one concrete step at a time", matches: /onboarding|user_progress|account_invitations|worker_subscriptions/ },
] as const;

export const SPECIALISTS_TOOL = {
  name: "v_list_specialists",
  description: "List V's domain specialists and their currently available toolsets for this connected account. Calling Felix, Ivy, Sage, or Finn selects a domain; it never expands permissions. Names and styles are presentation, not separately running agents. Voice switching and speaker identification are not enabled by this directory. Fleet tools cover existing trips only; the new VENDRY Fleet backend is not connected.",
  inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

/** Only describe tools already filtered by the connection's current grants and role. */
export function specialistDirectory(reads: readonly AvailableTool[], actions: readonly AvailableTool[]) {
  const readNames = new Set(reads.map(tool => tool.name));
  const actionNames = new Set(actions.map(tool => tool.name));
  const names = [...new Set([...readNames, ...actionNames])].sort();
  const metadata = new Map([...reads, ...actions].map(tool => [tool.name, tool]));
  const assigned = new Set<string>();
  return {
    coordinator: "V",
    specialists: SPECIALISTS.flatMap(({ matches, ...specialist }) => {
      const capabilityNames = new Set<string>(Object.entries({ ...CHATGPT_READ_CAPABILITIES, ...CHATGPT_WRITE_CAPABILITIES })
        .filter(([scope]) => DOMAIN_SCOPES[specialist.id]?.includes(scope.split(":")[0]))
        .flatMap(([, capability]) => [...capability.tools]));
      const tools = names.filter(name => capabilityNames.has(name) || matches.test(name) || (specialist.id === "work_hub" && Boolean(metadata.get(name)?.workHubFamily)));
      tools.forEach(name => assigned.add(name));
      return tools.length ? [{ ...specialist, readTools: tools.filter(name => readNames.has(name)), prepareTools: tools.filter(name => actionNames.has(name)), ...(specialist.id === "fleet" ? { integrationStatus: "existing_trips_only; VENDRY Fleet not connected" } : {}) }] : [];
    }),
    // General tools remain with V instead of disappearing from the directory.
    coordinatorTools: names.filter(name => !assigned.has(name)),
    verification: { name: "Audrey", method: "Read actual saved records and action results; prepared, running, failed, or uncertain is not completed", actionStatusAvailable: actions.length > 0 },
    voiceSwitchingAvailable: false,
    speakerIdentificationAvailable: false,
    instruction: "Use normal language or a specialist name. Recheck tool authorization on every call. A specialist does not grant authority. Cross-domain requests may use several available toolsets; never invent missing tools or evidence.",
  };
}
