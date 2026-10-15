import { randomUUID, createHash } from "node:crypto";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  workHubFormTemplatesTable as templates,
  workHubFilesTable as files,
} from "@workspace/db";
import {
  LibraryDraftSchema,
  LibraryMetadataSchema,
  BundleDefinitionSchema,
  type LibraryMetadata,
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
import { safeLibraryContent } from "./library-policy";
import { getObjectStore } from "../lib/objectStore";
export { safeLibraryContent } from "./library-policy";

export async function listLibrary(
  actor: LibraryActor,
  archived = false,
  publishedOnly = false,
) {
  const { owner, member } = await libraryAuthority(db, actor);
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
        isNull(templates.campaignConfig),
      ),
    )
    .orderBy(desc(templates.createdAt))
    .limit(1000);
  const seen = new Set<string>();
  const result = [];
  for (const row of rows) {
    if (!row.libraryMetadata) {
      if (!archived)
        result.push({
          itemId: row.id,
          title: row.name,
          kind: "form",
          state: "published",
          contentVersion: row.currentVersion,
          version: 0,
          legacy: true,
          canManage: member.role === "admin",
        });
      continue;
    }
    const m = LibraryMetadataSchema.parse(row.libraryMetadata);
    if ((member.role !== "admin" || publishedOnly) && m.state !== "published")
      continue;
    if (seen.has(m.seriesId)) continue;
    seen.add(m.seriesId);
    if (
      (m.state === "archived") !== archived ||
      (member.role !== "admin" && m.state !== "published")
    )
      continue;
    result.push({
      itemId: row.id,
      title: row.name,
      kind: m.kind,
      state: m.state,
      contentVersion: m.contentVersion,
      version: m.version,
      seriesId: m.seriesId,
      canManage: member.role === "admin",
      legacy: false,
    });
  }
  return { items: result };
}
export async function getLibrary(actor: LibraryActor, id: string) {
  const { record, metadata, owner } = await libraryRecord(db, actor, id);
  const { member } = await libraryAuthority(db, actor);
  const manage = member.role === "admin";
  if (!manage && metadata.state !== "published")
    throw new LibraryError("Library item unavailable", 404);
  return {
    itemId: id,
    title: record.name,
    metadata: safeLibraryContent(metadata, manage),
    bundle: record.bundleDefinition
      ? BundleDefinitionSchema.parse(record.bundleDefinition)
      : null,
    canManage: manage,
    attachments: Object.entries(metadata.fileSnapshots).map(
      ([fileId, { storageKey: _, checksumSha256: __, ...f }]) => ({
        fileId,
        ...f,
      }),
    ),
    entries: record.bundleDefinition
      ? await db
          .select({
            itemId: templates.id,
            title: templates.name,
            contentVersion: templates.currentVersion,
          })
          .from(templates)
          .where(
            and(
              eq(templates.ownerOrgType, owner.type),
              eq(templates.ownerOrgId, owner.id),
              sql`${templates.id} in (${sql.join(
                BundleDefinitionSchema.parse(
                  record.bundleDefinition,
                ).entries.map((e) => sql`${e.templateId}`),
                sql`,`,
              )})`,
            ),
          )
      : [],
    history: await db
      .select({
        itemId: templates.id,
        title: templates.name,
        contentVersion: templates.currentVersion,
      })
      .from(templates)
      .where(
        and(
          eq(templates.ownerOrgType, owner.type),
          eq(templates.ownerOrgId, owner.id),
          sql`${templates.libraryMetadata}->>'seriesId'=${metadata.seriesId}`,
          ...(manage
            ? []
            : [sql`${templates.libraryMetadata}->>'state'='published'`]),
        ),
      )
      .orderBy(desc(templates.currentVersion))
      .limit(100),
  };
}
export async function saveLibrary(
  actor: LibraryActor,
  e: WorkHubCommandEnvelope,
  id?: string,
  bundle = false,
) {
  const raw = e.payload as Record<string, unknown>;
  const draft = bundle ? null : LibraryDraftSchema.parse(raw);
  const bundleData = bundle ? BundleDefinitionSchema.parse(raw.bundle) : null;
  const title = bundle ? String(raw.title ?? "").trim() : draft!.title;
  if (!title || title.length > 200)
    throw new LibraryError("Title required", 400);
  return libraryCommand(
    actor,
    e,
    id ? "library.update" : "library.create",
    id ?? null,
    async (tx) => {
      const { owner } = await libraryAuthority(tx, actor, true, true);
      let m: LibraryMetadata;
      if (id) {
        const current = await libraryRecord(tx, actor, id, true, true);
        await checkLibraryVersion(current.metadata, e);
        if (current.metadata.state !== "draft")
          throw new LibraryError("Create a revision to edit published content");
        m = {
          ...current.metadata,
          kind: bundle ? "bundle" : draft!.kind,
          content: draft,
          version: current.metadata.version + 1,
        };
      } else
        m = LibraryMetadataSchema.parse({
          seriesId: randomUUID(),
          contentVersion: 1,
          kind: bundle ? "bundle" : draft!.kind,
          content: draft,
        });
      let itemId = id;
      if (id)
        await tx
          .update(templates)
          .set({
            name: title,
            definition: draft?.fields ?? [],
            libraryMetadata: m,
            bundleDefinition: bundleData,
          })
          .where(eq(templates.id, id));
      else {
        const [row] = await tx
          .insert(templates)
          .values({
            ownerOrgType: owner.type,
            ownerOrgId: owner.id,
            name: title,
            definition: draft?.fields ?? [],
            createdById: actor.userId,
            libraryMetadata: m,
            bundleDefinition: bundleData,
          })
          .returning({ id: templates.id });
        itemId = row.id;
      }
      return {
        itemId,
        version: m.version,
        state: m.state,
        notificationState: "none",
      };
    },
  );
}
export async function reviseLibrary(
  actor: LibraryActor,
  id: string,
  e: WorkHubCommandEnvelope,
) {
  return libraryCommand(actor, e, "library.revise", id, async (tx) => {
    const {
      record,
      metadata: m,
      owner,
    } = await libraryRecord(tx, actor, id, true, true);
    await checkLibraryVersion(m, e);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${m.seriesId},0))`,
    );
    const siblings = await tx
      .select({ version: templates.currentVersion })
      .from(templates)
      .where(sql`${templates.libraryMetadata}->>'seriesId'=${m.seriesId}`)
      .orderBy(desc(templates.currentVersion))
      .limit(1);
    const next = Math.max(m.contentVersion, siblings[0]?.version ?? 0) + 1;
    const [row] = await tx
      .insert(templates)
      .values({
        ownerOrgType: owner.type,
        ownerOrgId: owner.id,
        name: record.name,
        definition: record.definition,
        createdById: actor.userId,
        currentVersion: next,
        libraryMetadata: {
          ...m,
          contentVersion: next,
          version: 0,
          state: "draft",
          publishedAt: null,
          archivedAt: null,
          pollClosesAt: null,
          fileSnapshots: {},
        },
        bundleDefinition: record.bundleDefinition
          ? {
              ...BundleDefinitionSchema.parse(record.bundleDefinition),
              onboarding: {
                enabled: false,
                activatedAt: null,
                nextScanAt: null,
                ownerUserId: null,
                roles: [],
                groupIds: [],
              },
            }
          : null,
      })
      .returning({ id: templates.id });
    return { itemId: row.id, contentVersion: next, state: "draft" };
  });
}
async function snapshotFiles(
  tx: LibraryTx,
  actor: LibraryActor,
  id: string,
  m: LibraryMetadata,
) {
  const owner = (await libraryAuthority(tx, actor, true, true)).owner;
  const ids = [
    ...new Set([
      ...(m.content?.policyAttachmentId ? [m.content.policyAttachmentId] : []),
      ...(m.content?.training?.lessons.flatMap((l) => l.fileIds) ?? []),
    ]),
  ];
  const snapshots: LibraryMetadata["fileSnapshots"] = {};
  for (const fileId of ids) {
    const [file] = await tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          eq(files.ownerOrgType, owner.type),
          eq(files.ownerOrgId, owner.id),
          isNull(files.channelId),
          eq(files.state, "finalized"),
        ),
      )
      .limit(1)
      .for("share");
    if (!file || file.byteSize > 25 * 1024 * 1024)
      throw new LibraryError("Authorized company attachment required", 400);
    const store = getObjectStore(),
      object = await store.getObject(file.storageKey);
    if (
      !object ||
      object.body.length !== file.byteSize ||
      createHash("sha256").update(object.body).digest("hex") !==
        file.checksumSha256
    )
      throw new LibraryError("Attachment integrity could not be verified", 400);
    const storageKey = `/objects/work-hub-library/${id}/${m.contentVersion}/${file.checksumSha256}`;
    await store.putObject(storageKey, file.contentType, object.body, {
      owner: String(actor.userId),
      visibility: "private",
    });
    snapshots[fileId] = {
      storageKey,
      checksumSha256: file.checksumSha256,
      fileName: file.fileName,
      contentType: file.contentType,
      byteSize: file.byteSize,
    };
  }
  return snapshots;
}
export async function changeLibraryState(
  actor: LibraryActor,
  id: string,
  e: WorkHubCommandEnvelope,
  action: "publish" | "archive",
) {
  return libraryCommand(actor, e, `library.${action}`, id, async (tx) => {
    const { record, metadata: m } = await libraryRecord(
      tx,
      actor,
      id,
      true,
      true,
    );
    await checkLibraryVersion(m, e);
    if (action === "publish" && m.state !== "draft")
      throw new LibraryError("Only a draft may be published");
    if (action === "publish") {
      if (
        m.kind === "policy" &&
        !m.content?.policyText.trim() &&
        !m.content?.policyAttachmentId
      )
        throw new LibraryError("Actual policy content required", 400);
      if (m.kind === "bundle") {
        const b = BundleDefinitionSchema.parse(record.bundleDefinition);
        for (const entry of b.entries) {
          const item = await libraryRecord(
            tx,
            actor,
            entry.templateId,
            true,
            true,
          );
          if (
            item.metadata.kind === "bundle" ||
            item.metadata.state !== "published" ||
            item.metadata.contentVersion !== entry.contentVersion
          )
            throw new LibraryError(
              "Bundle requires published pinned content versions",
              400,
            );
        }
      }
      m.fileSnapshots = await snapshotFiles(tx, actor, id, m);
      m.publishedAt = new Date().toISOString();
      if (m.kind === "poll")
        m.pollClosesAt = new Date(
          Date.now() + m.content!.poll!.durationHours * 3600000,
        ).toISOString();
    }
    m.state = action === "publish" ? "published" : "archived";
    m.version++;
    if (action === "archive") m.archivedAt = new Date().toISOString();
    await tx
      .update(templates)
      .set({ libraryMetadata: m })
      .where(eq(templates.id, id));
    return {
      itemId: id,
      state: m.state,
      version: m.version,
      notificationState: "none",
    };
  });
}
