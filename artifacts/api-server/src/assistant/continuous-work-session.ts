import type { AskVCapabilityContext } from "./capability-context";

type SessionSeed = Pick<AskVCapabilityContext, "userId"> & Partial<Omit<AskVCapabilityContext, "userId" | "revision" | "pendingConfirmationId">>;

const emptyContext = (seed: SessionSeed): AskVCapabilityContext => ({
  revision: 1,
  userId: seed.userId,
  membershipId: seed.membershipId ?? null,
  owner: seed.owner ?? null,
  sponsorshipId: seed.sponsorshipId ?? null,
  assignmentId: seed.assignmentId ?? null,
  shiftId: seed.shiftId ?? null,
  siteId: seed.siteId ?? null,
  crewId: seed.crewId ?? null,
  vehicleAssetId: seed.vehicleAssetId ?? null,
  tripId: seed.tripId ?? null,
  deviceId: seed.deviceId ?? null,
  communication: seed.communication ?? null,
  pendingConfirmationId: null,
});

export class ContinuousWorkSession {
  private context: AskVCapabilityContext;
  constructor(seed: SessionSeed) { this.context = emptyContext(seed); }

  interpret(phrase: string): { toolName: string; context: AskVCapabilityContext; clarification: string | null } {
    const text = phrase.toLowerCase();
    let toolName = "query_workforce_coverage";
    if (/morning v/.test(text)) toolName = "query_workforce_coverage";
    else if (/accident|crash|t.?boned/.test(text)) toolName = "prepare_incident_response_action";
    else if (/invite|onboard/.test(text)) toolName = "prepare_account_invitations_action";
    else if (/check(?:ing)? out|return|walkie|asset|truck to me/.test(text)) toolName = "prepare_asset_custody_action";
    else if (/plate|start.*trip|making another run/.test(text)) toolName = "prepare_field_trips_action";
    else if (/eta|where.*truck|slipped.*gate/.test(text)) toolName = "query_field_trips";
    else if (/acknowledge|assignment|shift/.test(text)) toolName = "prepare_workforce_coverage_action";
    const needsTarget = /\b(this|that)\b/.test(text) && !this.context.siteId && !this.context.vehicleAssetId;
    return { toolName, context: structuredClone(this.context), clarification: needsTarget ? "Which site or item do you mean?" : null };
  }

  completionMessage(receipt: { status: string }): string {
    if (["applied", "duplicate"].includes(receipt.status)) return "Completed and confirmed by VNDRLY.";
    if (receipt.status === "queued") return "Saved safely and ready to sync when the connection returns.";
    if (receipt.status === "conflict") return "The record changed elsewhere; I kept the authoritative version and can show the allowed next action.";
    return "I could not confirm that the action completed, so I will not say it succeeded.";
  }
}
