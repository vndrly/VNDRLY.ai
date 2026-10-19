import { describe, expect, it } from "vitest";

const approved = {
  id: 11,
  fromStatus: "pending_review",
  toStatus: "approved",
  reason: "partner_eula_accepted",
  actorUserId: 71,
  createdAt: "2026-10-01T12:00:00Z",
  reasonDetail: null,
};
const lapse = {
  id: 12,
  fromStatus: "approved",
  toStatus: "auto_unapproved",
  reason: "vendor_compliance_updated",
  actorUserId: null,
  createdAt: "2026-10-16T12:00:00Z",
  reasonDetail: {
    fleetDerivation: {
      version: 1,
      derivedReason: "coi_expired",
      complianceOnly: true,
    },
  },
};
const snapshot = {
  version: 1,
  approvalEventId: 11,
  lapseEventId: 12,
  capturedAt: "2026-10-16T12:00:00Z",
  scopes: [{ siteId: 9, workTypeId: 3, serviceApprovalId: 4, assignmentId: 5 }],
};
async function resolver() {
  const module = await import("./fleet-commercial-authority").catch(() => null);
  expect(module, "Fleet commercial authority module").not.toBeNull();
  expect(module!.evaluateFleetRelationshipAuthority).toBeTypeOf("function");
  return module!.evaluateFleetRelationshipAuthority;
}
const input = (overrides: Record<string, unknown> = {}) => ({
  relationshipId: 6,
  status: "auto_unapproved",
  partnerId: 8,
  companyId: 7,
  siteId: 9,
  workTypeId: 3,
  snapshot,
  events: [approved, lapse],
  ...overrides,
});
describe("Fleet document warnings never invent commercial authority", () => {
  it("insurance-only lapse retains exactly the previously approved site and service", async () => {
    const evaluate = await resolver();
    expect(evaluate(input())).toMatchObject({
      allowed: true,
      basis: "prior_approval_compliance_warning",
      approvalSnapshotId: "fleet-approval:6:11:12",
      warnings: ["coi_expired"],
    });
    expect(evaluate(input({ siteId: 10 }))).toMatchObject({
      allowed: false,
      denialCode: "fleet.site_service_not_previously_approved",
    });
    expect(evaluate(input({ workTypeId: 99 }))).toMatchObject({
      allowed: false,
    });
  });
  it("manual revocation and later unapproval cannot be bypassed by the saved snapshot", async () => {
    const evaluate = await resolver();
    for (const status of ["revoked", "unapproved", "pending_review"])
      expect(evaluate(input({ status }))).toMatchObject({ allowed: false });
    for (const reason of [
      "manual_revoke",
      "manual_unapprove",
      "manual_pending_review",
      "vendor_pricing_changed",
      "vendor_catalog_published",
    ])
      expect(
        evaluate(
          input({
            events: [
              approved,
              lapse,
              { ...lapse, id: 13, reason, reasonDetail: null },
            ],
          }),
        ),
      ).toMatchObject({
        allowed: false,
        denialCode: "fleet.commercial_authority_changed",
      });
  });
  it("ambiguous history and reason text alone require reconciliation", async () => {
    const evaluate = await resolver();
    expect(evaluate(input({ snapshot: null }))).toMatchObject({
      allowed: false,
      denialCode: "fleet.approval_reconciliation_required",
    });
    expect(
      evaluate(input({ events: [approved, { ...lapse, reasonDetail: null }] })),
    ).toMatchObject({ allowed: false });
    expect(
      evaluate(input({ events: [{ ...approved, actorUserId: null }, lapse] })),
    ).toMatchObject({ allowed: false });
    expect(evaluate(input({ events: [lapse] }))).toMatchObject({
      allowed: false,
    });
    expect(
      evaluate(
        input({
          events: [approved, { ...lapse, fromStatus: "pending_review" }],
        }),
      ),
    ).toMatchObject({ allowed: false });
  });
  it("later categorized compliance-only recomputes retain warnings without clearing prior red history", async () => {
    const evaluate = await resolver();
    const previous = evaluate(input());
    const renewed = {
      ...lapse,
      id: 13,
      fromStatus: "auto_unapproved",
      reason: "system_recompute",
      reasonDetail: {
        fleetDerivation: {
          version: 1,
          derivedReason: null,
          complianceOnly: true,
        },
      },
    };
    expect(
      evaluate(input({ events: [approved, lapse, renewed] })),
    ).toMatchObject({ allowed: true, warnings: ["coi_expired"] });
    expect(previous).toMatchObject({ warnings: ["coi_expired"] });
    expect(
      evaluate(
        input({
          events: [approved, lapse, { ...renewed, reasonDetail: null }],
        }),
      ),
    ).toMatchObject({ allowed: false });
  });
  it("ordinary current approval remains current authority without enabling other shared approval states", async () => {
    const evaluate = await resolver();
    expect(
      evaluate(input({ status: "approved", snapshot: null, events: [] })),
    ).toMatchObject({ allowed: true, basis: "current_approval", warnings: [] });
    const { ACTIVE_APPROVAL_STATUSES } = await import("@workspace/db");
    expect([...ACTIVE_APPROVAL_STATUSES]).toEqual(["approved"]);
  });
});
