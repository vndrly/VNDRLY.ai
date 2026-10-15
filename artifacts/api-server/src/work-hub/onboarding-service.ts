import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  workHubFormTemplatesTable as templates,
  workHubFormInstancesTable as instances,
  userOrgMembershipsTable as memberships,
  workHubChannelsTable as channels,
  workHubChannelMembersTable as channelMembers,
  vendorCrewPresetsTable as crews,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  BundleDefinitionSchema,
  LibraryMetadataSchema,
  AssignmentMetadataSchema,
  type WorkHubOwner,
  type WorkHubCommandEnvelope,
} from "@workspace/api-zod";
import {
  libraryAuthority,
  libraryRecord,
  libraryCommand,
  checkLibraryVersion,
  LibraryError,
  type LibraryActor,
  type LibraryTx,
} from "./library-core";
import { allocateLibraryItems, employeeChecklist } from "./library-assignments";
import { companyLibraryPeople, libraryOptions } from "./library-audience";
export async function updateOnboardingRule(
  actor: LibraryActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  const input = z
    .object({
      enabled: z.boolean(),
      roles: z
        .array(z.enum(["admin", "member", "ap", "field_employee"]))
        .default([]),
      groupIds: z.array(z.string()).default([]),
    })
    .parse(e.payload);
  const options = await libraryOptions(actor);
  if (input.groupIds.some((id) => !options.groups.some((g) => g.id === id)))
    throw new LibraryError("Choose authorized company groups", 400);
  return libraryCommand(actor, e, "library.onboarding-rule", id, async (tx) => {
    const own = await libraryRecord(tx, actor, id, true, true);
    await checkLibraryVersion(own.metadata, e);
    if (own.metadata.kind !== "bundle" || own.metadata.state !== "published")
      throw new LibraryError(
        "Publish the bundle before enabling onboarding",
        400,
      );
    const b = BundleDefinitionSchema.parse(own.record.bundleDefinition);
    b.onboarding = {
      ...input,
      activatedAt: input.enabled
        ? b.onboarding.enabled
          ? b.onboarding.activatedAt
          : new Date().toISOString()
        : b.onboarding.activatedAt,
      nextScanAt: null,
      ownerUserId: actor.userId,
    };
    own.metadata.version++;
    await tx
      .update(templates)
      .set({ bundleDefinition: b, libraryMetadata: own.metadata })
      .where(eq(templates.id, id));
    return {
      itemId: id,
      version: own.metadata.version,
      onboarding: b.onboarding,
      notificationState: "none",
    };
  });
}
export async function savedBundleItems(
  tx: LibraryTx,
  record: typeof templates.$inferSelect,
) {
  const metadata = LibraryMetadataSchema.parse(record.libraryMetadata),
    owner = {
      type: record.ownerOrgType,
      id: record.ownerOrgId,
    } as WorkHubOwner,
    bundle = BundleDefinitionSchema.parse(record.bundleDefinition),
    root = { record, metadata, owner };
  const items = [];
  for (const entry of [...bundle.entries].sort((a, b) =>
    a.templateId.localeCompare(b.templateId),
  )) {
    const [content] = await tx
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, entry.templateId),
          eq(templates.ownerOrgType, owner.type),
          eq(templates.ownerOrgId, owner.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!content?.libraryMetadata)
      throw new LibraryError("Onboarding content no longer published", 409);
    const m = LibraryMetadataSchema.parse(content.libraryMetadata);
    if (
      m.kind === "bundle" ||
      m.state !== "published" ||
      m.contentVersion !== entry.contentVersion
    )
      throw new LibraryError(
        "Onboarding bundle needs a published content revision",
        409,
      );
    items.push({ record: content, metadata: m, owner, entry });
  }
  return { root, items, bundle, owner };
}
export async function onboardingPeople(
  tx: LibraryTx,
  record: typeof templates.$inferSelect,
) {
  const owner = {
      type: record.ownerOrgType,
      id: record.ownerOrgId,
    } as WorkHubOwner,
    b = BundleDefinitionSchema.parse(record.bundleDefinition);
  if (!b.onboarding.enabled || !b.onboarding.activatedAt) return [];
  const people = await companyLibraryPeople(tx, owner, false),
    administrator = people.find(
      (p) =>
        p.userId === (b.onboarding.ownerUserId ?? record.createdById) &&
        p.role === "admin",
    );
  if (!administrator) return [];
  const groupUsers = new Set<number>();
  for (const id of b.onboarding.groupIds) {
    if (id.startsWith("crew:")) {
      if (owner.type !== "vendor") continue;
      const [crew] = await tx
        .select()
        .from(crews)
        .where(
          and(eq(crews.id, Number(id.slice(5))), eq(crews.vendorId, owner.id)),
        )
        .limit(1);
      const members = Array.isArray(crew?.memberEmployeeIds)
        ? crew.memberEmployeeIds
        : [];
      people
        .filter(
          (p) =>
            p.vendorPeopleId !== null && members.includes(p.vendorPeopleId),
        )
        .forEach((p) => groupUsers.add(p.userId));
    } else {
      const [group] = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.id, id),
            eq(channels.ownerOrgType, owner.type),
            eq(channels.ownerOrgId, owner.id),
            eq(channels.status, "active"),
          ),
        )
        .limit(1);
      if (!group) continue;
      const members = await tx
        .select({ userId: channelMembers.userId })
        .from(channelMembers)
        .where(eq(channelMembers.channelId, id));
      members.forEach((m) => groupUsers.add(m.userId));
    }
  }
  return people.filter(
    (p) =>
      p.joinedAt.getTime() >= Date.parse(b.onboarding.activatedAt!) &&
      (!b.onboarding.roles.length ||
        b.onboarding.roles.includes(p.role as "admin")) &&
      (!b.onboarding.groupIds.length || groupUsers.has(p.userId)),
  );
}
export async function ensureOnboarding(actor: LibraryActor) {
  await db.transaction(async (tx) => {
    const { owner, member } = await libraryAuthority(tx, actor, false, true),
      bundles = await tx
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.ownerOrgType, owner.type),
            eq(templates.ownerOrgId, owner.id),
            sql`${templates.libraryMetadata}->>'kind'='bundle' AND ${templates.libraryMetadata}->>'state'='published' AND ${templates.bundleDefinition}->'onboarding'->>'enabled'='true'`,
          ),
        )
        .orderBy(templates.id)
        .for("update");
    for (const record of bundles) {
      const targets = (await onboardingPeople(tx, record)).filter(
        (p) => p.userId === actor.userId && p.membershipId === member.id,
      );
      if (!targets.length) continue;
      const { root, items } = await savedBundleItems(tx, record);
      await allocateLibraryItems(tx, root, items, targets, false, new Date());
    }
  });
  const checklist = await employeeChecklist(actor);
  return {
    ...checklist,
    present: checklist.items
      .filter(
        (i) =>
          !i.assignment.presentedAt &&
          !["completed", "cancelled", "exempted"].includes(
            i.assignment.status,
          ) &&
          (i.assignment.presentation !== "next_login" ||
            (actor.iat ?? 0) * 1000 >= Date.parse(i.assignment.assignedAt)),
      )
      .map((i) => ({instanceId:i.instanceId,title:i.title,kind:i.kind,assignment:{version:i.assignment.version}})),
  };
}
export async function markLibraryPresented(
  actor: LibraryActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  return libraryCommand(
    actor,
    e,
    "library.presented",
    id,
    async (tx) => {
      const { member } = await libraryAuthority(tx, actor, false, true);
      const [candidate] = await tx.select({templateId:instances.templateId}).from(instances).where(and(eq(instances.id,id),eq(instances.assigneeUserId,actor.userId))).limit(1);
      if(!candidate) throw new LibraryError("Assignment not found",404);
      await libraryRecord(tx,actor,candidate.templateId,false,true);
      const [instance] = await tx
        .select()
        .from(instances)
        .where(
          and(eq(instances.id, id), eq(instances.assigneeUserId, actor.userId)),
        )
        .limit(1)
        .for("update");
      if (!instance?.assignmentMetadata)
        throw new LibraryError("Assignment not found", 404);
      const a = AssignmentMetadataSchema.parse(instance.assignmentMetadata);
      if (a.membershipId !== member.id || a.version !== e.expectedVersion)
        throw new LibraryError("Assignment changed", 409);

      a.presentedAt = new Date().toISOString();
      a.version++;
      await tx
        .update(instances)
        .set({ assignmentMetadata: a })
        .where(eq(instances.id, id));
      return { instanceId: id, version: a.version, presentedAt: a.presentedAt };
    },
    false,
  );
}
