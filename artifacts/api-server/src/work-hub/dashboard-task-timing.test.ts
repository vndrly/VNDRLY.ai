import { describe, expect, it } from "vitest";
import { dashboardTaskTiming } from "./dashboard-task-timing";
const task = { id: "t", status: "completed", createdAt: new Date("2026-10-01") };
const event = (eventType: string, day: number) => ({ taskId: "t", eventType, createdAt: new Date(`2026-10-${day}T12:00:00Z`) });
describe("task assignment and completion boundaries", () => {
  it("ignores later edits, repeated completed status and reassignment after completion", () => {
    const result = dashboardTaskTiming(task, [event("updated", 23), event("assigned", 22), event("status.completed", 21), event("assigned", 20)]);
    expect(result).toEqual({ assignedAt: event("assigned", 20).createdAt, completedAt: event("status.completed", 21).createdAt, completionResolution: null });
  });
  it("uses the latest completion after reopening and leaves missing completion unknown", () => {
    expect(dashboardTaskTiming(task, [event("status.completed", 21), event("status.completed", 23)]).completedAt).toEqual(event("status.completed", 23).createdAt);
    expect(dashboardTaskTiming(task, [])).toEqual({ assignedAt: task.createdAt, completedAt: null, completionResolution: null });
    expect(dashboardTaskTiming({ ...task, status: "in_progress" }, [event("status.completed", 21)]).completedAt).toBeNull();
  });
  it("returns the saved resolution from the completion boundary", () => {
    expect(dashboardTaskTiming(task, [{ ...event("status.completed", 21), detail: { resolution: "Gate camera tested" } }]).completionResolution).toBe("Gate camera tested");
  });
});
