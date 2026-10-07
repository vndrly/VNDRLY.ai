import { expect, it, vi } from "vitest";
import { readExactPlanTask } from "./coordinated-plan-exact-task";
const taskId = "11111111-1111-4111-8111-111111111111", identity = { userId: 17, organizationKey: "vendor:4" };
const task = { id: taskId, subjectType: "task", ownerOrgType: "vendor", ownerOrgId: 4, version: 7, description: "saved-plan", status: "open" };
it("reads the exact authorized task beyond any list page without requesting a list", async () => {
 const request = vi.fn().mockResolvedValue(task);
 expect(await readExactPlanTask(request, taskId, identity)).toMatchObject({ id: taskId, version: 7, description: "saved-plan" });
 expect(request.mock.calls).toEqual([[`/work-hub/search/items/task/${taskId}`]]);
});
it("refuses foreign owner, substituted identity, unavailable response and missing CAS metadata", async () => {
 for (const response of [{ ...task, ownerOrgId: 5 }, { ...task, id: "22222222-2222-4222-8222-222222222222" }, { ...task, subjectType: "note" }, { ...task, version: undefined }, { ok: false, status: 404, error: "Unavailable" }])
  await expect(readExactPlanTask(vi.fn().mockResolvedValue(response), taskId, identity)).rejects.toThrow();
});
