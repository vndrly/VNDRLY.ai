import { workHubFilesTable as files, workHubFileLibraryTable as library } from "@workspace/db";
import type { LibraryTx } from "./library-core";

/** Index an existing channel upload without copying its object or changing its audience. */
export async function indexChannelRepositoryFile(tx: LibraryTx, file: typeof files.$inferSelect) {
  if (file.state !== "finalized") return;
  await tx.insert(library).values({
    id: file.id,
    orgType: file.ownerOrgType,
    orgId: file.ownerOrgId,
    kind: "document",
    recordKey: `source-file:${file.id}`,
    createdBy: file.uploadedById,
    createdAt: file.createdAt,
    updatedAt: file.finalizedAt ?? file.createdAt,
    data: {
      name: file.fileName, contentType: file.contentType, byteSize: file.byteSize,
      scope: file.channelId ? "channel" : "personal", channelId: file.channelId, state: "active",
      currentFileId: file.id, versions: [file.id], version: 1,
      sourceFileId: file.id, uploadSource: file.channelId ? "conversation" : "repository", purpose: null,
      categoryIds: [], folderId: null, tripId: null,
    },
  }).onConflictDoNothing();
}
