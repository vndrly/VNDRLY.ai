import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  timeDatabaseStage,
  startDatabaseStage,
  workHubFileLibraryTable as records,
  workHubFormTemplatesTable as templates,
  workHubFormInstancesTable as instances,
  workHubFormSubmissionsTable as submissions,
} from "@workspace/db";
import {
  AssignmentMetadataSchema,
  LibraryMetadataSchema,
  BundleDefinitionSchema,
  vendorBonus,
} from "@workspace/api-zod";
import { companyLibraryPeople } from "./library-audience";
import { publicTraining } from "./library-policy";
import {
  repositoryRecipientCanRead,
  repositoryScope,
} from "./vendor-repository";
import {
  LibraryError,
  type LibraryActor,
  type LibraryTx,
} from "./library-core";
import type { WorkHubOwner } from "@workspace/api-zod";

// One assignment per person/content revision is shared across all certifications.
export async function assignRepositoryCourses(
  tx: LibraryTx,
  owner: WorkHubOwner,
  courseIds: string[],
  people: { userId: number; membershipId: number }[],
  actor: LibraryActor,
  renewalMonths?: number | null,
) {
  const rows = await tx
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
      ),
    );
  for (const id of [...new Set(courseIds)]) {
    const course = rows.find((c) => c.id === id);
    const m = LibraryMetadataSchema.safeParse(course?.libraryMetadata);
    if (
      !course ||
      !m.success ||
      m.data.state !== "published" ||
      m.data.kind !== "training" ||
      !m.data.content?.training
    )
      throw new LibraryError("Choose published VNDRLY/U courses", 400);
    for (const person of people) {
      const prior = await tx
        .select()
        .from(instances)
        .where(
          and(
            eq(instances.templateId, id),
            eq(instances.assigneeUserId, person.userId),
          ),
        );
      const completionRows = renewalMonths
        ? await tx
            .select({
              instanceId: submissions.instanceId,
              at: submissions.submittedAt,
            })
            .from(submissions)
            .where(eq(submissions.submittedById, person.userId))
        : [];
      if (
        prior.some((r) => {
          const a = AssignmentMetadataSchema.safeParse(r.assignmentMetadata);
          return (
            a.success &&
            a.data.membershipId === person.membershipId &&
            a.data.contentVersion === m.data.contentVersion &&
            a.data.status !== "cancelled" &&
            (a.data.status !== "completed" ||
              !renewalMonths ||
              completionRows.some(
                (s) =>
                  s.instanceId === r.id &&
                  new Date(s.at).setUTCMonth(
                    s.at.getUTCMonth() + renewalMonths,
                  ) > Date.now(),
              )) &&
            (!a.data.refresherDueAt ||
              Date.parse(a.data.refresherDueAt) > Date.now())
          );
        })
      )
        continue;
      const now = new Date(),
        dueAt = new Date(
          now.getTime() + (m.data.content.dueHours ?? 720) * 3600000,
        );
      await tx.insert(instances).values({
        templateId: id,
        templateVersion: m.data.contentVersion,
        assigneeUserId: person.userId,
        definitionSnapshot: [publicTraining(m.data.content.training)],
        dueAt,
        assignmentMetadata: AssignmentMetadataSchema.parse({
          assignmentId: randomUUID(),
          sourceItemId: id,
          contentVersion: m.data.contentVersion,
          membershipId: person.membershipId,
          presentation: "immediate",
          assignedAt: now.toISOString(),
          dueAt: dueAt.toISOString(),
        }),
      });
    }
  }
}
export async function repositoryCertificationProgress(
  reader: Pick<typeof db, "select">,
  owner: WorkHubOwner,
  userId: number | null = null,
  options: { optimized?: boolean; bonusOnly?: boolean } = {},
) {
  if (options.optimized && options.bonusOnly) {
    const augmentation = await timeDatabaseStage("bonus_presence", async () => await reader.select({ id: records.id }).from(records)
      .where(and(repositoryScope(owner), eq(records.kind, "vendor_augmentation"))).limit(1));
    // A company without vendor augmentations has no bonus requirements. Avoid
    // loading every employee's course assignments just to establish zero.
    if (!augmentation.length) return { certifications: [], bonusScore: 0, bonusCompleted: 0, bonusRequired: 0 };
  }
  const catalog = timeDatabaseStage("catalog", async () => await reader
    .select({
      id: templates.id,
      name: templates.name,
      currentVersion: templates.currentVersion,
      bundleDefinition: templates.bundleDefinition,
      libraryMetadata: sql<Record<string, unknown>>`${templates.libraryMetadata} - 'content'`,
      hasCertificationExam: sql<boolean>`(${templates.libraryMetadata} #> '{content,training,certificationExam}') IS NOT NULL AND (${templates.libraryMetadata} #> '{content,training,certificationExam}') <> 'null'::jsonb`,
    })
    .from(templates)
    .where(
      and(
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
      ),
    ));
  const assignmentSelection = reader
    .select({ instance: {
      id: instances.id,
      templateId: instances.templateId,
      assigneeUserId: instances.assigneeUserId,
      assignmentMetadata: instances.assignmentMetadata,
    }, submission: submissions.submittedAt })
    .from(instances);
  const assignmentQuery = options.optimized ? assignmentSelection : assignmentSelection.innerJoin(templates, eq(templates.id, instances.templateId));
  const assignments = timeDatabaseStage("assignments", async () => {
    // The catalog already establishes company ownership. Avoid the demonstrated
    // nested-loop plan that rechecks thousands of other companies' templates.
    const ownedIds = options.optimized ? (await catalog).map(course => course.id) : null;
    if (ownedIds && !ownedIds.length) return [];
    return await assignmentQuery
    .leftJoin(submissions, eq(submissions.instanceId, instances.id))
    .where(
      and(
        ownedIds ? inArray(instances.templateId, ownedIds) : and(eq(templates.ownerOrgType, owner.type), eq(templates.ownerOrgId, owner.id)),
        userId ? eq(instances.assigneeUserId, userId) : undefined,
      ),
    )
    .orderBy(desc(submissions.submittedAt));
  });
  const [courseRows, assigned, repository, currentPeople] = await Promise.all([catalog, assignments,
  timeDatabaseStage("repository", async () => await reader
    .select()
    .from(records)
    .where(options.optimized
      ? and(repositoryScope(owner), inArray(records.kind, ["vendor_augmentation", "document", "augmentation_ack"]))
      : repositoryScope(owner))),
  timeDatabaseStage("people", () => companyLibraryPeople(reader, owner)),
  ]);
  const finishProjection = startDatabaseStage("projection");
  // Request-local indexes retain database ordering and the baseline validators.
  // No result or authorization decision is shared between users or requests.
  const coursesById = new Map(courseRows.map((course) => [course.id, course]));
  const assignmentsByCourse = new Map<string, typeof assigned>();
  if (options.optimized) for (const row of assigned) {
    const key = JSON.stringify([row.instance.assigneeUserId, row.instance.templateId]);
    const rows = assignmentsByCourse.get(key) ?? [];
    rows.push(row);
    assignmentsByCourse.set(key, rows);
  }
  const metadataCache = new Map<unknown, ReturnType<typeof LibraryMetadataSchema.safeParse>>();
  const assignmentCache = new Map<unknown, ReturnType<typeof AssignmentMetadataSchema.safeParse>>();
  const bundleCache = new Map<unknown, ReturnType<typeof BundleDefinitionSchema.safeParse>>();
  const parseMetadata = (value: unknown) => {
    if (!options.optimized) return LibraryMetadataSchema.safeParse(value);
    if (!metadataCache.has(value)) metadataCache.set(value, LibraryMetadataSchema.safeParse(value));
    return metadataCache.get(value)!;
  };
  const parseAssignment = (value: unknown) => {
    if (!options.optimized) return AssignmentMetadataSchema.safeParse(value);
    if (!assignmentCache.has(value)) assignmentCache.set(value, AssignmentMetadataSchema.safeParse(value));
    return assignmentCache.get(value)!;
  };
  const parseBundle = (value: unknown) => {
    if (!options.optimized) return BundleDefinitionSchema.safeParse(value);
    if (!bundleCache.has(value)) bundleCache.set(value, BundleDefinitionSchema.safeParse(value));
    return bundleCache.get(value)!;
  };
  const findCourse = (id: string) => options.optimized ? coursesById.get(id) : courseRows.find((course) => course.id === id);
  const permissionCache = new Map<string, Promise<boolean>>();
  const canReadDocument = (doc: typeof repository[number], person: number) => {
    if (!options.optimized) return repositoryRecipientCanRead(reader, owner, doc, person);
    const key = JSON.stringify([doc.id, person]);
    if (!permissionCache.has(key)) permissionCache.set(key, repositoryRecipientCanRead(reader, owner, doc, person));
    return permissionCache.get(key)!;
  };
  const augmentations = repository.filter(
    (r) => r.kind === "vendor_augmentation",
  );
  const membershipByUser = new Map(
    currentPeople.map((p) => [p.userId, p.membershipId]),
  );
  const people = [
    ...new Set(
      [
        ...(options.optimized && options.bonusOnly ? [] : assigned.map((r) => r.instance.assigneeUserId)),
        ...augmentations.flatMap((r) => (r.data.userIds as number[]) ?? []),
      ].filter(
        (id): id is number =>
          !!id && membershipByUser.has(id) && (!userId || id === userId),
      ),
    ),
  ];
  const courseStep = (
    id: string,
    version: number,
    person: number,
    renewalMonths?: number | null,
  ) => {
    const current = findCourse(id),
      m = parseMetadata(current?.libraryMetadata);
    const candidates = options.optimized ? assignmentsByCourse.get(JSON.stringify([person, id])) ?? [] : assigned;
    const matches = candidates.filter(
      (r) =>
        r.instance.assigneeUserId === person &&
        r.instance.templateId === id &&
        (() => {
          const a = parseAssignment(
            r.instance.assignmentMetadata,
          );
          return (
            a.success &&
            a.data.membershipId === membershipByUser.get(person) &&
            a.data.contentVersion === version &&
            a.data.status !== "cancelled"
          );
        })(),
    );
    let completedAt: string | null = null,
      expiresAt: string | null = null;
    for (const row of matches) {
      const a = parseAssignment(
        row.instance.assignmentMetadata,
      );
      if (
        !a.success ||
        a.data.status !== "completed" ||
        a.data.membershipId !== membershipByUser.get(person) ||
        a.data.contentVersion !== version ||
        !m.success ||
        m.data.state !== "published" ||
        m.data.contentVersion !== version
      )
        continue;
      if (
        current?.hasCertificationExam &&
        !a.data.progress.certificationExam?.attempts.some(
          (x) => x.passed && x.submittedAt,
        )
      )
        continue;
      const at = row.submission?.toISOString();
      if (!at) continue;
      const vendorExpiry = renewalMonths
        ? new Date(
            new Date(at).setUTCMonth(
              new Date(at).getUTCMonth() + renewalMonths,
            ),
          ).toISOString()
        : null;
      const expiry =
        [a.data.refresherDueAt, vendorExpiry]
          .filter((value): value is string => !!value)
          .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
      if (expiry && Date.parse(expiry) <= Date.now()) continue;
      completedAt = at;
      expiresAt = expiry;
      break;
    }
    return {
      id,
      title: current?.name ?? "Unavailable course",
      version,
      complete: !!completedAt,
      completedAt,
      expiresAt,
      href: matches[0]?.instance.id
        ? `/work-hub/training/${matches[0].instance.id}`
        : `/work-hub/library/${id}?view=training`,
      instanceId: matches[0]?.instance.id ?? null,
      type: "course",
    };
  };
  const output = [];
  for (const person of people) {
    if (!(options.optimized && options.bonusOnly)) {
    // Direct course assignments are training progress, not certifications.
    const directCourses = new Set(assigned.filter((row) => {
      const a = parseAssignment(row.instance.assignmentMetadata);
      return row.instance.assigneeUserId === person && a.success &&
        a.data.membershipId === membershipByUser.get(person) &&
        !a.data.bundleId && !["cancelled", "exempted"].includes(a.data.status);
    }).map((row) => row.instance.templateId));
    for (const id of directCourses) {
      const course = findCourse(id);
      const m = parseMetadata(course?.libraryMetadata);
      if (!m.success || m.data.kind !== "training" || m.data.state !== "published") continue;
      const step = courseStep(id, m.data.contentVersion, person);
      if (!step.instanceId) continue;
      output.push({ id, title: course!.name, userId: person, augmented: false,
        standalone: true, steps: [step], complete: step.complete });
    }
    for (const bundle of courseRows) {
      const m = parseMetadata(bundle.libraryMetadata),
        b = parseBundle(bundle.bundleDefinition);
      if (
        !m.success ||
        m.data.state !== "published" ||
        m.data.kind !== "bundle" ||
        !b.success
      )
        continue;
      const steps = b.data.entries.map((e) =>
        courseStep(e.templateId, e.contentVersion, person),
      );
      const explicitlyAssigned = assigned.some(
          (r) =>
            r.instance.assigneeUserId === person &&
            parseAssignment(r.instance.assignmentMetadata)
              .success &&
            (r.instance.assignmentMetadata as any).bundleId === bundle.id,
        );
      // Required-training allocation can reuse individual assignments without
      // stamping a bundle ID. Preserve the published bundle's course grouping.
      const coveredByAssignments = steps.length > 0 && steps.every((step) => !!step.instanceId);
      if (!explicitlyAssigned && !coveredByAssignments)
        continue;
      output.push({
        id: bundle.id,
        title: bundle.name,
        userId: person,
        augmented: false,
        groupingOnly: !explicitlyAssigned,
        steps,
        complete: steps.length > 0 && steps.every((s) => s.complete),
      });
    }
    }
    for (const aug of augmentations.filter((r) =>
      ((r.data.userIds as number[]) ?? []).includes(person),
    )) {
      const base = findCourse(String(aug.data.baseItemId)),
        b = parseBundle(base?.bundleDefinition);
      const requirements = b.success
        ? b.data.entries.map((e) => ({
            id: e.templateId,
            version: e.contentVersion,
          }))
        : base
          ? [
              {
                id: base.id,
                version: Number(
                  (base.libraryMetadata as any)?.contentVersion ??
                    base.currentVersion,
                ),
              },
            ]
          : [];
      const baseIds = new Set(requirements.map((r) => r.id));
      for (const c of (aug.data.courseVersions as {
        courseId: string;
        version: number;
      }[]) ?? [])
        if (!requirements.some((r) => r.id === c.courseId))
          requirements.push({
            id: c.courseId,
            version: Number(
              (
                findCourse(c.courseId)
                  ?.libraryMetadata as any
              )?.contentVersion ?? c.version,
            ),
          });
      const steps: any[] = requirements.map((r) => ({
        ...courseStep(
          r.id,
          r.version,
          person,
          aug.data.renewalMonths as number | null,
        ),
        bonusEligible: !baseIds.has(r.id),
      }));
      for (const id of (aug.data.documentIds as string[]) ?? []) {
        const doc = repository.find(
            (d) => d.id === id && d.kind === "document",
          ),
          ack = repository.find(
            (r) =>
              r.kind === "augmentation_ack" &&
              r.data.augmentationId === aug.id &&
              r.data.documentId === id &&
              r.data.userId === person &&
              r.data.fileId === doc?.data.currentFileId,
          );
        const canRead = doc
          ? await canReadDocument(doc, person)
          : false;
        const valid =
          canRead &&
          doc?.data.state === "active" &&
          !!ack &&
          (!aug.data.renewalMonths ||
            new Date(ack.updatedAt).setUTCMonth(
              ack.updatedAt.getUTCMonth() + Number(aug.data.renewalMonths),
            ) > Date.now());
        steps.push({
          id,
          title: doc?.data.name ?? "Unavailable material",
          type: "material",
          bonusEligible: true,
          version: doc?.data.currentFileId,
          complete: !!valid,
          href: `/api/work-hub/file-library/${id}/download`,
          completedAt: ack?.updatedAt.toISOString() ?? null,
        });
      }
      output.push({
        id: aug.id,
        title: String(aug.data.title),
        userId: person,
        augmented: true,
        addedBy: aug.data.addedBy,
        addedAt: aug.data.addedAt,
        required: aug.data.required,
        steps,
        complete: steps.length > 0 && steps.every((s) => s.complete),
      });
    }
  }
  const uniqueRequirements = new Map<string, { complete: boolean }>();
  for (const certification of output.filter(
    (c) => c.augmented && "required" in c && c.required,
  )) {
    for (const step of certification.steps) {
      if (!step.bonusEligible) continue;
      const key = JSON.stringify([
        certification.userId,
        step.type,
        step.type === "material" ? step.version : step.id,
        step.version,
      ]);
      const previous = uniqueRequirements.get(key);
      uniqueRequirements.set(key, {
        complete: step.complete && (previous?.complete ?? true),
      });
    }
  }
  const required = [...uniqueRequirements.values()];
  finishProjection();
  return {
    certifications: output,
    bonusScore: vendorBonus(
      required.filter((c) => c.complete).length,
      required.length,
    ),
    bonusCompleted: required.filter((c) => c.complete).length,
    bonusRequired: required.length,
  };
}
