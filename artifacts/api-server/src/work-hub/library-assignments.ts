import { randomUUID } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  workHubFormTemplatesTable as templates,
  workHubFormInstancesTable as instances,
  workHubFormSubmissionsTable as submissions,
} from "@workspace/db";
import {
  AssignmentMetadataSchema,
  LibraryMetadataSchema,
  LibraryAssignmentRequestSchema,
  BundleDefinitionSchema,
  type AssignmentMetadata,
  type WorkHubCommandEnvelope,
  type LibraryMetadata,
  type WorkHubOwner,
  LibraryDraftSchema,
  LibraryDeliverySchema,
  type LibraryDelivery,
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
import {
  expandLibraryAudience,
  companyLibraryPeople,
} from "./library-audience";
import {
  assignmentDeadline,
  publicTraining,
  shouldReuseLibraryAssignment,
} from "./library-policy";
import { liveMeetingFingerprint } from "./live-meeting-fingerprint";
import { queueCampaignNotice } from "./form-campaign-service";
export async function libraryItems(
  tx: LibraryTx,
  actor: LibraryActor,
  itemId: string,
  settings: {
    presentation: "first_entry" | "next_login" | "immediate";
    requiredBeforeWork: boolean;
  },
  lock = false,
) {
  const root = await libraryRecord(tx, actor, itemId, true, lock);
  if (root.metadata.state !== "published")
    throw new LibraryError("Publish content before assigning", 400);
  const entries =
    root.metadata.kind === "bundle"
      ? BundleDefinitionSchema.parse(root.record.bundleDefinition).entries
      : [
          {
            templateId: itemId,
            contentVersion: root.metadata.contentVersion,
            dueHours: root.metadata.content!.dueHours,
            presentation: settings.presentation,
            requiredBeforeWork: settings.requiredBeforeWork,
          },
        ];
  const items = [];
  for (const entry of [...entries].sort((a, b) =>
    a.templateId.localeCompare(b.templateId),
  )) {
    const content = await libraryRecord(
      tx,
      actor,
      entry.templateId,
      true,
      lock,
    );
    if (
      content.metadata.kind === "bundle" ||
      content.metadata.state !== "published" ||
      content.metadata.contentVersion !== entry.contentVersion
    )
      throw new LibraryError(
        "Bundle contains an archived or changed content version",
        409,
      );
    items.push({ ...content, entry });
  }
  return { root, items };
}
export async function previewLibraryAssignment(
  actor: LibraryActor,
  input: unknown,
) {
  const request = LibraryAssignmentRequestSchema.parse(input);
  return db.transaction((tx) => assignmentPreview(tx, actor, request));
}
async function assignmentPreview(
  tx: LibraryTx,
  actor: LibraryActor,
  request: ReturnType<typeof LibraryAssignmentRequestSchema.parse>,
) {
  const { root, items } = await libraryItems(
      tx,
      actor,
      request.itemId,
      request,
      true,
    ),
    audience = await expandLibraryAudience(tx, actor, request.audience),
    now = new Date(),
    omitted = items.filter(
      (i) =>
        i.metadata.kind === "poll" &&
        (!i.metadata.pollClosesAt ||
          Date.parse(i.metadata.pollClosesAt) <= now.getTime()),
    );
  const existing = await tx
    .select({
      id: instances.id,
      templateId: instances.templateId,
      userId: instances.assigneeUserId,
      metadata: instances.assignmentMetadata,
    })
    .from(instances)
    .where(
      sql`${instances.templateId} in (${sql.join(
        items.map((i) => sql`${i.record.id}`),
        sql`,`,
      )})`,
    );
  const fingerprint = liveMeetingFingerprint(
    actor.userId,
    "library.assignment-preview",
    request.itemId,
    {
      rootVersion: root.metadata.version,
      items: items.map((i) => ({
        id: i.record.id,
        version: i.metadata.version,
        contentVersion: i.metadata.contentVersion,
        settings: i.entry,
        pollClosesAt: i.metadata.pollClosesAt,
      })),
      audience: audience.people.map((p) => ({
        userId: p.userId,
        membershipId: p.membershipId,
      })),
      existing: existing
        .filter((i) => audience.people.some((p) => p.userId === i.userId))
        .map((i) => {
          if (!i.metadata) return { id: i.id, metadata: null };
          const a = AssignmentMetadataSchema.parse(i.metadata),
            delivery = a.delivery
              ? {
                  config: a.delivery.config,
                  ownerUserId: a.delivery.ownerUserId,
                  timezone: a.delivery.timezone,
                }
              : null;
          return { id: i.id, metadata: { ...a, delivery } };
        }),
      renew: request.renew,
      delivery: request.delivery,
    },
  );
  return {
    itemId: request.itemId,
    title: root.record.name,
    version: root.metadata.version,
    people: audience.people.map((p) => ({
      userId: p.userId,
      name: p.name,
      membershipId: p.membershipId,
    })),
    excluded: audience.excluded,
    items: items
      .filter((i) => !omitted.includes(i))
      .map((i) => ({
        itemId: i.record.id,
        title: i.record.name,
        kind: i.metadata.kind,
        contentVersion: i.metadata.contentVersion,
        estimatedDeadline: assignmentDeadline(
          i.metadata.kind,
          i.entry.dueHours,
          i.metadata.pollClosesAt,
          now,
        ).toISOString(),
        requiredBeforeWork: i.entry.requiredBeforeWork,
      })),
    omitted: omitted.map((i) => ({
      itemId: i.record.id,
      title: i.record.name,
      reason: "Poll closed",
    })),
    existingCount: existing.filter((i) =>
      audience.people.some((p) => p.userId === i.userId),
    ).length,
    previewFingerprint: fingerprint,
  };
}
export async function assignLibrary(
  actor: LibraryActor,
  e: WorkHubCommandEnvelope,
) {
  const request = LibraryAssignmentRequestSchema.parse(e.payload);
  return libraryCommand(
    actor,
    e,
    "library.assign",
    request.itemId,
    async (tx) => {
      const preview = await assignmentPreview(tx, actor, request);
      if (
        e.expectedVersion !== preview.version ||
        request.previewFingerprint !== preview.previewFingerprint
      )
        throw new LibraryError(
          "Audience or content changed; review assignment again",
          409,
        );
      const { root, items } = await libraryItems(
          tx,
          actor,
          request.itemId,
          request,
          true,
        ),
        { people } = await expandLibraryAudience(tx, actor, request.audience);
      return allocateLibraryItems(
        tx,
        root,
        items,
        people,
        request.renew,
        new Date(),
        request.delivery ?? undefined,
        actor.userId,
      );
    },
  );
}
export async function allocateLibraryItems(
  tx: LibraryTx,
  root: Awaited<ReturnType<typeof libraryRecord>>,
  items: Awaited<ReturnType<typeof libraryItems>>["items"],
  people: Awaited<ReturnType<typeof companyLibraryPeople>>,
  renew: boolean,
  now: Date,
  deliveryOverride?: LibraryDelivery,
  ownerOverride?: number,
) {
  const assignmentId = randomUUID(),
    assigned: string[] = [],
    reused: string[] = [],
    omitted: string[] = [];
  for (const item of items) {
    const m = item.metadata;
    if (
      m.kind === "poll" &&
      (!m.pollClosesAt || Date.parse(m.pollClosesAt) <= now.getTime())
    ) {
      omitted.push(item.record.id);
      continue;
    }
    for (const person of people) {
      const prior = await tx
        .select()
        .from(instances)
        .where(
          and(
            eq(instances.templateId, item.record.id),
            eq(instances.assigneeUserId, person.userId),
          ),
        )
        .orderBy(desc(instances.createdAt))
        .for("update");
      const existing = prior.find((row) => {
        if (!row.assignmentMetadata) return false;
        const a = AssignmentMetadataSchema.parse(row.assignmentMetadata);
        return (
          a.contentVersion === m.contentVersion &&
          a.membershipId === person.membershipId &&
          a.status !== "cancelled"
        );
      });
      if (
        existing &&
        shouldReuseLibraryAssignment(
          AssignmentMetadataSchema.parse(existing.assignmentMetadata).status,
          renew,
          m.kind,
        )
      ) {
        const a = AssignmentMetadataSchema.parse(existing.assignmentMetadata);
        if (
          item.entry.requiredBeforeWork &&
          !a.requiredBeforeWork &&
          ["assigned", "in_progress"].includes(a.status)
        ) {
          a.requiredBeforeWork = true;
          a.version++;
          await tx
            .update(instances)
            .set({ assignmentMetadata: a })
            .where(eq(instances.id, existing.id));
        }
        reused.push(existing.id);
        continue;
      }
      const dueAt = assignmentDeadline(
          m.kind,
          item.entry.dueHours,
          m.pollClosesAt,
          now,
        ),
        metadata = AssignmentMetadataSchema.parse({
          assignmentId,
          sourceItemId: root.record.id,
          bundleId: root.metadata.kind === "bundle" ? root.record.id : null,
          bundleVersion:
            root.metadata.kind === "bundle"
              ? root.metadata.contentVersion
              : null,
          contentVersion: m.contentVersion,
          membershipId: person.membershipId,
          presentation: item.entry.presentation,
          requiredBeforeWork: item.entry.requiredBeforeWork,
          assignedAt: now.toISOString(),
          delivery: (() => {
            const bundle = root.record.bundleDefinition
              ? BundleDefinitionSchema.parse(root.record.bundleDefinition)
              : null;
            const config =
              deliveryOverride ??
              bundle?.delivery ??
              root.metadata.content?.delivery ??
              LibraryDeliverySchema.parse({});
            return config.reminderHours ||
              config.briefing.enabled ||
              config.escalationHours
              ? {
                  config,
                  ownerUserId:
                    ownerOverride ??
                    bundle?.onboarding.ownerUserId ??
                    root.record.createdById,
                  timezone: m.content!.timezone,
                  nextReminderAt: config.reminderHours
                    ? new Date(
                        now.getTime() + config.reminderHours * 3600000,
                      ).toISOString()
                    : null,
                }
              : null;
          })(),
          dueAt: dueAt.toISOString(),
        });
      const [row] = await tx
        .insert(instances)
        .values({
          templateId: item.record.id,
          templateVersion: m.contentVersion,
          assigneeUserId: person.userId,
          definitionSnapshot:
            m.kind === "training"
              ? [publicTraining(m.content!.training!)]
              : m.content!.fields,
          dueAt,
          assignmentMetadata: metadata,
        })
        .returning({ id: instances.id });
      assigned.push(row.id);
      await queueCampaignNotice(tx, {
        userIds: [person.userId],
        key: `library-invite:${row.id}`,
        type: "work_hub_library_assignment",
        title: "New Work Hub assignment",
        body: item.record.name,
        link:
          m.kind === "training"
            ? `/work-hub/training/${row.id}`
            : `/work-hub/checklist/${row.id}`,
        at: now,
        timezone: m.content!.timezone,
      });
    }
  }
  return {
    assignmentId,
    assigned,
    reused,
    omitted,
    notificationState: assigned.length ? "queued" : "none",
  };
}
export async function readAssignedLibrary(
  tx: Pick<typeof db, "select">,
  actor: LibraryActor,
  id: string,
  lock = false,
) {
  const { owner, member } = await libraryAuthority(tx, actor, false, lock);
  const q = tx
    .select()
    .from(instances)
    .where(
      and(eq(instances.id, id), eq(instances.assigneeUserId, actor.userId)),
    )
    .limit(1);
  const [candidate] = await q;
  if (!candidate?.assignmentMetadata)
    throw new LibraryError("Assigned item not found", 404);
  // Match distribution's template-before-instance lock order.
  const item = await libraryRecord(
    tx,
    actor,
    candidate.templateId,
    false,
    lock,
  );
  const [instance] = await (lock ? q.for("update") : q);
  if (
    !instance?.assignmentMetadata ||
    instance.templateId !== candidate.templateId
  )
    throw new LibraryError("Assigned item changed; refresh", 409);
  const assignment = AssignmentMetadataSchema.parse(
    instance.assignmentMetadata,
  );
  if (assignment.membershipId !== member.id)
    throw new LibraryError("Assignment membership no longer current", 403);
  if (!item.record.libraryMetadata) {
    item.metadata.content = LibraryDraftSchema.parse({
      kind: "form",
      title: item.record.name,
      fields: instance.definitionSnapshot,
    });
    item.metadata.contentVersion = assignment.contentVersion;
  }
  return { ...item, instance, assignment, owner };
}
export async function employeeChecklist(actor: LibraryActor) {
  const { owner, member } = await libraryAuthority(db, actor);
  const rows = await db
    .select({ instance: instances, template: templates })
    .from(instances)
    .innerJoin(templates, eq(templates.id, instances.templateId))
    .where(
      and(
        eq(instances.assigneeUserId, actor.userId),
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
      ),
    )
    .orderBy(desc(instances.createdAt))
    .limit(1000);
  return {
    items: rows
      .filter((r) => r.instance.assignmentMetadata)
      .flatMap((r) => {
        const assignment = AssignmentMetadataSchema.parse(
          r.instance.assignmentMetadata,
        );
        if (assignment.membershipId !== member.id) return [];
        const metadata = r.template.libraryMetadata
          ? LibraryMetadataSchema.parse(r.template.libraryMetadata)
          : null;
        return [
          {
            instanceId: r.instance.id,
            title: r.template.name,
            kind: metadata?.kind ?? "form",
            assignment,
            href:
              metadata?.kind === "training"
                ? `/work-hub/training/${r.instance.id}`
                : `/work-hub/checklist/${r.instance.id}`,
          },
        ];
      }),
  };
}
export async function ownerLibraryAssignments(actor: LibraryActor) {
  const { owner } = await libraryAuthority(db, actor, true);
  const people = await companyLibraryPeople(db, owner),
    rows = await db
      .select({ instance: instances, template: templates })
      .from(instances)
      .innerJoin(templates, eq(templates.id, instances.templateId))
      .where(
        and(
          eq(templates.ownerOrgType, owner.type),
          eq(templates.ownerOrgId, owner.id),
        ),
      )
      .orderBy(desc(instances.createdAt))
      .limit(1000);
  const items: Record<string, unknown>[] = [],
    anonymous = new Map<
      string,
      {
        itemId: string;
        title: string;
        kind: string;
        anonymous: true;
        assigned: number;
        responded: number;
      }
    >();
  for (const r of rows) {
    if (!r.instance.assignmentMetadata) continue;
    const a = AssignmentMetadataSchema.parse(r.instance.assignmentMetadata),
      m = r.template.libraryMetadata
        ? LibraryMetadataSchema.parse(r.template.libraryMetadata)
        : null,
      p = people.find(
        (p) =>
          p.userId === r.instance.assigneeUserId &&
          p.membershipId === a.membershipId,
      );
    if (m?.kind === "poll" && m.content?.poll?.anonymous) {
      let aggregate = anonymous.get(r.template.id);
      if (!aggregate) {
        aggregate = {
          itemId: r.template.id,
          title: r.template.name,
          kind: "poll",
          anonymous: true,
          assigned: 0,
          responded: 0,
        };
        anonymous.set(r.template.id, aggregate);
      }
      if (p) {
        aggregate.assigned++;
        if (a.status === "completed") aggregate.responded++;
      }
      continue;
    }
    items.push({
      instanceId: r.instance.id,
      itemId: r.template.id,
      title: r.template.name,
      kind: m?.kind ?? "form",
      assignmentId: a.assignmentId,
      bundleId: a.bundleId,
      name: p?.name ?? "Excluded employee",
      userId: r.instance.assigneeUserId,
      status: a.status,
      excluded: !p,
      dueAt: a.dueAt,
      contentVersion: a.contentVersion,
      version: a.version,
      anonymous: false,
    });
  }
  return { items: [...items, ...anonymous.values()] };
}
export async function ownerAssignmentDetail(actor: LibraryActor, id: string) {
  const { owner } = await libraryAuthority(db, actor, true);
  const [row] = await db
    .select({ instance: instances, template: templates })
    .from(instances)
    .innerJoin(templates, eq(templates.id, instances.templateId))
    .where(
      and(
        eq(instances.id, id),
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
      ),
    )
    .limit(1);
  if (!row?.instance.assignmentMetadata)
    throw new LibraryError("Assignment not found", 404);
  const m = row.template.libraryMetadata
    ? LibraryMetadataSchema.parse(row.template.libraryMetadata)
    : null;
  if (m?.kind === "poll" && m.content?.poll?.anonymous)
    throw new LibraryError(
      "Anonymous polls expose aggregate results only",
      403,
    );
  return {
    instanceId: id,
    title: row.template.name,
    kind: m?.kind ?? "form",
    content:
      m?.content ??
      LibraryDraftSchema.parse({
        kind: "form",
        title: row.template.name,
        fields: row.instance.definitionSnapshot,
      }),
    assignment: AssignmentMetadataSchema.parse(row.instance.assignmentMetadata),
    history: await db
      .select({
        id: submissions.id,
        version: submissions.version,
        values: submissions.values,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .where(eq(submissions.instanceId, id))
      .orderBy(desc(submissions.version))
      .limit(100),
  };
}
export async function libraryPollResults(actor: LibraryActor, id: string) {
  const own = await libraryRecord(db, actor, id, true);
  if (own.metadata.kind !== "poll")
    throw new LibraryError("Poll required", 400);
  const poll = own.metadata.content!.poll!,
    people = await companyLibraryPeople(db, own.owner),
    assigned = await db
      .select()
      .from(instances)
      .where(eq(instances.templateId, id));
  const eligible = assigned.filter(
    (i) =>
      i.assignmentMetadata &&
      people.some(
        (p) =>
          p.userId === i.assigneeUserId &&
          p.membershipId ===
            AssignmentMetadataSchema.parse(i.assignmentMetadata).membershipId,
      ),
  );
  const ids = eligible.map((i) => i.id);
  const ballotRows = ids.length
    ? await db
        .select()
        .from(submissions)
        .where(
          sql`${submissions.instanceId} in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`,`,
          )})`,
        )
        .orderBy(desc(submissions.submittedAt))
    : [];
  const ballots = new Map<number, (typeof ballotRows)[number]>();
  for (const b of ballotRows) {
    const user = eligible.find((i) => i.id === b.instanceId)?.assigneeUserId;
    if (user && !ballots.has(user)) ballots.set(user, b);
  }
  const visible =
    poll.resultsTiming === "live" ||
    (!!own.metadata.pollClosesAt &&
      Date.now() >= Date.parse(own.metadata.pollClosesAt));
  return {
    itemId: id,
    title: own.record.name,
    anonymous: poll.anonymous,
    assigned: new Set(eligible.map((i) => i.assigneeUserId)).size,
    responded: ballots.size,
    resultsVisible: visible,
    closesAt: own.metadata.pollClosesAt,
    totals: visible
      ? poll.choices.map((c) => ({
          ...c,
          votes: [...ballots.values()].filter(
            (b) =>
              Array.isArray(b.values.choices) &&
              b.values.choices.includes(c.id),
          ).length,
        }))
      : null,
  };
}
export async function cancelLibraryAssignment(
  actor: LibraryActor,
  id: string,
  e: WorkHubCommandEnvelope,
  exempt = false,
) {
  const reason = String((e.payload as { reason?: string }).reason ?? "").trim();
  if (!reason) throw new LibraryError("Reason required", 400);
  return libraryCommand(
    actor,
    e,
    exempt ? "library.exempt" : "library.cancel",
    id,
    async (tx) => {
      const { owner } = await libraryAuthority(tx, actor, true, true);
      const [row] = await tx
        .select({ instance: instances, template: templates })
        .from(instances)
        .innerJoin(templates, eq(templates.id, instances.templateId))
        .where(
          and(
            eq(instances.id, id),
            eq(templates.ownerOrgType, owner.type),
            eq(templates.ownerOrgId, owner.id),
          ),
        )
        .limit(1);
      if (!row?.instance.assignmentMetadata)
        throw new LibraryError("Assigned item not found", 404);
      await tx
        .select({ id: templates.id })
        .from(templates)
        .where(eq(templates.id, row.template.id))
        .limit(1)
        .for("update");
      const [fresh] = await tx
        .select()
        .from(instances)
        .where(
          and(eq(instances.id, id), eq(instances.templateId, row.template.id)),
        )
        .limit(1)
        .for("update");
      if (!fresh?.assignmentMetadata)
        throw new LibraryError("Assignment changed; refresh", 409);
      const a = AssignmentMetadataSchema.parse(fresh.assignmentMetadata);
      if (["completed", "cancelled", "exempted"].includes(a.status))
        throw new LibraryError("Assignment is already resolved", 409);
      if (e.expectedVersion !== a.version)
        throw new LibraryError("Assignment changed; refresh", 409);
      a.version++;
      a.status = exempt ? "exempted" : "cancelled";
      a.reason = reason;
      a.cancelledAt = new Date().toISOString();
      await tx
        .update(instances)
        .set({ assignmentMetadata: a })
        .where(eq(instances.id, id));
      return { instanceId: id, status: a.status, reason };
    },
  );
}
