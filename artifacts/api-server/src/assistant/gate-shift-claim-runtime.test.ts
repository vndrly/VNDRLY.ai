import { expect, it } from "vitest";
import { bindWorkHubToolScope, resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
const shiftId = "11111111-1111-4111-8111-111111111111", operationId = "22222222-2222-4222-8222-222222222222";
const session = { userId: 9, role: "field_employee", vendorId: 4, sv: 1, vendorPeopleId: 12 };
it("forwards exact trusted Gate claim operation and reviewed version only after approval", () => {
  const args = { ...bindWorkHubToolScope({ action: "claim", shiftId, expectedVersion: 3 }, session, "manage_work_hub_shift"), operationId };
  expect(resolveExecutableWorkHubToolRequest("manage_work_hub_shift", args, false, session)).toHaveProperty("error");
  expect(resolveExecutableWorkHubToolRequest("manage_work_hub_shift", args, true, session)).toMatchObject({ method: "POST", path: `/work-hub/shifts/${shiftId}/claim`, body: { operationId, expectedVersion: 3 } });
  for (const expectedVersion of [0, -1, "3", 1.5])
    expect(resolveExecutableWorkHubToolRequest("manage_work_hub_shift", { ...args, expectedVersion }, true, session)).toHaveProperty("error");
  expect(resolveExecutableWorkHubToolRequest("manage_work_hub_shift", { ...args, operationId: "model-proof" }, true, session)).toHaveProperty("error");
});
it("retains legacy unversioned non-Gate claim routing without fabricating Gate version authority", () => {
  for (const expectedVersion of [undefined, null])
    expect(resolveExecutableWorkHubToolRequest("manage_work_hub_shift", { action: "claim", shiftId, expectedVersion, operationId }, true, session)).toMatchObject({ method: "POST", path: `/work-hub/shifts/${shiftId}/claim`, body: {} });
});
