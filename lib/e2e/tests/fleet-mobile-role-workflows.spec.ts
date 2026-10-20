import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");

const roles = [
  { name: "Admin", capabilities: ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"] },
  { name: "Office", capabilities: ["office"] },
  { name: "Dispatch", capabilities: ["dispatch"] },
  { name: "Yard", capabilities: ["yard"] },
  { name: "Driver", capabilities: ["driver"] },
  { name: "Driver + Yard", capabilities: ["driver", "yard"] },
  { name: "Driver + Self-Dispatch", capabilities: ["driver", "self_dispatch"] },
  { name: "Independent", capabilities: ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"] },
] as const;

for (const viewport of [{ name: "phone", width: 390, height: 844 }, { name: "iPad", width: 1024, height: 1366 }]) {
  test(`${viewport.name} accepts every Fleet capability composition without hiding ticket flow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const result = await page.evaluate(async ({ moduleUrl, roles }) => {
      const api = await import(moduleUrl);
      return roles.map((role: { name: string; capabilities: string[] }, index: number) => {
        const projection = api.FleetHomeProjectionSchema.parse({
          companyId: 1114,
          userId: index + 1,
          mode: role.name === "Independent" ? "my_fleet_day" : "coordinated",
          capabilities: role.capabilities,
          nextAction: { kind: role.capabilities.includes("yard") ? "report_yard_order" : "start_run", label: "Continue ticket work", runId: "11111111-1111-4111-8111-111111111111", ...(role.capabilities.includes("yard") ? { yardOrderId: "22222222-2222-4222-8222-222222222222" } : {}) },
          priorities: [],
          warnings: [{ id: "33333333-3333-4333-8333-333333333333", message: "Insurance evidence needs review" }],
          moduleStates: [
            { module: "dispatch", state: "ready" }, { module: "yard", state: "ready" },
            { module: "assets", state: "ready" }, { module: "map", state: "ready" },
            { module: "history", state: "ready" }, { module: "compliance", state: "unavailable" },
          ],
        });
        return { name: role.name, next: projection.nextAction?.label, compliance: projection.moduleStates.find((item: { module: string }) => item.module === "compliance")?.state, dispatch: projection.moduleStates.find((item: { module: string }) => item.module === "dispatch")?.state };
      });
    }, { moduleUrl: `/@fs/${root}lib/api-zod/src/fleet-mobile-workflows.ts`, roles });
    expect(result).toHaveLength(roles.length);
    for (const row of result) {
      expect(row.next).toBe("Continue ticket work");
      expect(row.compliance).toBe("unavailable");
      expect(row.dispatch).toBe("ready");
    }
  });
}

test("browser recovery keeps the original Fleet operation and Partner score advisory", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ offlineUrl, schemaUrl }) => {
    const offline = await import(offlineUrl);
    const api = await import(schemaUrl);
    const memory = new Map<string, string>();
    const store = offline.createFleetOfflineStore({
      getItem: async (key: string) => memory.get(key) ?? null,
      setItem: async (key: string, value: string) => { memory.set(key, value); },
      removeItem: async (key: string) => { memory.delete(key); },
    });
    const scope = { userId: 4, companyId: 1114, membershipId: 9, sessionVersion: 3 };
    const runId = "11111111-1111-4111-8111-111111111111";
    const operationId = "22222222-2222-4222-8222-222222222222";
    const assetId = "33333333-3333-4333-8333-333333333333";
    await store.enqueue(scope, { sessionVersion: 3, membershipId: 9, runId, base: { runId, companyId: 1114, driverUserId: 4, vehicleAssetId: assetId, trailerAssetId: null, version: 1 }, input: { action: "acknowledge", operationId, expectedVersion: 1, capturedAt: "2026-10-20T12:00:00.000Z" }, capturedAt: "2026-10-20T12:00:00.000Z", state: "unsynced" });
    const recovered = await store.read(scope);
    const score = api.FleetComplianceScoreSchema.parse({ companyId: 1114, score: 68, status: "red", advisoryOnly: true, evaluatedAt: "2026-10-20T12:05:00.000Z", categories: [{ category: "insurance", score: 68 }], deductions: [{ id: "44444444-4444-4444-8444-444444444444", category: "insurance", points: 32, reason: "Evidence needs review", reasonCode: "requires_review", urgency: "soon", estimatedImprovement: 32, remediation: "Review current insurance evidence", remediationCode: "review_insurance", evidenceDestination: "Compliance records", responsibleCapability: "office", dueAt: null }], history: [], partnerPreview: { score: 68, status: "red", advisoryOnly: true, evaluatedAt: "2026-10-20T12:05:00.000Z", categories: [{ category: "insurance", score: 68 }], reasons: [{ category: "insurance", reason: "Evidence needs review", reasonCode: "requires_review" }] } });
    return { operationId: recovered.actions[0]?.input.operationId, state: recovered.actions[0]?.state, advisoryOnly: score.partnerPreview?.advisoryOnly, score: score.partnerPreview?.score };
  }, { offlineUrl: `/@fs/${root}artifacts/vndrly-mobile/lib/fleet-offline.ts`, schemaUrl: `/@fs/${root}lib/api-zod/src/fleet-mobile-workflows.ts` });
  expect(result).toEqual({ operationId: "22222222-2222-4222-8222-222222222222", state: "unsynced", advisoryOnly: true, score: 68 });
});
