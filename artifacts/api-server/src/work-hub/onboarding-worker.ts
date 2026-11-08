import { runLibraryDeliveryWork } from "./library-delivery-worker";
import {assignPolicyTraining} from './training-course-policy';
import {runRequiredTrainingWork} from './required-training';
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import {
  db,
  runWithTrainingWorkerDatabase,
  workHubFormTemplatesTable as templates,
  workHubFormInstancesTable as instances,
  usersTable as users,
  userOrgMembershipsTable as memberships,
  notificationPreferencesTable as preferences,
} from "@workspace/db";
import {
  LibraryMetadataSchema,
  BundleDefinitionSchema,
  AssignmentMetadataSchema,
  type WorkHubOwner,
} from "@workspace/api-zod";
import { savedBundleItems, onboardingPeople } from "./onboarding-service";
import { allocateLibraryItems } from "./library-assignments";
import { companyLibraryPeople } from "./library-audience";
let timer: ReturnType<typeof setInterval> | null = null,
  running = false;
const WORKER_PAGE_SIZE = 25;
let bundleCursor: string | undefined,
  refresherCursor: string | undefined,
  policyCursor: string | undefined;
export async function runOnboardingWork(now = new Date()) {
  if (running) return 0;
  running = true;
  try {
    return await db.transaction(async (tx) => {
      const lock = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${"work-hub:onboarding-worker"})) AS acquired`,
      );
      if (lock.rows[0]?.acquired !== true) return 0;
      const dueAt = now.toISOString();
      const bundleBoundary = bundleCursor
        ? sql`WHERE candidate.id > ${bundleCursor}`
        : sql``;
      const bundlePage = await tx.execute<{ id: string; eligible: boolean }>(sql`
        WITH candidate_page AS MATERIALIZED (
          SELECT candidate.id,candidate.library_metadata,candidate.bundle_definition
          FROM work_hub_form_templates candidate
          ${bundleBoundary}
          ORDER BY candidate.id
          LIMIT ${WORKER_PAGE_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        SELECT candidate.id,
          (candidate.bundle_definition IS NOT NULL
            AND candidate.library_metadata->>'kind'='bundle'
            AND candidate.library_metadata->>'state'='published'
            AND candidate.bundle_definition->'onboarding'->>'enabled'='true'
            AND coalesce(candidate.bundle_definition->'onboarding'->>'nextScanAt','1970-01-01T00:00:00.000Z')<=${dueAt}) AS eligible
        FROM candidate_page candidate
        ORDER BY candidate.id
      `);
      bundleCursor = bundlePage.rows.at(-1)?.id;
      let assigned = 0;
      for (const candidate of bundlePage.rows.filter((row) => row.eligible)) {
        const [record] = await tx
          .select()
          .from(templates)
          .where(eq(templates.id, candidate.id))
          .limit(1);
        if (!record) continue;
        try {
          const result = await tx.transaction(async (inner) => {
            const { root, items, bundle } = await savedBundleItems(
                inner,
                record,
              ),
              people = await onboardingPeople(inner, record);
            const result = await allocateLibraryItems(
              inner,
              root,
              items,
              people,
              false,
              now,
            );
            bundle.onboarding.nextScanAt = new Date(
              now.getTime() + 60000,
            ).toISOString();
            await inner
              .update(templates)
              .set({ bundleDefinition: bundle })
              .where(eq(templates.id, record.id));
            return result;
          });
          assigned += result.assigned.length;
        } catch {
          // Preserve the rule and prior assignments; a broken bundle must not starve other companies.
          const bundle = BundleDefinitionSchema.parse(record.bundleDefinition);
          bundle.onboarding.nextScanAt = new Date(
            now.getTime() + 3600000,
          ).toISOString();
          await tx
            .update(templates)
            .set({ bundleDefinition: bundle })
            .where(eq(templates.id, record.id));
          console.error("Work Hub onboarding bundle deferred", record.id);
        }
      }
      const refresherBoundary = refresherCursor
        ? sql`WHERE candidate.id > ${refresherCursor}`
        : sql``;
      const refresherPage = await tx.execute<{ id: string; eligible: boolean }>(sql`
        WITH candidate_page AS MATERIALIZED (
          SELECT candidate.id,candidate.assignment_metadata,candidate.assignee_user_id,candidate.template_id
          FROM work_hub_form_instances candidate
          ${refresherBoundary}
          ORDER BY candidate.id
          LIMIT ${WORKER_PAGE_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        SELECT candidate.id,
          (candidate.assignment_metadata->>'status'='completed'
            AND candidate.assignment_metadata->>'refresherDueAt'<=${dueAt}
            AND candidate.assignment_metadata->>'refresherScheduledAt' IS NULL
            AND EXISTS (
              SELECT 1 FROM user_org_memberships membership INNER JOIN users account ON account.id=membership.user_id
              WHERE membership.id=(candidate.assignment_metadata->>'membershipId')::integer
              AND membership.user_id=candidate.assignee_user_id AND account.suspended_at IS NULL
            )
            AND EXISTS (
              SELECT 1 FROM work_hub_form_templates due_course
              WHERE due_course.id=candidate.template_id
              AND due_course.library_metadata->>'state'='published'
              AND due_course.library_metadata->>'kind'='training'
              AND NOT EXISTS (
                SELECT 1 FROM work_hub_form_templates newer
                WHERE newer.owner_org_type=due_course.owner_org_type AND newer.owner_org_id=due_course.owner_org_id
                AND newer.library_metadata->>'seriesId'=due_course.library_metadata->>'seriesId'
                AND newer.current_version>due_course.current_version AND newer.library_metadata->>'state'<>'draft'
              )
            )) AS eligible
        FROM candidate_page candidate
        ORDER BY candidate.id
      `);
      refresherCursor = refresherPage.rows.at(-1)?.id;
      for (const candidate of refresherPage.rows.filter((row) => row.eligible)) {
        const [instance] = await tx
          .select()
          .from(instances)
          .where(eq(instances.id, candidate.id))
          .limit(1);
        if (!instance?.assignmentMetadata) continue;
        const [record] = await tx
          .select()
          .from(templates)
          .where(eq(templates.id, instance.templateId))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!record) continue;
        const a = AssignmentMetadataSchema.parse(instance.assignmentMetadata);
        if (!a.refresherDueAt || Date.parse(a.refresherDueAt) > now.getTime())
          continue;
        if (!record?.libraryMetadata) continue;
        const m = LibraryMetadataSchema.parse(record.libraryMetadata),
          owner = {
            type: record.ownerOrgType,
            id: record.ownerOrgId,
          } as WorkHubOwner;
        if (m.state === "published" && m.kind === "training") {
          const people = (await companyLibraryPeople(tx, owner, true)).filter(
            (p) =>
              p.userId === instance.assigneeUserId &&
              p.membershipId === a.membershipId,
          );
          if (people.length) {
            const root = { record, metadata: m, owner },
              entry = {
                templateId: record.id,
                contentVersion: m.contentVersion,
                dueHours: m.content!.dueHours,
                presentation: a.presentation,
                requiredBeforeWork: a.requiredBeforeWork,
              };
            const result = await allocateLibraryItems(
              tx,
              root,
              [{ ...root, entry }],
              people,
              true,
              now,
            );
            assigned += result.assigned.length;
            a.refresherScheduledAt = now.toISOString();
          }
        }
        // Scheduling renewal never extends the old completion's validity.
        await tx
          .update(instances)
          .set({ assignmentMetadata: a })
          .where(eq(instances.id, instance.id));
      }
      const policyBoundary = policyCursor
        ? sql`WHERE candidate.id > ${policyCursor}`
        : sql``;
      const policyPage=await tx.execute<{id:string;eligible:boolean}>(sql`
        WITH candidate_page AS MATERIALIZED (
          SELECT candidate.id,candidate.library_metadata,candidate.owner_org_type,
            candidate.owner_org_id,candidate.current_version
          FROM work_hub_form_templates candidate
          ${policyBoundary}
          ORDER BY candidate.id
          LIMIT ${WORKER_PAGE_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        SELECT candidate.id,
          (candidate.library_metadata->>'state'='published'
            AND (candidate.library_metadata->'trainingPolicy'->>'newHireRequired'='true'
              OR candidate.library_metadata->'trainingPolicy'->>'roleChangeRequired'='true')
            AND coalesce(candidate.library_metadata->'trainingPolicy'->>'nextScanAt','1970-01-01T00:00:00.000Z')<=${dueAt}
            AND NOT EXISTS (
              SELECT 1 FROM work_hub_form_templates newer
              WHERE newer.owner_org_type=candidate.owner_org_type
                AND newer.owner_org_id=candidate.owner_org_id
                AND newer.library_metadata->>'seriesId'=candidate.library_metadata->>'seriesId'
                AND newer.current_version>candidate.current_version
                AND newer.library_metadata->>'state'<>'draft'
            )) AS eligible
        FROM candidate_page candidate
        ORDER BY candidate.id
      `);
      policyCursor=policyPage.rows.at(-1)?.id;
      for(const candidate of policyPage.rows.filter((row)=>row.eligible)){
        const [record]=await tx.select({
          ...getTableColumns(templates),
          definition:sql<unknown[]>`'[]'::jsonb`,
          libraryMetadata:sql<Record<string,unknown>>`${templates.libraryMetadata} - 'content' - 'fileSnapshots'`,
        }).from(templates).where(eq(templates.id,candidate.id)).limit(1);
        if(!record?.libraryMetadata)continue;
        const metadata=LibraryMetadataSchema.parse(record.libraryMetadata);
        try{
          const count=await tx.transaction(inner=>assignPolicyTraining(inner,record,undefined,now));
          assigned+=count;
          metadata.trainingPolicy!.nextScanAt=new Date(now.getTime()+60000).toISOString();
        }catch{
          metadata.trainingPolicy!.nextScanAt=new Date(now.getTime()+3600000).toISOString();
          console.error('Work Hub training policy deferred',record.id);
        }
        await tx.update(templates).set({libraryMetadata:metadata}).where(eq(templates.id,record.id));
      }
      return assigned;
    });
  } finally {
    running = false;
  }
}
export function startOnboardingWorker() {
  if (timer) return;
  const run = () =>
    void runWithTrainingWorkerDatabase(() =>
      runOnboardingWork()
        .then(() => runLibraryDeliveryWork())
        .then(() => runRequiredTrainingWork())
        .catch(() => console.error("Work Hub onboarding scan unavailable")),
    );
  timer = setInterval(run, 60000);
  timer.unref?.();
}
export function stopOnboardingWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
export async function libraryPushAllowed(userId: number, link: string) {
  const match = link.match(
    /^\/work-hub\/(?:training|checklist)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (!match) return false;
  const [instance] = await db
    .select()
    .from(instances)
    .where(
      and(eq(instances.id, match[1]), eq(instances.assigneeUserId, userId)),
    )
    .limit(1);
  if (!instance?.assignmentMetadata) return false;
  const [template] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, instance.templateId))
    .limit(1);
  if (!template?.libraryMetadata) return false;
  const metadata = LibraryMetadataSchema.parse(template.libraryMetadata);

  const a = AssignmentMetadataSchema.parse(instance.assignmentMetadata);
  if (["completed", "cancelled", "exempted"].includes(a.status)) return false;
  if (metadata.kind === "poll" && Date.now() >= Date.parse(a.dueAt))
    return false;
  const [person] = await db
    .select({ membershipId: memberships.id, suspendedAt: users.suspendedAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(eq(memberships.id, a.membershipId), eq(memberships.userId, userId)),
    )
    .limit(1);
  const [prefs] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  return (
    !!person &&
    !person.suspendedAt &&
    prefs?.pushEnabled !== false &&
    prefs?.workHubTasksEnabled !== false
  );
}

export async function librarySummaryPushAllowed(userId: number, link: string) {
  const match = link.match(
    /^\/work-hub\/(?:library|bundle)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (!match) return false;
  const [record] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, match[1]))
    .limit(1);
  if (!record?.libraryMetadata) return false;
  const [member] = await db
    .select({ id: memberships.id, suspendedAt: users.suspendedAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.orgType, record.ownerOrgType),
        record.ownerOrgType === "vendor"
          ? eq(memberships.vendorId, record.ownerOrgId)
          : eq(memberships.partnerId, record.ownerOrgId),
        eq(memberships.role, "admin"),
      ),
    )
    .limit(1);
  const [prefs] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  return (
    !!member &&
    !member.suspendedAt &&
    prefs?.pushEnabled !== false &&
    prefs?.workHubTasksEnabled !== false
  );
}
