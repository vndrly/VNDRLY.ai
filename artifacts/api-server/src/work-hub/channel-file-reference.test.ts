import { expect, it } from "vitest";
import { channelFileReference } from "./channel-file-reference";
const source = { id: "document", orgType: "vendor", orgId: 1, data: { state: "active", channelId: "private-chat", currentFileId: "file-2", versions: ["file-1", "file-2"], name: "Watch.pdf", contentType: "application/pdf", byteSize: 99, privateNotes: "never forward" } };
const target = { id: "channel", contextKind: "gate", ownerOrgType: "vendor", ownerOrgId: 1 };
it("references the existing object without exposing the chat or previous versions", () => {
  const before = structuredClone(source);
  const result = channelFileReference(source, target, 7);
  expect(result.data.currentFileId).toBe("file-2");
  expect(result.data.versions).toEqual(["file-2"]);
  expect(result.data.channelId).toBe("channel");
  expect(JSON.stringify(result)).not.toContain("private-chat");
  expect(JSON.stringify(result)).not.toContain("never forward");
  expect(source).toEqual(before);
  expect(channelFileReference(source, target, 8).recordKey).toBe(result.recordKey);
});
it.each([{ ...target, contextKind: "chat" }, { ...target, ownerOrgId: 2 }, { ...target, id: "private-chat" }])("rejects an inappropriate target %j", channel => {
  expect(() => channelFileReference(source, channel, 7)).toThrow();
});
it.each(["recycled", "pending"])("rejects %s documents", state => {
  expect(() => channelFileReference({ ...source, data: { ...source.data, state } }, target, 7)).toThrow();
});
