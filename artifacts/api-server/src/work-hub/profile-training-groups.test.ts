import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as any[], bundles: [] as any[], prior: [] as any[], updates: [] as any[] }));
vi.mock("@workspace/db", () => {
  const reader = () => {
    const q: any = { from: () => q, innerJoin: () => q, where: () => q, orderBy: () => q,
      limit: async () => state.rows, for: async () => state.prior,
      then: (resolve: any, reject: any) => Promise.resolve(state.bundles).then(resolve, reject) };
    return q;
  };
  return { db: { select: reader }, workHubFormTemplatesTable: { id: "template-id", name: "name", libraryMetadata: "metadata", ownerOrgType: "owner-type", ownerOrgId: "owner-id" },
    workHubFormInstancesTable: { id: "instance-id", templateId: "template-id", assigneeUserId: "user", createdAt: "created", definitionSnapshot: "snapshot" }, workHubFormSubmissionsTable: {} };
});
vi.mock("./library-core", () => ({ libraryAuthority: async () => ({ owner: { type: "vendor", id: 1054 }, member: { id: 7 } }),
  libraryRecord: vi.fn(), libraryCommand: vi.fn(), checkLibraryVersion: vi.fn(), LibraryError: class extends Error {} }));
vi.mock("./library-audience", () => ({ expandLibraryAudience: vi.fn(), companyLibraryPeople: vi.fn() }));
vi.mock("./form-campaign-service", () => ({ queueCampaignNotice: vi.fn() }));
vi.mock("./live-meeting-fingerprint", () => ({ liveMeetingFingerprint: vi.fn() }));
vi.mock("./library-policy", () => ({ assignmentDeadline: vi.fn(), safeLibraryContent: vi.fn(), publicTraining: vi.fn(), shouldReuseLibraryAssignment: () => true }));
import { allocateLibraryItems, employeeChecklist } from "./library-assignments";
import { trainingAssignmentPercent } from "./training-assignment-progress";
import { AssignmentMetadataSchema } from "@workspace/api-zod";
const course = "11111111-1111-4111-8111-111111111111";
const first = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";
const instance = "44444444-4444-4444-8444-444444444444";
const metadata = (extra: Record<string, unknown> = {}) => ({ assignmentId: instance, sourceItemId: course, contentVersion: 1, membershipId: 7,
  assignedAt: "2026-11-18T12:00:00Z", dueAt: "2026-11-20T12:00:00Z", ...extra });
beforeEach(() => { state.rows = []; state.bundles = []; state.prior = []; state.updates = []; });
it("returns only actual certification links and preserves individual training", async () => {
  state.rows = [{ instance: { id: instance, assignmentMetadata: metadata() }, template: { name: "H2S course", libraryMetadata: { kind: "training", seriesId: course, contentVersion: 1 } } }];
  let result = await employeeChecklist({ userId: 4 } as any);
  expect(result.items[0].certifications).toEqual([]);
  expect(result.items[0].individuallyAssigned).toBe(true);
  state.rows[0].instance.assignmentMetadata = metadata({ sourceItemId: first, bundleId: first, bundleVersion: 1, bundleAssignments: [{ bundleId: second, bundleVersion: 1 }] });
  state.bundles = [{ id: first, title: "Certification A" }, { id: second, title: "Certification B" }];
  result = await employeeChecklist({ userId: 4 } as any);
  expect(result.items[0].certifications.map(c => c.title)).toEqual(["Certification A", "Certification B"]);
  expect(result.items[0].individuallyAssigned).toBe(false);
});
it("keeps one completed course instance when another certification includes it", async () => {
  state.prior = [{ id: instance, assignmentMetadata: metadata({ sourceItemId: first, bundleId: first, bundleVersion: 1, status: "completed" }) }];
  const query: any = { from: () => query, where: () => query, orderBy: () => query, for: async () => state.prior };
  const tx: any = { select: () => query, update: () => ({ set: (value: any) => { state.updates.push(value); return { where: async () => undefined }; } }),
    insert: () => { throw Error("Must reuse the existing course"); } };
  const root: any = { record: { id: second }, metadata: { kind: "bundle", contentVersion: 1 } };
  const items: any = [{ record: { id: course }, metadata: { kind: "training", contentVersion: 1 }, entry: {} }];
  const result = await allocateLibraryItems(tx, root, items, [{ userId: 4, membershipId: 7 }] as any, false, new Date());
  expect(result.reused).toEqual([instance]);
  expect(result.assigned).toEqual([]);
  expect(state.updates[0].assignmentMetadata.bundleAssignments).toEqual([{ bundleId: first, bundleVersion: 1 }, { bundleId: second, bundleVersion: 1 }]);
  expect(state.updates[0].assignmentMetadata.status).toBe("completed");
});

it("calculates partial completion from saved lessons without reporting an unfinished course as complete", () => {
  const course={lessonCount:2,questionCount:0,guidedStepCount:0,completionMode:"checkoff"};
  const assignment=AssignmentMetadataSchema.parse(metadata({status:"in_progress",progress:{lessonIds:["lesson-one"],answers:{}}}));
  expect(trainingAssignmentPercent(assignment,course,false)).toBe(50);
  assignment.progress.lessonIds.push("lesson-two");
  expect(trainingAssignmentPercent(assignment,course,false)).toBe(99);
  assignment.status="completed";
  expect(trainingAssignmentPercent(assignment,course,false)).toBe(100);
});

it("includes a pending final exam in guided-course completion", () => {
  const assignment=AssignmentMetadataSchema.parse(metadata({status:"completed",progress:{guided:{step:3,responses:{}}}}));
  const course={lessonCount:3,questionCount:10,guidedStepCount:3,completionMode:"both"};
  expect(trainingAssignmentPercent(assignment,course,true)).toBe(75);
  expect(trainingAssignmentPercent(assignment,course,false)).toBe(100);
});
