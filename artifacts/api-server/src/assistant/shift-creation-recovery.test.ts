import { expect, it, vi } from "vitest";
vi.mock("./chatgpt-tool-access", () => ({ chatGptActionTools: (_session: unknown, scopes: string[]) => scopes.includes("work_hub:write") ? [{ name: "manage_work_hub_shift" }] : [] }));
import { recoverWorkHubShiftCreationAction } from "./shift-creation-recovery";
const session = { userId: 17, role: "vendor", vendorId: 4, sv: 1 };
const action = { toolName: "manage_work_hub_shift", tokenHash: "a".repeat(64), arguments: { action: "create", owner: { type: "vendor", id: 4 }, payload: { title: "Synthetic shift", startsAt: "2026-10-07T10:00:00Z", endsAt: "2026-10-07T11:00:00Z", timezone: "UTC", assigneeUserIds: [18], instructions: "Reviewed instruction", budgetAmount: 12.5 } } };
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const resource = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerOrgType: "vendor", ownerOrgId: 4, createdById: 17, title: "Synthetic shift", startsAt: "2026-10-07T10:00:00.000Z", endsAt: "2026-10-07T11:00:00.000Z", timezone: "UTC", assigneeUserIds: [18], open: false, qualificationCodes: [], recurrence: null, calendarType: "company", milestoneStatus: "upcoming", percentComplete: 0, sharedWithUserIds: [], instructions: "Reviewed instruction", budgetAmount: "12.50", projectName: null, dependencyTitle: null, blockers: null, ownerUserId: null, afeCode: null, ticketNumber: null, budgetUsedAmount: null, invoicedAmount: null, invoiceReference: null, siteLocationId: null, gateStationId: null, requiredStaffCount: null, workStartPolicy: null };
const receipt = { operationId, appliedAt: "2026-10-07T09:00:00.000Z", replayed: true, resource };
it("reads only the exact server-derived operation and verifies full saved creation including defaults", async () => {
  const read = vi.fn(async () => ({ receipt }));
  expect(await recoverWorkHubShiftCreationAction(action, session, ["work_hub:write"], read)).toEqual(receipt);
  expect(read).toHaveBeenCalledExactlyOnceWith(`/work-hub/shifts/operations/${operationId}`, "GET", {}, session);
});
it("similar schedules with different reviewed policy, people, actor or original operation remain unresolved", async () => {
  for (const changed of [{ assigneeUserIds: [19] }, { open: true }, { instructions: "Other instruction" }, { budgetAmount: "13.50" }, { createdById: 18 }, { ownerOrgId: 5 }, { sharedWithUserIds: [18] }, { percentComplete: 10 }, { recurrence: { frequency: "daily" } }]) {
    expect(await recoverWorkHubShiftCreationAction(action, session, ["work_hub:write"], vi.fn(async () => ({ receipt: { ...receipt, resource: { ...resource, ...changed } } })))).toBeNull();
  }
  expect(await recoverWorkHubShiftCreationAction(action, session, ["work_hub:write"], vi.fn(async () => ({ receipt: { ...receipt, operationId: resource.id } })))).toBeNull();
});
it("missing, denied and revoked receipts never trigger creation or imply success", async () => {
  const read = vi.fn(async () => ({ receipt: null }));
  expect(await recoverWorkHubShiftCreationAction(action, session, ["work_hub:write"], read)).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  read.mockClear();
  expect(await recoverWorkHubShiftCreationAction(action, session, [], read)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(await recoverWorkHubShiftCreationAction(action, session, ["work_hub:write"], vi.fn(async () => { throw Error("permission withdrawn"); }))).toBeNull();
});
