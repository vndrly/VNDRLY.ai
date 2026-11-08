import { beforeEach, expect, it, vi } from "vitest";
const { storedTrainingProjection } = vi.hoisted(() => ({ storedTrainingProjection: vi.fn(async (_key: string, compute: () => Promise<unknown>) => compute()) }));
vi.mock('./stored-training-projections', () => ({ storedTrainingProjection }));
const state = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@workspace/db", async original => {
  const actual = await original<any>();
  return { ...actual, db: { select: () => { let table: unknown; const chain: any = { from: (value: unknown) => { table = value; return chain; }, innerJoin: () => chain, where: async () => table === actual.workHubFormTemplatesTable ? state.rows.map(row => ({ id: row.templateId, title: row.title, version: row.version })) : state.rows }; return chain; } } };
});
vi.mock("./library-audience", () => ({ companyLibraryPeople: async () => [{ userId: 7, membershipId: 9, name: "Learner" }, { userId: 8, membershipId: 10, name: "No assignments" }] }));
import { canViewTeamTraining, companyTrainingProgress, personTrainingStatus } from "./team-training-progress";
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
it.each([[7,"#22c55e"],[7.01,"#f59e0b"],[14,"#f59e0b"],[14.01,"#f87171"]])('computes the scheduled status at %s days in the projector',(days,color)=>{
 const now=Date.parse('2026-11-07T12:00:00Z');
 expect(personTrainingStatus([{id:'c',title:'C',complete:false,assignedAt:new Date(now-days*86_400_000).toISOString()}],now).color).toBe(color);
});
it('returns persisted team data without reading source assignments',async()=>{
 const source={select:vi.fn()} as any;
 const saved={people:[],completedCount:0,totalCount:0,percent:0,percentLabel:'—'};
 vi.mocked(storedTrainingProjection).mockResolvedValueOnce(saved);
 expect(await companyTrainingProgress({type:'vendor',id:3},source)).toEqual(saved);
 expect(source.select).not.toHaveBeenCalled();
 expect(storedTrainingProjection).toHaveBeenLastCalledWith('vendor:3:team',expect.any(Function));
});
it('stores all individual and team display values',async()=>{
 state.rows=[row({metadata:{...row().metadata,status:'completed'}})];
 const result=await companyTrainingProgress({type:'vendor',id:1});
 expect(result).toMatchObject({completedCount:1,totalCount:1,percent:100,percentLabel:'100%'});
 expect(result.people[0]).toMatchObject({userId:7,percentLabel:'100%',status:{label:'Completed',rank:2}});
 expect(result.people[1]).toMatchObject({userId:8,percentLabel:'—',status:{label:'No assigned training',rank:3}});
});
