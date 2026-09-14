import { describe, expect, it, vi } from "vitest";
import {
  createInMemorySafetyResponseRepository,
  createIncident,
  startPossibleCrashCountdown,
  escalateIncident,
  acknowledgeIncident,
  appendIncidentEvidence,
  closeIncident,
  placeEvidenceHold,
} from "./safety-response";

const baseInput = {
  organizationId: 7,
  reportedByUserId: 22,
  source: "manual" as const,
  severity: "high" as const,
  originalReport: "Vehicle collision reported by the driver.",
};

describe("safety response", () => {
  it("persists a manual incident even when AI mapping and push are unavailable", async () => {
    const repository = createInMemorySafetyResponseRepository();
    const incident = await createIncident(baseInput, {
      repository,
      dependencyHealth: { askv: false, mapbox: false, push: false },
      findSafetyChain: async () => [31],
      findActiveAdmins: async () => [41],
      notify: vi.fn(),
    });

    expect(incident.persisted).toBe(true);
    expect(incident.degradedCapabilities).toEqual(["askv", "mapbox", "push"]);
    expect((await repository.findIncident(incident.id))?.originalReport).toBe(
      baseInput.originalReport,
    );
  });

  it("uses a sixty-second possible-crash window and escalates after no response", async () => {
    const repository = createInMemorySafetyResponseRepository();
    const notify = vi.fn(async () => undefined);
    const startedAt = new Date("2026-09-14T05:00:00.000Z");
    const incident = await startPossibleCrashCountdown(
      { ...baseInput, source: "possible_crash", startedAt },
      {
        repository,
        dependencyHealth: { askv: true, mapbox: true, push: true },
        findSafetyChain: async () => [31, 32],
        findActiveAdmins: async () => [41],
        notify,
      },
    );

    expect(incident.responseDeadlineAt?.toISOString()).toBe("2026-09-14T05:01:00.000Z");
    const escalated = await escalateIncident(incident.id, new Date("2026-09-14T05:01:01.000Z"), {
      repository,
      notify,
    });
    expect(escalated.status).toBe("escalated");
    expect(notify).toHaveBeenCalledWith([31, 32], expect.objectContaining({ incidentId: incident.id }));
  });

  it("falls back to all active company admins when no safety chain exists", async () => {
    const repository = createInMemorySafetyResponseRepository();
    const notify = vi.fn(async () => undefined);
    const incident = await createIncident(baseInput, {
      repository,
      dependencyHealth: { askv: true, mapbox: true, push: true },
      findSafetyChain: async () => [],
      findActiveAdmins: async () => [41, 42],
      notify,
    });

    expect(incident.safetyChainSnapshot).toEqual([41, 42]);
    expect(incident.configurationWarning).toBe("missing_safety_chain");
  });

  it("keeps the origin immutable while allowing evidence, acknowledgement, holds, and authorized closure", async () => {
    const repository = createInMemorySafetyResponseRepository();
    const incident = await createIncident(baseInput, {
      repository,
      dependencyHealth: { askv: true, mapbox: true, push: true },
      findSafetyChain: async () => [31],
      findActiveAdmins: async () => [],
      notify: vi.fn(async () => undefined),
    });
    await acknowledgeIncident(incident.id, 31, repository);
    await appendIncidentEvidence(incident.id, { actorUserId: 22, kind: "note", value: "Airbags deployed." }, repository);
    await placeEvidenceHold(incident.id, 31, "insurance review", repository);
    await expect(closeIncident(incident.id, { userId: 22, role: "worker" }, repository)).rejects.toThrow("not authorized");
    const closed = await closeIncident(incident.id, { userId: 31, role: "assigned_responder" }, repository);

    expect(closed.status).toBe("closed");
    expect(closed.originalReport).toBe(baseInput.originalReport);
    expect(closed.evidence).toHaveLength(1);
    expect(closed.evidenceHold?.reason).toBe("insurance review");
  });
});
