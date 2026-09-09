import type { SessionPayload } from "../lib/session";
import type {
  WorkHubCapability,
  WorkHubContextRef,
  WorkHubOwner,
} from "@workspace/api-zod";

export class WorkHubAccessError extends Error {
  readonly status: 403 | 404;
  readonly code: "work_hub.forbidden" | "work_hub.not_found";

  constructor(kind: "forbidden" | "not_found") {
    super(
      kind === "not_found"
        ? "Work Hub resource not found"
        : "Work Hub action forbidden",
    );
    this.name = "WorkHubAccessError";
    this.status = kind === "not_found" ? 404 : 403;
    this.code =
      kind === "not_found" ? "work_hub.not_found" : "work_hub.forbidden";
  }
}

export type WorkHubAccess = Readonly<{
  owner: WorkHubOwner;
  context: WorkHubContextRef;
  capabilities: ReadonlySet<WorkHubCapability>;
  visibilityRevision: string;
}>;

export type WorkHubAccessInput = {
  session: SessionPayload & { userId: number };
  owner: WorkHubOwner;
  context: WorkHubContextRef;
  participant: boolean;
  visibilityRevision?: string;
};

const PARTICIPANT_CAPABILITIES: WorkHubCapability[] = [
  "channel.read",
  "channel.write",
  "file.download",
];
const OWNER_ADMIN_CAPABILITIES: WorkHubCapability[] = [
  ...PARTICIPANT_CAPABILITIES,
  "channel.manage",
  "task.assign",
  "announcement.publish",
  "shift.manage",
  "meeting.host",
  "meeting.record",
  "meeting.artifact.download",
  "policy.manage",
  "connector.manage",
];
const GATE_SUPERVISOR_CAPABILITIES: WorkHubCapability[] = [
  ...PARTICIPANT_CAPABILITIES,
  "task.assign",
  "shift.manage",
];

function ownsContext(session: SessionPayload, owner: WorkHubOwner): boolean {
  return owner.type === "vendor"
    ? session.vendorId === owner.id
    : session.partnerId === owner.id;
}

export function deriveWorkHubCapabilities(
  input: WorkHubAccessInput,
): WorkHubCapability[] {
  const { session, owner, participant } = input;
  if (session.role === "admin") return [...OWNER_ADMIN_CAPABILITIES];
  const ownerMatch = ownsContext(session, owner);
  if (!ownerMatch && !participant) throw new WorkHubAccessError("not_found");
  if (!participant && ownerMatch && input.context.kind !== "organization") {
    throw new WorkHubAccessError("not_found");
  }
  if (ownerMatch && session.membershipRole === "admin")
    return [...OWNER_ADMIN_CAPABILITIES];
  if (
    ownerMatch &&
    session.vendorRole === "gate_supervisor" &&
    (input.context.kind === "gate" || input.context.kind === "site")
  )
    return [...GATE_SUPERVISOR_CAPABILITIES];
  if (participant || ownerMatch) return [...PARTICIPANT_CAPABILITIES];
  throw new WorkHubAccessError("not_found");
}

export function createWorkHubAccess(input: WorkHubAccessInput): WorkHubAccess {
  return Object.freeze({
    owner: input.owner,
    context: input.context,
    capabilities: new Set(deriveWorkHubCapabilities(input)),
    visibilityRevision:
      input.visibilityRevision ??
      `${input.session.userId}:${input.owner.type}:${input.owner.id}`,
  });
}

export function requireWorkHubCapability(
  access: WorkHubAccess,
  capability: WorkHubCapability,
): void {
  if (!access.capabilities.has(capability))
    throw new WorkHubAccessError("forbidden");
}
