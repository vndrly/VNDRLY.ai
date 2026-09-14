import { randomBytes, randomUUID, createHash } from "node:crypto";

export type OperationsDisplayOwner = { type: "vendor" | "partner"; id: number };
export type OperationsDisplayView = "crew_map" | "gate_log" | "safety" | "coverage" | "meeting_room";
export type OperationsDisplayController = { userId: number; signedInCompanionDeviceId?: string };
export type OperationsDisplay = {
  id: string; owner: OperationsDisplayOwner; name: string; kind: "operations_display";
  registeredByUserId: number; registeredCompanionDeviceId: string;
  siteAllowlist: number[]; viewAllowlist: OperationsDisplayView[]; privacyMode: boolean;
  tokenHash: string; tokenExpiresAt: Date; revokedAt: Date | null; revokedByUserId: number | null;
  createdAt: Date; updatedAt: Date;
};
export type OperationsDisplayOutput = {
  id: string; displayId: string; name: string; currentView: OperationsDisplayView | null;
  currentSiteLocationId: number | null; currentMeetingOccurrenceId: string | null;
  cameraEnabled: false; microphoneEnabled: false; updatedAt: Date;
};

export interface OperationsDisplayRepository {
  create(display: OperationsDisplay, outputs: OperationsDisplayOutput[]): Promise<void>;
  get(displayId: string): Promise<{ display: OperationsDisplay; outputs: OperationsDisplayOutput[] } | null>;
  save(display: OperationsDisplay, outputs: OperationsDisplayOutput[]): Promise<void>;
}

export function createMemoryOperationsDisplayRepository(): OperationsDisplayRepository {
  const values = new Map<string, { display: OperationsDisplay; outputs: OperationsDisplayOutput[] }>();
  const clone = <T>(value: T): T => structuredClone(value);
  return {
    async create(display, outputs) { values.set(display.id, clone({ display, outputs })); },
    async get(id) { const value = values.get(id); return value ? clone(value) : null; },
    async save(display, outputs) { values.set(display.id, clone({ display, outputs })); },
  };
}

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export function createOperationsDisplayService(repository: OperationsDisplayRepository, now: () => Date = () => new Date()) {
  const trusted = (display: OperationsDisplay, actor: OperationsDisplayController) => actor.userId === display.registeredByUserId && actor.signedInCompanionDeviceId === display.registeredCompanionDeviceId;
  async function required(id: string) { const value = await repository.get(id); if (!value) throw new Error("operations_display.not_found"); return value; }

  async function registerOperationsDisplay(input: {
    owner: OperationsDisplayOwner; name: string; registeredByUserId: number; registeredCompanionDeviceId: string;
    monitorNames: string[]; siteAllowlist: number[]; viewAllowlist: OperationsDisplayView[]; privacyMode: boolean;
    tokenTtlMinutes?: number;
  }) {
    const createdAt = now();
    const token = randomBytes(32).toString("base64url");
    const display: OperationsDisplay = {
      id: randomUUID(), owner: input.owner, name: input.name, kind: "operations_display",
      registeredByUserId: input.registeredByUserId, registeredCompanionDeviceId: input.registeredCompanionDeviceId,
      siteAllowlist: [...new Set(input.siteAllowlist)], viewAllowlist: [...new Set(input.viewAllowlist)], privacyMode: input.privacyMode,
      tokenHash: hashToken(token), tokenExpiresAt: new Date(createdAt.getTime() + (input.tokenTtlMinutes ?? 15) * 60_000),
      revokedAt: null, revokedByUserId: null, createdAt, updatedAt: createdAt,
    };
    const outputs = [...new Set(input.monitorNames)].map((name): OperationsDisplayOutput => ({
      id: randomUUID(), displayId: display.id, name, currentView: null, currentSiteLocationId: null,
      currentMeetingOccurrenceId: null, cameraEnabled: false, microphoneEnabled: false, updatedAt: createdAt,
    }));
    await repository.create(display, outputs);
    return { display, outputs, token };
  }

  async function authorizeDisplayView(displayId: string, input: { monitorName: string; view: OperationsDisplayView; siteLocationId?: number | null }, actor: OperationsDisplayController) {
    const state = await required(displayId);
    if (state.display.revokedAt) return { allowed: false as const, reason: "display_revoked" as const };
    if (!trusted(state.display, actor)) return { allowed: false as const, reason: "trusted_companion_required" as const };
    if (!state.outputs.some((output) => output.name === input.monitorName)) return { allowed: false as const, reason: "monitor_not_found" as const };
    if (!state.display.viewAllowlist.includes(input.view)) return { allowed: false as const, reason: "view_not_allowed" as const };
    if (input.siteLocationId != null && !state.display.siteAllowlist.includes(input.siteLocationId)) return { allowed: false as const, reason: "site_not_allowed" as const };
    return { allowed: true as const, state };
  }

  async function routeViewToMonitor(input: { displayId: string; monitorName: string; view: OperationsDisplayView; siteLocationId?: number | null; meetingOccurrenceId?: string | null }, actor: OperationsDisplayController) {
    const authorization = await authorizeDisplayView(input.displayId, input, actor);
    if (!authorization.allowed) return authorization;
    const timestamp = now();
    const outputs = authorization.state.outputs.map((output) => output.name === input.monitorName ? {
      ...output, currentView: input.view, currentSiteLocationId: input.siteLocationId ?? null,
      currentMeetingOccurrenceId: input.meetingOccurrenceId ?? null, cameraEnabled: false as const,
      microphoneEnabled: false as const, updatedAt: timestamp,
    } : output);
    const display = { ...authorization.state.display, updatedAt: timestamp };
    await repository.save(display, outputs);
    return { allowed: true as const, display, output: outputs.find((output) => output.name === input.monitorName)! };
  }

  async function joinAsRoomDevice(input: { displayId: string; monitorName: string; meetingOccurrenceId: string }, actor: OperationsDisplayController) {
    const result = await routeViewToMonitor({ ...input, view: "meeting_room" }, actor);
    if (!result.allowed) return result;
    return { allowed: true as const, roomDevice: { label: `${result.display.name} - ${input.monitorName}`, cameraEnabled: false as const, microphoneEnabled: false as const, meetingOccurrenceId: input.meetingOccurrenceId } };
  }

  async function revokeDisplay(displayId: string, actor: OperationsDisplayController) {
    const state = await required(displayId);
    if (!trusted(state.display, actor)) return { allowed: false as const, reason: "trusted_companion_required" as const };
    const timestamp = now();
    const display = { ...state.display, revokedAt: timestamp, revokedByUserId: actor.userId, updatedAt: timestamp };
    await repository.save(display, state.outputs);
    return { allowed: true as const, display };
  }

  function authorizeAdministrativeMutation(identity: { kind: string; displayId?: string }) {
    return identity.kind === "operations_display" ? { allowed: false as const, reason: "display_read_only" as const } : { allowed: true as const };
  }

  return { registerOperationsDisplay, authorizeDisplayView, routeViewToMonitor, joinAsRoomDevice, revokeDisplay, authorizeAdministrativeMutation };
}
