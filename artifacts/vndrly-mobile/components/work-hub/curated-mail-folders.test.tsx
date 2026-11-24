import { expect, it } from "vitest";
import { curatedMailFolders } from "./curated-mail-folders";

it("keeps only the requested Outlook folders in the requested order", () => {
  const folders = ["Archive", "Conversation History", "Deleted Items", "Drafts", "Inbox", "Junk Email", "Outbox", "RSS Feeds", "Sent Items", "Sync Issues"].map(name => ({ id: name, name }));
  expect(curatedMailFolders(folders, "outlook").map(folder => nameAndId(folder))).toEqual([
    "Inbox:Inbox", "Sent:Sent Items", "Drafts:Drafts", "Junk:Junk Email", "Deleted:Deleted Items", "RSS Feeds:RSS Feeds",
  ]);
});

it("places Gmail inbox labels immediately after Inbox", () => {
  const folders = ["SENT", "INBOX", "Custom", "Inbox/Projects", "TRASH", "DRAFT", "SPAM"].map(id => ({ id, name: id }));
  expect(curatedMailFolders(folders, "gmail").map(folder => folder.name)).toEqual([
    "Inbox", "Inbox/Projects", "Sent", "Drafts", "Junk", "Deleted",
  ]);
});

function nameAndId(folder: { name: string; id: string }) {
  return `${folder.name}:${folder.id}`;
}
