import { expect, it } from "vitest";
import {
  savedGateVisitResourceId,
  verifySavedGateVisitCompletion,
} from "./plan-gate-visit-proof";
const current = {
  id: 7,
  siteLocationId: 392,
  firstName: "Synthetic",
  lastName: "Visitor",
  hostType: "vendor",
  hostVendorId: 1107,
  hostPartnerId: null,
  checkInTime: "2026-10-07T12:00:00Z",
  checkOutTime: null,
  autoCheckedOut: false,
};
const desired = {
  kind: "canonical_gate_visit_action_saved" as const,
  action: "check_in" as const,
  siteLocationId: 392,
  firstName: "Synthetic",
  lastName: "Visitor",
  hostType: "vendor" as const,
  hostId: 1107,
};
const step = {
  id: "entry",
  specialist: "Gate",
  dependsOn: [],
  toolNames: ["confirm_visitor_check_in"],
  completion: desired,
};
const action = {
  state: "completed",
  toolName: "confirm_visitor_check_in",
  executionFingerprint: "trusted-durable-command",
  arguments: {
    siteLocationId: 392,
    firstName: "Synthetic",
    lastName: "Visitor",
    hostType: "vendor",
    hostVendorId: 1107,
  },
  result: JSON.stringify({
    ok: true,
    action: "visitor_checked_in",
    visitId: 7,
  }),
};
it("checks exact accepted check-in identity/site/host using a fresh canonical visit", () => {
  expect(savedGateVisitResourceId(action)).toBe(7);
  expect(verifySavedGateVisitCompletion(step, action, current).resourceId).toBe(
    7,
  );
});
it("refuses prepared, failed, wrong tool/result target and substituted site/person/host", () => {
  for (const bad of [
    { ...action, state: "pending" },
    { ...action, state: "outcome_unknown" },
    { ...action, result: JSON.stringify({ ok: false, error: "Denied" }) },
    {
      ...action,
      result: JSON.stringify({
        ok: true,
        action: "visitor_checked_out",
        visitId: 7,
      }),
    },
    {
      ...action,
      result: JSON.stringify({
        ok: true,
        action: "visitor_checked_in",
        visitId: 8,
      }),
    },
  ])
    expect(() => verifySavedGateVisitCompletion(step, bad, current)).toThrow();
  for (const bad of [
    { ...current, siteLocationId: 393 },
    { ...current, firstName: "Other" },
    { ...current, hostVendorId: 1108 },
    { ...current, checkInTime: null },
  ])
    expect(() => verifySavedGateVisitCompletion(step, action, bad)).toThrow();
  expect(() =>
    verifySavedGateVisitCompletion(step, action, undefined),
  ).toThrow();
});
it("requires explicit exact saved checkout and refuses still-open or automatic expiry records", () => {
  const checkout = {
    ...step,
    toolNames: ["confirm_visitor_check_out"],
    completion: {
      kind: "canonical_gate_visit_action_saved" as const,
      action: "check_out" as const,
      visitId: 7,
      siteLocationId: 392,
    },
  };
  const saved = {
    ...action,
    toolName: "confirm_visitor_check_out",
    arguments: { visitId: 7 },
    result: JSON.stringify({
      ok: true,
      action: "visitor_checked_out",
      visitId: 7,
    }),
  };
  expect(
    verifySavedGateVisitCompletion(checkout, saved, {
      ...current,
      checkOutTime: "2026-10-07T13:00:00Z",
    }).resourceId,
  ).toBe(7);
  expect(() =>
    verifySavedGateVisitCompletion(checkout, saved, current),
  ).toThrow();
  expect(() =>
    verifySavedGateVisitCompletion(checkout, saved, {
      ...current,
      checkOutTime: "2026-10-07T13:00:00Z",
      autoCheckedOut: true,
    }),
  ).toThrow();
  expect(() =>
    verifySavedGateVisitCompletion(
      checkout,
      { ...saved, arguments: { visitId: 8 } },
      { ...current, checkOutTime: "2026-10-07T13:00:00Z" },
    ),
  ).toThrow();
});
