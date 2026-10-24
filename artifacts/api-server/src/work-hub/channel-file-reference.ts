import { WorkHubAccessError } from "./context-access";

type Source = { id: string; orgType: string; orgId: number; data: Record<string, unknown> };
type Channel = { id: string; ownerOrgType: string; ownerOrgId: number; contextKind: string };
export function channelFileReference(source: Source, target: Channel, actorId: number) {
  if (target.contextKind === "chat" || target.id === source.data.channelId || target.ownerOrgType !== source.orgType || target.ownerOrgId !== source.orgId)
    throw new WorkHubAccessError("forbidden");
  if (source.data.state !== "active" || !source.data.currentFileId || !Array.isArray(source.data.versions) || !source.data.versions.includes(source.data.currentFileId))
    throw new Error("An active, finalized file is required");
  return {
    orgType: source.orgType, orgId: source.orgId, kind: "document",
    recordKey: `channel-file:${target.id}:${source.data.currentFileId}`, createdBy: actorId,
    // Only the explicitly shared version is exposed. No source chat, history, or earlier versions.
    data: { scope: "channel", channelId: target.id, state: "active", name: source.data.name,
      contentType: source.data.contentType, byteSize: source.data.byteSize,
      currentFileId: source.data.currentFileId, versions: [source.data.currentFileId] },
  };
}
