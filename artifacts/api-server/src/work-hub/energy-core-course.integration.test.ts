import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {expect, it} from 'vitest';
import {eq} from 'drizzle-orm';
import {LibraryDraftSchema, LibraryMetadataSchema} from '@workspace/api-zod';
import {db, usersTable as users, vendorsTable as vendors, userOrgMembershipsTable as memberships, workHubFormTemplatesTable as templates} from '@workspace/db';
import {assertFreshLocalTestDatabaseEnvironment} from '../../../../scripts/fresh-test-database.mjs';
import {saveLibrary, changeLibraryState, listLibrary, getLibrary} from './library-service';
import {assignLibrary, previewLibraryAssignment, employeeChecklist} from './library-assignments';
import {getAssignedLibrary, submitGuidedTraining, personalEnergySafetyCredentials} from './training-service';
import {safetyTrainingContentHash} from '../lib/safety-training-content-hash';
import {trainingCatalog} from '../lib/company-required-training';
import {prepareTrainingProjections} from '../test-utils/training-projections';

// The protected bank stays outside source control. This test cannot touch a shared DB.
const privateCoursePath = process.env.VNDRLY_PRIVATE_CORE_TEST_FILE;
it.skipIf(!privateCoursePath)('persists the actual Energy Core lessons, remediation, exam and credential under learner permissions', async () => {
  assertFreshLocalTestDatabaseEnvironment(process.env);
  const course = JSON.parse(readFileSync(privateCoursePath!, 'utf8'));
  const content = LibraryDraftSchema.parse(course.content);
  const contract = trainingCatalog.curriculum.find(c => c.id === 'G99')!;
  expect(safetyTrainingContentHash(content)).toBe(contract.contentSha256);
  expect(course.sourceSha256).toBe(contract.sourceSha256);
  const [vendor] = await db.insert(vendors).values({name: 'Synthetic curriculum test ' + randomUUID(), contactName: 'Synthetic', contactEmail: randomUUID() + '@example.invalid'}).returning();
  async function person(role: 'admin' | 'member') {
    const [user] = await db.insert(users).values({username: randomUUID(), displayName: 'Synthetic learner', passwordHash: 'test-only', role: 'vendor'}).returning();
    const [membership] = await db.insert(memberships).values({userId: user.id, orgType: 'vendor', vendorId: vendor.id, role}).returning();
    return {userId: user.id, role: 'vendor', vendorId: vendor.id, activeMembershipId: membership.id, membershipRole: role, sv: user.sessionVersion, source: 'web' as const};
  }
  const admin = await person('admin'), learner = await person('member'), unassigned = await person('member');
  const owner = {type: 'vendor' as const, id: vendor.id};
  const command = (payload: unknown, expectedVersion = 0) => ({operationId: randomUUID(), owner, context: {kind: 'organization' as const, id: vendor.id}, payloadVersion: 1 as const, payload, expectedVersion});
  const created = await saveLibrary(admin, command(content));
  const itemId = String(created.resource.itemId);
  await changeLibraryState(admin, itemId, command({}), 'publish');
  const [row] = await db.select().from(templates).where(eq(templates.id, itemId));
  const metadata = LibraryMetadataSchema.parse(row.libraryMetadata);
  metadata.safetyResource = {familyId: 'G99', categoryId: course.categoryId, resourceType: 'training', sourceVersion: course.sourceVersion, sourceSha256: course.sourceSha256};
  await db.update(templates).set({libraryMetadata: metadata}).where(eq(templates.id, itemId));
  await prepareTrainingProjections(() => listLibrary(learner, false, true));
  const available = await listLibrary(learner, false, true);
  expect(available.items.some(item => item.itemId === itemId)).toBe(true);
  expect(available.items.find(item => item.itemId === itemId)).toMatchObject({familyId: 'G99', canManage: false});
  const publicCourse = await getLibrary(learner, itemId);
  expect(JSON.stringify(publicCourse)).not.toContain('correctOptionIds');
  expect(JSON.stringify(publicCourse)).not.toContain('ECORE_PRIVATE_');
  const request = {itemId, audience: {mode: 'selected' as const, userIds: [learner.userId], groupIds: []}};
  const preview = await previewLibraryAssignment(admin, request);
  await assignLibrary(admin, command({...request, previewFingerprint: preview.previewFingerprint}, preview.version));
  const checklist = await employeeChecklist(learner);
  expect(checklist.items).toHaveLength(1);
  const instanceId = checklist.items[0].instanceId;
  expect(checklist.items[0].href).toBe(`/work-hub/training/${instanceId}`);
  await expect(getAssignedLibrary(unassigned, instanceId)).rejects.toBeTruthy();
  let read = await getAssignedLibrary(learner, instanceId);
  const act = async (payload: unknown) => {
    await submitGuidedTraining(learner, instanceId, command(payload, read.version));
    read = await getAssignedLibrary(learner, instanceId); // persisted read, not mutation return
  };
  await expect(submitGuidedTraining(learner, instanceId, command({action: 'exam_start'}, read.version))).rejects.toThrow('Complete all learning');
  let remediated = false;
  for (const step of content.training!.guided!.steps) {
    for (const id of step.questionIds) {
      const q = content.training!.questions.find(q => q.id === id)!;
      if (!remediated) {
        const wrong = q.options.find(o => !q.correctOptionIds.includes(o.id))!;
        await act({action: 'answer', questionId: id, optionIds: [wrong.id]});
        await expect(submitGuidedTraining(learner, instanceId, command({action: 'advance', acknowledged: true}, read.version))).rejects.toBeTruthy();
        await act({action: 'remediate', questionId: id, acknowledged: true});
        expect(read.assignment.progress.guided!.responses[id].originalOptionIds).toEqual([wrong.id]);
        remediated = true;
      } else await act({action: 'answer', questionId: id, optionIds: q.correctOptionIds});
    }
    if (!step.questionIds.length) await act({action: 'advance', acknowledged: true});
  }
  expect(read.assignment.status).toBe('completed');
  expect((await employeeChecklist(learner)).items[0].examPending).toBe(true);
  expect((await personalEnergySafetyCredentials(learner)).credentials).toHaveLength(0);
  await act({action: 'exam_start'});
  const attemptId = read.certificationExam!.attempt!.id;
  expect(read.certificationExam!.questions).toHaveLength(40);
  expect(JSON.stringify(read.certificationExam)).not.toContain('correctOptionIds');
  for (const q of read.certificationExam!.questions) {
    const authored = content.training!.certificationExam!.questions.find(item => item.id === q.id)!;
    await act({action: 'exam_answer', attemptId, questionId: q.id, optionIds: authored.correctOptionIds});
  }
  expect(read.certificationExam!.attempt!.submittedAt).toBeNull();
  await act({action: 'exam_submit', attemptId});
  expect(read.certificationExam!.attempt).toMatchObject({passed: true, score: 100});
  expect((await employeeChecklist(learner)).items[0].examPending).toBe(false);
  expect((await personalEnergySafetyCredentials(learner)).credentials).toEqual(expect.arrayContaining([expect.objectContaining({familyId: 'G99', courseSha256: course.sourceSha256})]));
  expect((await personalEnergySafetyCredentials(unassigned)).credentials).toHaveLength(0);
}, 120_000);
