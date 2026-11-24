import { expect, it } from "vitest";
import { curatedMailFolders } from "./curated-mail-folders";

it("keeps approved roots in order while preserving Inbox child metadata", () => {
  expect(curatedMailFolders([
    { id: "archive", name: "Archive" },
    { id: "trash", name: "Deleted Items" },
    { id: "inbox", name: "Inbox", children: 3 },
    { id: "draft", name: "Drafts" },
    { id: "sent", name: "Sent Items" },
    { id: "spam", name: "Junk Email" },
    { id: "rss", name: "RSS Feeds" },
  ], "outlook").map(({ name, children }) => [name, children])).toEqual([
    ["Inbox", 3], ["Sent", undefined], ["Drafts", undefined],
    ["Junk", undefined], ["Deleted", undefined], ["RSS Feeds", undefined],
  ]);
});

it("retains Gmail Inbox subfolders without showing unrelated labels", () => {
  expect(curatedMailFolders([
    { id: "custom", name: "Inbox/Projects" },
    { id: "all", name: "All Mail" },
    { id: "inbox", name: "Inbox" },
  ], "gmail").map(({ name }) => name)).toEqual(["Inbox", "Inbox/Projects"]);
});
