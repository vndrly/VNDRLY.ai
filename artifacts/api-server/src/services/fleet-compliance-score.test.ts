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

  it("retains a capped category total across 26 failing records without invalid zero-point deductions", () => {
    const records = Array.from({ length: 26 }, (_, index) => ({ ...expired, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    const result = projectFleetComplianceScore(3, records, "2026-10-20T00:00:00.000Z");
    expect(result.deductions).toHaveLength(29);
    expect(result.deductions.filter((item) => item.category === "driver_license").reduce((sum, item) => sum + item.points, 0)).toBe(25);
    expect(result.deductions.some((item) => item.points === 0)).toBe(true);
    expect(result.deductions.filter((item) => item.category === "driver_license").every((item) => item.estimatedImprovement === 0)).toBe(true);
    expect(result.categoryTotals?.find((item) => item.category === "driver_license")?.pointsEarned).toBe(0);
  });

  it("keeps a small mixed-category deduction and bounds a multipage company response", async () => {
    const at = "2026-10-20T00:00:00.000Z";
    const records = Array.from({ length: 150 }, (_, index) => ({
      ...expired,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      status: index === 0 ? "red" as const : "green" as const,
      validUntil: index === 0 ? expired.validUntil : "2027-10-01T00:00:00.000Z",
    }));
    const mixed = projectFleetComplianceScore(3, records.slice(0, 50), at);
    expect(mixed.deductions.find((item) => item.category === "driver_license")?.points).toBe(1);
    expect(mixed.categoryTotals?.find((item) => item.category === "driver_license")?.pointsEarned).toBe(24);
    const failing = records.map((record) => ({ ...record, status: "red" as const, validUntil: expired.validUntil }));
    const pages = [failing.slice(0, 100), failing.slice(100)];
    const register = { readFleetComplianceRegister: async (_actor: unknown, query: { after?: string }) => query.after ? { entries: pages[1], nextCursor: null } : { entries: pages[0], nextCursor: failing[99].id } };
    const result = await readFleetComplianceScore({ userId: 7, companyId: 3 } as never, register as never, async () => new Set<FleetCapability>(["office"]));
    expect(result.deductions.length).toBeLessThanOrEqual(100);
    expect(result.partnerPreview?.reasons.length).toBeLessThanOrEqual(100);
    expect(result.remainingIssueCount).toBeGreaterThan(0);
    expect(result.estimatedResolvedScore).toBe(16);
    expect(result.score + result.deductions.reduce((sum, item) => sum + item.points, 0)).toBeLessThanOrEqual(100);
  });
});
