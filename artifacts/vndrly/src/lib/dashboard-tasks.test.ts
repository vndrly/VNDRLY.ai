import { describe, expect, it } from "vitest";
import { dashboardTaskGroup, dashboardTasksForGroup, isStaleDashboardTask, taskElapsed, readDashboardTasks, readDashboardUnassigned, type DashboardTask } from "./dashboard-tasks";
const now = Date.parse("2026-10-23T12:00:00Z"), hour = 3600000;
const task = (hours: number, status = "open"): DashboardTask => ({ id: "t", title: "Inspect", assigneeUserId: 9, status, createdAt: new Date(now - hours * hour).toISOString() });
describe("Dashboard task age and elapsed time", () => {
  it("keeps unassigned gate hopper work out of assigned counts and includes it after assignment or completion", () => {
    const hopper = { ...task(4), assigneeUserId: null, gateHopper: {} };
    expect(dashboardTaskGroup(hopper, true, now)).toBe("unassigned");
    expect(dashboardTaskGroup({ ...hopper, assigneeUserId: 9 }, true, now)).toBe("new");
    expect(dashboardTaskGroup({ ...hopper, status: "completed", gateHopper: { completedById: 9 } }, false, now)).toBe("completed");
  });
  it("moves unstarted work out of New at exactly 48 hours for every viewer", () => {
    for (const company of [true, false]) {
      expect(dashboardTaskGroup(task(47.99), company, now)).toBe("new");
      expect(dashboardTaskGroup(task(48), company, now)).toBe("unstarted");
      expect(dashboardTaskGroup(task(200), company, now)).toBe("unstarted");
      expect(dashboardTaskGroup(task(1, "in_progress"), company, now)).toBe("progress");
    }
  });
  it("places only unfinished tasks older than 30 days in admin Stale without duplicates", () => {
    expect(dashboardTaskGroup(task(720), true, now)).toBe("unstarted");
    for (const status of ["open", "in_progress"]) expect(dashboardTaskGroup(task(720.01, status), true, now)).toBe("stale");
    expect(dashboardTaskGroup(task(800), false, now)).toBe("stale");
    expect(dashboardTaskGroup(task(800, "in_progress"), false, now)).toBe("stale");
    expect(dashboardTaskGroup(task(800, "completed"), true, now)).toBe("completed");
    expect(dashboardTaskGroup(task(800, "cancelled"), true, now)).toBeNull();
  });
  it("keeps old unassigned tasks in their total and the stale view, using task creation age", () => {
    const fresh = { ...task(3), id: "fresh", assigneeUserId: null };
    const old = { ...task(721), id: "old", assigneeUserId: null, assignedAt: new Date(now - hour).toISOString(), gateHopper: {} };
    const boundary = { ...task(720), id: "boundary", assigneeUserId: null };
    const completed = { ...old, id: "done", status: "completed" };
    const removed = { ...old, id: "removed", gateHopper: { clearedAt: new Date(now).toISOString() } };
    const tasks = [old, completed, fresh, removed, boundary];
    expect(dashboardTasksForGroup(tasks, "unassigned", true, now).map(item => item.id)).toEqual(["fresh", "boundary", "old"]);
    expect(dashboardTasksForGroup(tasks, "stale", false, now).map(item => item.id)).toEqual(["old"]);
    expect(isStaleDashboardTask(boundary, now)).toBe(false);
    expect(taskElapsed(old, now)).toBe("30d 1h");
    expect(dashboardTasksForGroup(tasks, "new", true, now)).toEqual([]);
  });
  it("reads all hopper pages for totals, respects denied access and surfaces service failures", async () => {
    expect(await readDashboardUnassigned(async path => ({ tasks: [task(path.includes("before=") ? 800 : 1)], nextBefore: path.includes("before=") ? null : "next" }))).toHaveLength(2);
    expect(await readDashboardUnassigned(async () => { throw Object.assign(new Error("Denied"), { status: 403 }); })).toEqual([]);
    await expect(readDashboardUnassigned(async () => { throw Object.assign(new Error("Unavailable"), { status: 503 }); })).rejects.toThrow("Unavailable");
    await expect(readDashboardUnassigned(async () => ({ tasks: [], nextBefore: "same" }))).rejects.toThrow("Repeated hopper cursor");
  });
  it("uses the assignment time and freezes completion independently of current time", () => {
    const completed = { ...task(80, "completed"), assignedAt: new Date(now - 4 * hour).toISOString(), completedAt: new Date(now - hour).toISOString() };
    expect(taskElapsed(completed, now)).toBe("3h 0m");
    expect(taskElapsed(completed, now + 30 * 24 * hour)).toBe("3h 0m");
    expect(taskElapsed(task(3), now)).toBe("3h 0m");
    expect(taskElapsed(task(3), now + hour)).toBe("4h 0m");
    expect(taskElapsed(task(3, "completed"), now)).toBeNull();
  });
  it("collects all pages for accurate counts and rejects changing permission scope", async () => {
    expect((await readDashboardTasks(async path => path.includes("cursor=") ? { scope: "company", tasks: [task(60)], nextCursor: null } : { scope: "company", tasks: [task(1)], nextCursor: "next" })).tasks).toHaveLength(2);
    await expect(readDashboardTasks(async path => ({ scope: path.includes("cursor=") ? "self" : "company", tasks: [], nextCursor: path.includes("cursor=") ? null : "next" }))).rejects.toThrow("scope changed");
  });
});
