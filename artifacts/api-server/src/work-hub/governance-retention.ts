import {
  legalHoldCreateSchema,
  legalHoldReleaseSchema,
  retentionMinimumCreateSchema,
  retentionPolicyCreateSchema,
  validateOrganizationRetentionRules,
  type LegalHoldCreate,
  type RetentionSubject,
  type WorkHubGovernanceOwner,
} from "@workspace/api-zod";

export class GovernanceRetentionError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = "GovernanceRetentionError";
  }
}
type Actor = { userId: number; source: "web" | "ios" };
export type SubjectGraph = {
  subject: RetentionSubject;
  ancestors: RetentionSubject[];
};
type HoldMatch = { subjectType: string; subjectId: string; active: boolean };
export const subjectKey = (subject: RetentionSubject): string =>
  `${subject.type}:${subject.id}`;
export function isSubjectHeld(
  graph: SubjectGraph,
  holds: ReadonlyArray<HoldMatch>,
): { held: boolean } {
  const keys = new Set([graph.subject, ...graph.ancestors].map(subjectKey));
  return {
    held: holds.some(
      (hold) =>
        hold.active && keys.has(`${hold.subjectType}:${hold.subjectId}`),
    ),
  };
}

export function projectMeetingSubjectGraph(
  owner: WorkHubGovernanceOwner,
  occurrence: {
    id: string;
    channelId: string | null;
    matchedChannelId: string | null;
  },
): SubjectGraph | null {
  if (occurrence.channelId && !occurrence.matchedChannelId) {
    return null;
  }
  return {
    subject: { type: "meeting_occurrence", id: occurrence.id },
    ancestors: [
      { type: "organization", id: String(owner.id) },
      ...(occurrence.matchedChannelId
        ? [{ type: "channel" as const, id: occurrence.matchedChannelId }]
        : []),
    ],
  };
}
type Repository = {
  currentMinimum(): Promise<any | null>;
  listMinimums(): Promise<any[]>;
  createMinimum(input: any): Promise<any>;
  currentPolicy(owner: WorkHubGovernanceOwner): Promise<any | null>;
  listPolicies(owner: WorkHubGovernanceOwner): Promise<any[]>;
  createPolicy(input: any): Promise<any>;
  listHolds(owner: WorkHubGovernanceOwner): Promise<any[]>;
  createHold(input: any): Promise<any>;
  releaseHold(input: any): Promise<any>;
  resolveSubject(
    owner: WorkHubGovernanceOwner,
    subject: RetentionSubject,
  ): Promise<SubjectGraph | null>;
};
function assertExactReplay(
  result: any,
  matches: (resource: any) => boolean,
): any {
  if (result?.replayed === true && !matches(result.resource)) {
    throw new GovernanceRetentionError(
      "retention.operation_conflict",
      409,
      "Operation ID was already used for a different request",
    );
  }
  return result;
}
const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
export function createGovernanceRetentionService(deps: {
  authorizeOwnerAdmin(
    userId: number,
    owner: WorkHubGovernanceOwner,
  ): Promise<void>;
  authorizePlatformAdmin(userId: number): Promise<void>;
  repository: Repository;
}) {
  const ownerAuth = async (actor: Actor, owner: WorkHubGovernanceOwner) =>
    deps.authorizeOwnerAdmin(actor.userId, owner);
  return {
    async currentPolicy(input: {
      actor: Actor;
      owner: WorkHubGovernanceOwner;
    }) {
      await ownerAuth(input.actor, input.owner);
      return deps.repository.currentPolicy(input.owner);
    },
    async policyHistory(input: {
      actor: Actor;
      owner: WorkHubGovernanceOwner;
    }) {
      await ownerAuth(input.actor, input.owner);
      return deps.repository.listPolicies(input.owner);
    },
    async createPolicy(input: { actor: Actor; body: unknown }) {
      const body = retentionPolicyCreateSchema.parse(input.body);
      await ownerAuth(input.actor, body.owner);
      const minimum = await deps.repository.currentMinimum();
      if (!minimum)
        throw new GovernanceRetentionError(
          "retention.minimum_unavailable",
          503,
          "Platform retention minimum is not configured",
        );
      let rules;
      try {
        rules = validateOrganizationRetentionRules(body.rules, minimum.rules);
      } catch (error) {
        throw new GovernanceRetentionError(
          "retention.policy_invalid",
          400,
          error instanceof Error ? error.message : "Invalid retention policy",
        );
      }
      const result = await deps.repository.createPolicy({
        actorUserId: input.actor.userId,
        source: input.actor.source,
        owner: body.owner,
        operationId: body.operationId,
        rules,
        minimumPolicyVersion: minimum.policyVersion,
      });
      return assertExactReplay(
        result,
        (resource) =>
          sameJson(resource?.rules, rules) &&
          resource?.owner?.type === body.owner.type &&
          resource?.owner?.id === body.owner.id,
      );
    },
    async minimumHistory(input: { actor: Actor }) {
      await deps.authorizePlatformAdmin(input.actor.userId);
      return deps.repository.listMinimums();
    },
    async createMinimum(input: { actor: Actor; body: unknown }) {
      const body = retentionMinimumCreateSchema.parse(input.body);
      await deps.authorizePlatformAdmin(input.actor.userId);
      const result = await deps.repository.createMinimum({
        actorUserId: input.actor.userId,
        source: input.actor.source,
        ...body,
      });
      return assertExactReplay(result, (resource) =>
        sameJson(resource?.rules, body.rules),
      );
    },
    async listHolds(input: { actor: Actor; owner: WorkHubGovernanceOwner }) {
      await ownerAuth(input.actor, input.owner);
      return deps.repository.listHolds(input.owner);
    },
    async createHold(input: { actor: Actor; body: unknown }) {
      const body: LegalHoldCreate = legalHoldCreateSchema.parse(input.body);
      await ownerAuth(input.actor, body.owner);
      const graph = await deps.repository.resolveSubject(
        body.owner,
        body.subject,
      );
      if (!graph)
        throw new GovernanceRetentionError(
          "work_hub.not_found",
          404,
          "Work Hub resource not found",
        );
      const result = await deps.repository.createHold({
        actorUserId: input.actor.userId,
        source: input.actor.source,
        owner: body.owner,
        operationId: body.operationId,
        subject: graph.subject,
        reason: body.reason,
        auditMetadata: { subjectType: graph.subject.type },
      });
      return assertExactReplay(
        result,
        (resource) =>
          resource?.subject?.type === graph.subject.type &&
          resource?.subject?.id === graph.subject.id &&
          resource?.reason === body.reason,
      );
    },
    async releaseHold(input: {
      actor: Actor;
      owner: WorkHubGovernanceOwner;
      body: unknown;
    }) {
      const body = legalHoldReleaseSchema.parse(input.body);
      await ownerAuth(input.actor, input.owner);
      const result = await deps.repository.releaseHold({
        actorUserId: input.actor.userId,
        source: input.actor.source,
        owner: input.owner,
        ...body,
        auditMetadata: {},
      });
      return assertExactReplay(
        result,
        (resource) => resource?.id === body.holdId,
      );
    },
  };
}
