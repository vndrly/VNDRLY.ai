import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { operationsDisplayViewSchema } from "@workspace/api-zod";
import type { OperationsDisplay, OperationsDisplayOutput } from "../services/operations-displays";

const common = { operationId: z.uuid(), displayId: z.uuid(), expectedUpdatedAt: z.iso.datetime(), reason: z.string().trim().min(1).max(2000) };
export const operationsDisplayCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("route"), monitorName: z.string().trim().min(1).max(40), view: operationsDisplayViewSchema.exclude(["meeting_room"]), siteLocationId: z.number().int().positive() }).strict(),
  z.object({ ...common, action: z.literal("join_room"), monitorName: z.string().trim().min(1).max(40), meetingOccurrenceId: z.uuid() }).strict(),
  z.object({ ...common, action: z.literal("revoke") }).strict(),
]);
export type OperationsDisplayCommand = z.infer<typeof operationsDisplayCommandSchema>;
export type DisplayCommandActor = { userId: number; membershipId: number; sessionVersion: number; owner: { type: "vendor" | "partner"; id: number } };
type State = { display: OperationsDisplay; outputs: OperationsDisplayOutput[] };
export type DisplayCommandReceipt = {
  operationId: string; displayId: string; action: OperationsDisplayCommand["action"];
  actorUserId: number; fingerprint: string; status: "applied"; recordedAt: string;
  physicalDisplayVerified: false; cameraStarted: false; microphoneStarted: false;
};
export interface LockedDisplayCommand {
  state: State;
  prior: DisplayCommandReceipt | null;
  /** Atomically persist state, immutable receipt and actor/reason audit, or rollback all. */
  commit(next: State, receipt: DisplayCommandReceipt, reason: string): Promise<void>;
}
export interface DisplayCommandDependencies {
  /** Lock selected display and exact actor/operation before reading state/receipt. */
  withLockedCommand<T>(command: OperationsDisplayCommand, actor: DisplayCommandActor, operation: (locked: LockedDisplayCommand) => Promise<T>): Promise<T>;
  /** Recheck persisted current membership/SV/admin, exact account and current site/room authority.
   * Return the authenticated companion binding from trusted device context; never a model field.
   * Must use the same transaction and check revoked/deleted device records on first send and replay. */
  authorize(locked: LockedDisplayCommand, actor: DisplayCommandActor, command: OperationsDisplayCommand): Promise<{ companionDeviceId: string }>;
  now(): Date;
}
const actorSchema = z.object({ userId: z.number().int().positive(), membershipId: z.number().int().positive(), sessionVersion: z.number().int().positive(), owner: z.object({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive() }).strict() }).strict();
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
function fingerprint(command: OperationsDisplayCommand, actor: DisplayCommandActor, companionDeviceId: string) {
  return createHash("sha256").update(JSON.stringify(canonical({ command, actor, companionDeviceId }))).digest("hex");
}

/** No pairing, device identity minting, media capture or network effects. Route integration is required. */
export function createOperationsDisplayCommands(deps: DisplayCommandDependencies) {
  async function bound(raw: unknown, supplied: DisplayCommandActor, apply: boolean) {
    const command = operationsDisplayCommandSchema.parse(raw), actor = actorSchema.parse(supplied);
    return deps.withLockedCommand(command, actor, async locked => {
      const { display } = locked.state;
      if (display.id !== command.displayId || display.owner.type !== actor.owner.type || display.owner.id !== actor.owner.id || display.registeredByUserId !== actor.userId) throw Error("operations_display.not_found");
      const trusted = await deps.authorize(locked, actor, command);
      if (!z.uuid().safeParse(trusted.companionDeviceId).success || trusted.companionDeviceId !== display.registeredCompanionDeviceId) throw Error("operations_display.trusted_companion_required");
      const exact = fingerprint(command, actor, trusted.companionDeviceId);
      if (locked.prior) {
        if (locked.prior.operationId !== command.operationId || locked.prior.displayId !== command.displayId || locked.prior.actorUserId !== actor.userId || locked.prior.action !== command.action || locked.prior.fingerprint !== exact || locked.prior.status !== "applied") throw Error("operations_display.operation_conflict");
        return structuredClone(locked.prior);
      }
      if (!apply) return null;
      if (display.revokedAt) throw Error("operations_display.revoked");
      if (display.updatedAt.toISOString() !== command.expectedUpdatedAt) throw Error("operations_display.version_conflict");
      const next = structuredClone(locked.state), now = deps.now();
      if (!Number.isFinite(now.getTime())) throw Error("operations_display.invalid_time");
      // Millisecond CAS must advance even when two accepts share a clock tick.
      const versionTime = new Date(Math.max(now.getTime(), display.updatedAt.getTime() + 1));
      if (command.action === "revoke") { next.display.revokedAt = now; next.display.revokedByUserId = actor.userId; }
      else {
        const selected = next.outputs.find(output => output.displayId === display.id && output.name === command.monitorName);
        if (!selected) throw Error("operations_display.monitor_not_found");
        const view = command.action === "join_room" ? "meeting_room" : command.view;
        if (!display.viewAllowlist.includes(view)) throw Error("operations_display.view_not_allowed");
        if (command.action === "route" && !display.siteAllowlist.includes(command.siteLocationId)) throw Error("operations_display.site_not_allowed");
        selected.currentView = view;
        selected.currentSiteLocationId = command.action === "route" ? command.siteLocationId : null;
        selected.currentMeetingOccurrenceId = command.action === "join_room" ? command.meetingOccurrenceId : null;
        selected.cameraEnabled = false; selected.microphoneEnabled = false; selected.updatedAt = versionTime;
      }
      next.display.updatedAt = versionTime;
      const receipt: DisplayCommandReceipt = { operationId: command.operationId, displayId: command.displayId, action: command.action, actorUserId: actor.userId, fingerprint: exact, status: "applied", recordedAt: now.toISOString(), physicalDisplayVerified: false, cameraStarted: false, microphoneStarted: false };
      await locked.commit(next, receipt, command.reason);
      return receipt;
    });
  }
  return {
    /** Review shape only. The existing authenticated device approval must bind this exact payload. */
    prepare: (raw: unknown) => ({ command: operationsDisplayCommandSchema.parse(raw), submitted: false as const, physicalDisplayVerified: false as const }),
    execute: (raw: unknown, actor: DisplayCommandActor) => bound(raw, actor, true),
    readback: (raw: unknown, actor: DisplayCommandActor) => bound(raw, actor, false),
  };
}
