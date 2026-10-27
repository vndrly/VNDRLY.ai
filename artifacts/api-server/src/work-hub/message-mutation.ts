import { WorkHubAccessError } from "./context-access";

export type MessageMutationIntent = {
  action: "update" | "delete";
  actorUserId: number;
  channelId: string;
  messageId: string;
  expectedVersion: number | null;
  body?: string;
  canDeleteOtherMessages?: boolean;
};

type WorkHubOwner = { type: "vendor" | "partner"; id: number };
type WorkHubOwnerActor = {
  role?: string | null;
  vendorId?: number | null;
  partnerId?: number | null;
  membershipRole?: string | null;
  vendorRole?: string | null;
};

function ownsWorkHubOrganization(actor: WorkHubOwnerActor, owner: WorkHubOwner): boolean {
  return owner.type === "vendor"
    ? actor.vendorId === owner.id
    : actor.partnerId === owner.id;
}

export function canManageWorkHubOwner(actor: WorkHubOwnerActor, owner: WorkHubOwner): boolean {
  if (actor.role === "admin") return true;
  if (!ownsWorkHubOrganization(actor, owner)) return false;
  return actor.membershipRole === "admin" ||
    (owner.type === "vendor" && (actor.vendorRole === "office" || actor.vendorRole === "both"));
}

export function canModerateWorkHubOwner(actor: WorkHubOwnerActor, owner: WorkHubOwner): boolean {
  return actor.role === "admin" ||
    (ownsWorkHubOrganization(actor, owner) && actor.membershipRole === "admin");
}

export function canDeleteWorkHubMessage({
  actorUserId,
  messageAuthorUserId,
  canModerate,
}: {
  actorUserId: number;
  messageAuthorUserId: number;
  canModerate: boolean;
}): boolean {
  return actorUserId === messageAuthorUserId || canModerate;
}

/** Historical receipts prove only their exact target, reviewed version and mutation. */
export function assertMessageMutationReceipt(intent: MessageMutationIntent, saved: Record<string, unknown>): void {
  const mayMutate = intent.action === "update"
    ? saved.authorUserId === intent.actorUserId
    : canDeleteWorkHubMessage({
        actorUserId: intent.actorUserId,
        messageAuthorUserId: Number(saved.authorUserId),
        canModerate: intent.canDeleteOtherMessages === true,
      });
  if (saved.id !== intent.messageId || saved.channelId !== intent.channelId || !mayMutate ||
      !Number.isInteger(intent.expectedVersion) ||
      Number(intent.expectedVersion) < 1 || saved.version !== Number(intent.expectedVersion) + 1 ||
      (intent.action === "update"
        ? saved.body !== intent.body || saved.deletedAt != null
        : saved.body !== "" || saved.deletedAt == null || saved.deletedById !== intent.actorUserId)) {
    throw new WorkHubAccessError("forbidden");
  }
}

export function assertMessageMutationTarget(intent: MessageMutationIntent, current: { id: string; channelId: string; authorUserId: number } | undefined): void {
  if (!current || current.id !== intent.messageId || current.channelId !== intent.channelId) throw new WorkHubAccessError("not_found");
  if (intent.action === "update" && current.authorUserId !== intent.actorUserId) throw new WorkHubAccessError("forbidden");
  if (intent.action === "delete" && !canDeleteWorkHubMessage({
    actorUserId: intent.actorUserId,
    messageAuthorUserId: current.authorUserId,
    canModerate: intent.canDeleteOtherMessages === true,
  })) throw new WorkHubAccessError("forbidden");
}
