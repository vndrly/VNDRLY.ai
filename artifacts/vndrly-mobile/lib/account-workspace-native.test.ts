import { expect, it } from "vitest";
import { nativeAccountWorkspaces } from "./account-workspace-native";
const user = { id: 6, role: "vendor", vendorId: 11, vendorRole: "office", username: "synthetic", displayName: null };
it("offers only current company Fleet capabilities and keeps Field work separate", () => {
  const cards = nativeAccountWorkspaces(user, ["field", "fleet"], { orgType: "vendor", orgId: 11, role: "admin" }, { companyId: 11, enabled: true, capabilities: { canDrive: true, canDispatch: false, canManage: false, canManageResources: false } });
  expect(cards.flatMap(card => card.actions).map(action => action.href)).toContain("/(tabs)/fleet?module=driver");
  expect(cards.flatMap(card => card.actions).map(action => action.href)).not.toContain("/(tabs)/fleet?module=dispatch");
  expect(cards.map(card => card.title)).toContain("Field workspace");
  expect(nativeAccountWorkspaces(user, ["fleet"], { orgType: "vendor", orgId: 11, role: "admin" }, { companyId: 22, enabled: true, capabilities: { canDrive: true } }).some(card => card.title === "Fleet workspace")).toBe(false);
});
it("does not expose employee administration to a gatekeeper or grant a field workspace to Fleet-only companies", () => {
  const gate = nativeAccountWorkspaces({ ...user, vendorRole: "gatekeeper" }, ["gate"], { orgType: "vendor", orgId: 11, role: "member" });
  expect(gate.flatMap(card => card.actions).some(action => action.href === "/employees")).toBe(false);
  expect(gate.map(card => card.title)).toContain("Gate workspace");
  expect(nativeAccountWorkspaces(user, ["fleet"]).map(card => card.title)).not.toContain("Field workspace");
});
it("keeps sponsored workers in their authorized hours and Gate workspace", () => {
  const cards = nativeAccountWorkspaces({ ...user, managedSubcontractor: { siteGrants: [{ siteId: 1, role: "gatekeeper" }] } }, ["field", "fleet", "gate"]);
  expect(cards.map(card => card.title)).toEqual(["My hours", "Gate workspace"]);
});
