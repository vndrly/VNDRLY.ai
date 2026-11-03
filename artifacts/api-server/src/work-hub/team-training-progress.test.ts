import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@workspace/db", async original => {
  const actual = await original<any>();
  return { ...actual, db: { select: () => { let table: unknown; const chain: any = { from: (value: unknown) => { table = value; return chain; }, innerJoin: () => chain, where: async () => table === actual.workHubFormTemplatesTable ? state.rows.map(row => ({ id: row.templateId, title: row.title, version: row.version })) : state.rows }; return chain; } } };
});
vi.mock("./library-audience", () => ({ companyLibraryPeople: async () => [{ userId: 7, membershipId: 9, name: "Learner" }, { userId: 8, membershipId: 10, name: "No assignments" }] }));
import { canViewTeamTraining, companyTrainingProgress } from "./team-training-progress";
const row = (overrides = {}) => ({ id: "assignment", userId: 7, templateId: "course", title: "Course", version: 1, metadata: { membershipId: 9, status: "assigned", contentVersion: 1, assignedAt: "2026-11-01T00:00:00Z" }, ...overrides });
beforeEach(() => { state.rows = []; });
it("allows admins and Training Coordinators, not ordinary office staff", () => {
  expect(canViewTeamTraining("admin", [])).toBe(true);
  expect(canViewTeamTraining("member", ["Training Coordinator"])).toBe(true);
  expect(canViewTeamTraining("member", ["Office Staff"])).toBe(false);
  expect(canViewTeamTraining("field_employee", [])).toBe(false);
});
it("includes people with no assignments and omits former memberships and withdrawn assignments", async () => {
  state.rows = [row(), row({ id: "former", userId: 123 }), row({ id: "cancelled", metadata: { ...row().metadata, status: "cancelled" } }), row({ id: "old-membership", metadata: { ...row().metadata, membershipId: 8 } })];
  const result = await companyTrainingProgress({ type: "vendor", id: 1 });
  expect(result.people.find(person => person.userId === 7)?.courses.map(course => course.id)).toEqual(["assignment"]);
  expect(result.people.find(person => person.userId === 8)?.courses).toEqual([]);
});
it("uses the latest assignment for each current course revision", async () => {
  state.rows = [row({ metadata: { ...row().metadata, status: "completed" } }), row({ id: "renewal", metadata: { ...row().metadata, assignedAt: "2026-11-02T00:00:00Z" } }), row({ id: "old-version", metadata: { ...row().metadata, contentVersion: 2 } })];
  const result = await companyTrainingProgress({ type: "vendor", id: 1 });
  expect(result.people.find(person => person.userId === 7)?.courses).toEqual([expect.objectContaining({ id: "renewal", complete: false })]);
});
