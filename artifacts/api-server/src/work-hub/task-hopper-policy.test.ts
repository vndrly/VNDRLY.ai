import { describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "../lib/session";
import { taskCreationAccess, isUnassignedTaskCompletion } from "./task-hopper-policy";
vi.mock("@workspace/db", () => ({ db: {} }));
const owner = { type: "vendor" as const, id: 7 };
const session = (vendorRole: string, extra = {}) => ({ userId: 3, role: "vendor", vendorId: 7, membershipRole: "member", vendorRole, ...extra }) as SessionPayload;
describe("company task hopper access", () => {
  it.each(["gatekeeper"])("%s may create only an unassigned task", role => {
    expect(taskCreationAccess(session(role), owner, null)).toBe("hopper");
    expect(() => taskCreationAccess(session(role), owner, 4)).toThrow();
    expect(() => taskCreationAccess(session(role), { ...owner, id: 8 }, null)).toThrow();
  });
  it("retains the supervisor's existing site-scoped assignment path", () => {
    expect(taskCreationAccess(session("gate_supervisor"), owner, 4)).toBe("supervisor");
    expect(taskCreationAccess(session("gate_supervisor"), owner, null)).toBe("hopper");
  });
  it.each([session("office"), session("both"), session("office", { membershipRole: "admin" })])("allows current company managers to assign or leave tasks unassigned", actor => {
    expect(taskCreationAccess(actor, owner, null)).toBe("manager");
    expect(taskCreationAccess(actor, owner, 4)).toBe("manager");
  });
  it("lets a company member complete only the unassigned task, with a resolution and no extra edits", () => {
    const task = { assigneeUserId: null, status: "open" };
    expect(isUnassignedTaskCompletion(task, { action: "complete", resolution: "Repaired" })).toBe(true);
    expect(isUnassignedTaskCompletion({ ...task, assigneeUserId: 8 }, { action: "complete", resolution: "Repaired" })).toBe(false);
    expect(isUnassignedTaskCompletion({ ...task, channelId: "private-channel" }, { action: "complete", resolution: "Repaired" })).toBe(false);
    expect(isUnassignedTaskCompletion(task, { action: "complete", resolution: "Repaired", assigneeUserId: 3 })).toBe(false);
    expect(isUnassignedTaskCompletion(task, { action: "complete", resolution: "" })).toBe(false);
    expect(isUnassignedTaskCompletion({ ...task, status: "completed" }, { action: "complete", resolution: "Repaired" })).toBe(false);
  });
});
