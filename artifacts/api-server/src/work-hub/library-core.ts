import { and, eq, desc } from "drizzle-orm";
import {
  db,
  workHubFormTemplatesTable as templates,
  workHubAuditLogTable as audit,
} from "@workspace/db";
import {
  LibraryMetadataSchema,
  LibraryDraftSchema,
  type WorkHubCommandEnvelope,
} from "@workspace/api-zod";
import {
  campaignMember,
  campaignOwner,
  CampaignError,
  type CampaignActor,
  type CampaignTx,
} from "./form-campaign-service";
import { executeWorkHubCommand } from "./commands";
import {
  liveMeetingFingerprint,
  verifyLiveMeetingReplay,
} from "./live-meeting-fingerprint";
export { campaignOwner as libraryOwner, CampaignError as LibraryError };
export type LibraryActor = CampaignActor;
export type LibraryTx = CampaignTx;
export async function libraryAuthority(
  reader: Pick<typeof db, "select">,
  actor: LibraryActor,
  manage = false,
  lock = false,
) {
  const owner = campaignOwner(actor),
    member = await campaignMember(reader, actor, owner, lock);
  if (manage && member.role !== "admin")
    throw new CampaignError("Company administrator required", 403);
  return { owner, member };
}
export async function libraryRecord(
  reader: Pick<typeof db, "select">,
  actor: LibraryActor,
  id: string,
  manage = false,
  lock = false,
) {
  const { owner } = await libraryAuthority(reader, actor, manage, lock);
  const query = reader
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.id, id),
        eq(templates.ownerOrgType, owner.type),
        eq(templates.ownerOrgId, owner.id),
      ),
    )
    .limit(1);
  const [record] = await (lock ? query.for("update") : query);
  if (!record || record.campaignConfig)
    throw new CampaignError("Library item not found", 404);
  const metadata = record.libraryMetadata
    ? LibraryMetadataSchema.parse(record.libraryMetadata)
    : LibraryMetadataSchema.parse({
        kind: "form",
        seriesId: record.id,
        contentVersion: record.currentVersion,
        state: "published",
        content: LibraryDraftSchema.parse({
          kind: "form",
          title: record.name,
          fields: record.definition,
        }),
      });
  return { record, metadata, owner };
}
export async function libraryCommand<T extends Record<string, unknown>>(
  actor: LibraryActor,
  e: WorkHubCommandEnvelope,
  kind: string,
  itemId: string | null,
  run: (tx: LibraryTx) => Promise<T>,
  manage = true,
) {
  const owner = campaignOwner(actor);
  if (
    e.owner.type !== owner.type ||
    e.owner.id !== owner.id ||
    e.context.kind !== "organization" ||
    String(e.context.id) !== String(owner.id)
  )
    throw new CampaignError("Current company required", 403);
  const fingerprint = liveMeetingFingerprint(
    actor.userId,
    kind,
    itemId ?? "new",
    e,
  );
  const result = await executeWorkHubCommand(
    { userId: actor.userId, source: actor.source ?? "web" },
    kind,
    e,
    async (tx) => {
      const resource = await run(tx);
      await tx
        .insert(audit)
        .values({
          ownerOrgType: owner.type,
          ownerOrgId: owner.id,
          actorUserId: actor.userId,
          source: actor.source ?? "web",
          action: kind,
          subjectType: "library",
          subjectId:
            itemId ?? String(resource.itemId ?? resource.instanceId ?? "new"),
          metadata: { operationId: e.operationId },
        });
      return { ...resource, commandFingerprint: fingerprint };
    },
    async (tx) => {
      await libraryAuthority(tx, actor, manage, true);
    },
  );
  verifyLiveMeetingReplay(result, fingerprint);
  return result;
}
export async function checkLibraryVersion(
  metadata: { version: number },
  e: WorkHubCommandEnvelope,
) {
  if (e.expectedVersion !== metadata.version)
    throw new CampaignError("Library item changed; refresh and review", 409);
}
