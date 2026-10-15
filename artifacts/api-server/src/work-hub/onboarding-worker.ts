import { runLibraryDeliveryWork } from "./library-delivery-worker";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
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
export async function runOnboardingWork(now = new Date()) {
  if (running) return 0;
  running = true;
  try {
    return await db.transaction(async (tx) => {
      const bundles = await tx
        .select()
        .from(templates)
        .where(
          sql`${templates.libraryMetadata}->>'kind'='bundle' AND ${templates.libraryMetadata}->>'state'='published' AND ${templates.bundleDefinition}->'onboarding'->>'enabled'='true' AND coalesce((${templates.bundleDefinition}->'onboarding'->>'nextScanAt')::timestamptz,'1970-01-01')<=${now}`,
        )
        .orderBy(
          sql`coalesce(${templates.bundleDefinition}->'onboarding'->>'nextScanAt','1970-01-01')`,
        )
        .limit(25)
        .for("update", { skipLocked: true });
      let assigned = 0;
      for (const record of bundles) {
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
      const refreshers = await tx
        .select()
        .from(instances)
        .where(
          sql`${instances.assignmentMetadata}->>'status'='completed' AND (${instances.assignmentMetadata}->>'refresherDueAt')::timestamptz<=${now}`,
        )
        .limit(25);
      for (const candidate of refreshers) {
        const [record] = await tx
          .select()
          .from(templates)
          .where(eq(templates.id, candidate.templateId))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!record) continue;
        const [instance] = await tx
          .select()
          .from(instances)
          .where(eq(instances.id, candidate.id))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!instance?.assignmentMetadata) continue;
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
          }
        }
        a.refresherDueAt = null;
        await tx
          .update(instances)
          .set({ assignmentMetadata: a })
          .where(eq(instances.id, instance.id));
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
    void runOnboardingWork()
      .then(() => runLibraryDeliveryWork())
      .catch(() => console.error("Work Hub onboarding scan unavailable"));
  timer = setInterval(run, 60000);
  timer.unref?.();
  run();
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
