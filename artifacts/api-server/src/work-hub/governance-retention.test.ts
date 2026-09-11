import { describe, expect, it, vi } from "vitest";
import {
  createGovernanceRetentionService,
  GovernanceRetentionError,
  isSubjectHeld,
  projectMeetingSubjectGraph,
  subjectKey,
} from "./governance-retention";

const owner = { type: "vendor" as const, id: 41 };
const rules = {
  messages: 30,
  deleted_messages: 30,
  files_voice_notes: 30,
  notes_versions: 30,
  form_submissions: 30,
  meeting_recordings: 30,
  transcripts: 30,
  attendance: 30,
  external_calendar_cache: 30,
  audit_logs: 30,
};
const actor = { userId: 7, source: "web" as const };

function deps() {
  return {
    authorizeOwnerAdmin: vi.fn(async () => undefined),
    authorizePlatformAdmin: vi.fn(async () => undefined),
    repository: {
      currentMinimum: vi.fn(async () => ({
        id: "min",
        policyVersion: 2,
        rules,
      })),
      listMinimums: vi.fn(async () => []),
      createMinimum: vi.fn(async () => ({
        id: "min2",
        policyVersion: 3,
        rules,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })),
      currentPolicy: vi.fn(async () => null),
      listPolicies: vi.fn(async () => []),
      createPolicy: vi.fn(async () => ({
        id: "p",
        ownerOrgType: "vendor",
        ownerOrgId: 41,
        policyVersion: 1,
        rules,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })),
      listHolds: vi.fn(async () => []),
      createHold: vi.fn(async () => ({
        id: "h",
        ownerOrgType: "vendor",
        ownerOrgId: 41,
        subjectType: "channel",
        subjectId: "c",
        active: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        releasedAt: null,
      })),
      releaseHold: vi.fn(async () => ({
        id: "h",
        ownerOrgType: "vendor",
        ownerOrgId: 41,
        subjectType: "channel",
        subjectId: "c",
        active: false,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        releasedAt: new Date("2026-01-02T00:00:00Z"),
      })),
      resolveSubject: vi.fn(async () => ({
        subject: { type: "channel" as const, id: "c" },
        ancestors: [{ type: "organization" as const, id: "vendor:41" }],
      })),
    },
  };
}

describe("governance retention service", () => {
  it("fails closed when no platform minimum exists", async () => {
    const d = deps();
    d.repository.currentMinimum.mockResolvedValueOnce(null as never);
    const service = createGovernanceRetentionService(d);
    await expect(
      service.createPolicy({
        actor,
        body: {
          operationId: "11111111-1111-4111-8111-111111111111",
          owner,
          rules,
        },
      }),
    ).rejects.toMatchObject({
      code: "retention.minimum_unavailable",
      status: 503,
    });
    expect(d.repository.createPolicy).not.toHaveBeenCalled();
  });

  it("reauthorizes then creates an append-only policy against current minimum", async () => {
    const d = deps();
    const service = createGovernanceRetentionService(d);
    await service.createPolicy({
      actor,
      body: {
        operationId: "11111111-1111-4111-8111-111111111111",
        owner,
        rules,
      },
    });
    expect(d.authorizeOwnerAdmin).toHaveBeenCalledWith(actor.userId, owner);
    expect(d.repository.createPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumPolicyVersion: 2,
        operationId: expect.any(String),
      }),
    );
  });

  it("rejects an operation-id replay whose original policy payload differs", async () => {
    const d = deps();
    d.repository.createPolicy.mockResolvedValueOnce({
      replayed: true,
      resource: { rules: { ...rules, messages: 31 } },
    } as never);
    const service = createGovernanceRetentionService(d);
    await expect(
      service.createPolicy({
        actor,
        body: {
          operationId: "11111111-1111-4111-8111-111111111111",
          owner,
          rules,
        },
      }),
    ).rejects.toMatchObject({
      code: "retention.operation_conflict",
      status: 409,
    });
  });

  it("rejects foreign or unknown hold subjects opaquely before creation", async () => {
    const d = deps();
    d.repository.resolveSubject.mockResolvedValueOnce(null as never);
    const service = createGovernanceRetentionService(d);
    await expect(
      service.createHold({
        actor,
        body: {
          operationId: "11111111-1111-4111-8111-111111111111",
          owner,
          subject: {
            type: "channel",
            id: "22222222-2222-4222-8222-222222222222",
          },
          reason: "preserve",
        },
      }),
    ).rejects.toMatchObject({ code: "work_hub.not_found", status: 404 });
    expect(d.repository.createHold).not.toHaveBeenCalled();
  });

  it("rejects malformed hold subject ids before authorization or repository access", async () => {
    const d = deps();
    const service = createGovernanceRetentionService(d);
    await expect(
      service.createHold({
        actor,
        body: {
          operationId: "11111111-1111-4111-8111-111111111111",
          owner,
          subject: { type: "channel", id: "not-a-uuid" },
          reason: "preserve",
        },
      }),
    ).rejects.toBeTruthy();
    expect(d.authorizeOwnerAdmin).not.toHaveBeenCalled();
    expect(d.repository.resolveSubject).not.toHaveBeenCalled();
    expect(d.repository.createHold).not.toHaveBeenCalled();
  });

  it("does not create or audit a policy when current owner authorization returns opaque not-found", async () => {
    const d = deps();
    d.authorizeOwnerAdmin.mockRejectedValueOnce(
      new GovernanceRetentionError(
        "work_hub.not_found",
        404,
        "Work Hub resource not found",
      ),
    );
    const service = createGovernanceRetentionService(d);
    await expect(
      service.createPolicy({
        actor,
        body: {
          operationId: "11111111-1111-4111-8111-111111111111",
          owner,
          rules,
        },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(d.repository.currentMinimum).not.toHaveBeenCalled();
    expect(d.repository.createPolicy).not.toHaveBeenCalled();
  });

  it("never passes the hold reason into audit metadata", async () => {
    const d = deps();
    const service = createGovernanceRetentionService(d);
    await service.createHold({
      actor,
      body: {
        operationId: "11111111-1111-4111-8111-111111111111",
        owner,
        subject: {
          type: "channel",
          id: "22222222-2222-4222-8222-222222222222",
        },
        reason: "secret litigation detail",
      },
    });
    expect(d.repository.createHold).toHaveBeenCalledWith(
      expect.objectContaining({ auditMetadata: { subjectType: "channel" } }),
    );
  });

  it("allows release only through the owner-authorized active-hold transition", async () => {
    const d = deps();
    const service = createGovernanceRetentionService(d);
    await service.releaseHold({
      actor,
      owner,
      body: {
        operationId: "11111111-1111-4111-8111-111111111111",
        holdId: "22222222-2222-4222-8222-222222222222",
      },
    });
    expect(d.authorizeOwnerAdmin).toHaveBeenCalledWith(actor.userId, owner);
    expect(d.repository.releaseHold).toHaveBeenCalledWith(
      expect.objectContaining({ owner, actorUserId: 7 }),
    );
  });

  it("matches active direct and ancestor holds without exposing identifiers in aggregate evidence", () => {
    const graph = {
      subject: { type: "meeting_occurrence" as const, id: "m" },
      ancestors: [
        { type: "organization" as const, id: "vendor:41" },
        { type: "channel" as const, id: "c" },
      ],
    };
    expect(subjectKey(graph.subject)).toBe("meeting_occurrence:m");
    expect(
      isSubjectHeld(graph, [
        { subjectType: "channel", subjectId: "c", active: true },
      ]),
    ).toEqual({ held: true });
    expect(
      isSubjectHeld(graph, [
        { subjectType: "channel", subjectId: "other", active: true },
      ]),
    ).toEqual({ held: false });
  });

  it("projects only same-owner meeting channel ancestry and fails closed on drift", () => {
    const meetingId = "22222222-2222-4222-8222-222222222222";
    const channelId = "33333333-3333-4333-8333-333333333333";
    expect(
      projectMeetingSubjectGraph(owner, {
        id: meetingId,
        channelId: null,
        matchedChannelId: null,
      })?.ancestors,
    ).toEqual([{ type: "organization", id: "41" }]);
    expect(
      projectMeetingSubjectGraph(owner, {
        id: meetingId,
        channelId,
        matchedChannelId: channelId,
      })?.ancestors,
    ).toEqual([
      { type: "organization", id: "41" },
      { type: "channel", id: channelId },
    ]);
    expect(
      projectMeetingSubjectGraph(owner, {
        id: meetingId,
        channelId,
        matchedChannelId: null,
      }),
    ).toBeNull();
  });
});
