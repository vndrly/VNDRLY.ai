import { expect, it } from "vitest";
import { applyFleetPartnerPolicy } from "./fleet-compliance-policy";

it("allows a red run checkpoint under an enforced Partner preference and retains the warning", async () => {
  const policy = {
    id: "11111111-1111-4111-8111-111111111111", version: 1, mode: "enforced",
    scope: { partnerId: 2, siteId: null, contractId: null, workTypeId: null },
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: null,
    checkpoints: ["dispatch", "start", "office_submit"], notice: "Partner preference",
    existingWorkTreatment: "review_existing", activatedByUserId: 4,
  };
  const client = { query: async () => ({ rows: [{ partner_id: 2, site_location_id: 5, work_type_id: 6, fleet_compliance_policies: { version: 1, policies: [policy] } }] }) };
  const snapshot = { mode: "warn_only", status: "red", evaluatedAt: "2026-10-20T00:00:00.000Z", warnings: [{ category: "regulatory_review", reason: "expired" }] };
  const run = { linkedTicketId: 10, companyId: 3, events: [] };
  await expect(applyFleetPartnerPolicy(client as never, run as never, "start", snapshot as never)).resolves.toMatchObject({
    status: "red", warnings: snapshot.warnings, mode: "warn_only",
  });
});
