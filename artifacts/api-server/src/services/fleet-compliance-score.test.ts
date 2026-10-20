import { describe, expect, it } from "vitest";
import { FleetComplianceScoreSchema, type FleetCapability, type FleetComplianceOperationalEntry } from "@workspace/api-zod";
import { readFleetComplianceScore, projectFleetComplianceScore } from "./fleet-compliance-score";

const expired: Pick<FleetComplianceOperationalEntry, "id" | "subject" | "kind" | "verification" | "status" | "reasons" | "validUntil" | "evaluatedAt"> = {
  id: "11111111-1111-4111-8111-111111111111",
  subject: { kind: "driver", id: 7 },
  kind: "driver_license",
  verification: "verified",
  status: "red",
  reasons: ["expired"],
  validUntil: "2026-10-01T00:00:00.000Z",
  evaluatedAt: "2026-10-20T00:00:00.000Z",
};

describe("Fleet compliance score", () => {
  it("explains a red score, ranks expired evidence, and shows an honest Partner preview", () => {
    const result = projectFleetComplianceScore(3, [expired], "2026-10-20T00:00:00.000Z");
    expect(result.advisoryOnly).toBe(true);
    expect(result.status).toBe("red");
    expect(result.score).toBeLessThan(60);
    expect(result.deductions[0]).toMatchObject({
      id: expired.id,
      category: "driver_license",
      urgency: "now",
      responsibleCapability: "office",
    });
    expect(result.deductions[0].remediation).toBeTruthy();
    expect(result.deductions[0].evidenceDestination).toBeTruthy();
    expect(result.estimatedResolvedScore).toBeGreaterThan(result.score);
    expect(result.partnerPreview).toMatchObject({ score: result.score, status: "red", advisoryOnly: true });
    expect(JSON.stringify(result.partnerPreview)).not.toContain(expired.id);
    expect(FleetComplianceScoreSchema.parse(result)).toMatchObject({
      estimatedResolvedScore: result.estimatedResolvedScore,
      partnerPreview: result.partnerPreview,
    });
  });

  it("does not claim green compliance when no records exist", () => {
    const result = projectFleetComplianceScore(3, [], "2026-10-20T00:00:00.000Z");
    expect(result.score).toBe(0);
    expect(result.status).toBe("red");
    expect(result.deductions).toHaveLength(4);
    expect(result.deductions.every((item) => item.reason.includes("No current evidence"))).toBe(true);
  });

  it("requires a current score-viewing capability before reading the register", async () => {
    const register = { readFleetComplianceRegister: async () => ({ entries: [expired], nextCursor: null }) };
    const actor = { userId: 7, companyId: 3 };
    await expect(readFleetComplianceScore(actor as never, register as never, async () => new Set<FleetCapability>(["driver"]))).rejects.toMatchObject({ status: 403 });
    await expect(readFleetComplianceScore(actor as never, register as never, async () => new Set<FleetCapability>(["office"]))).resolves.toMatchObject({ advisoryOnly: true, score: 0 });
  });
});
