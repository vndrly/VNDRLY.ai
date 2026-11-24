type MailFolder = { id: string; name?: string; children?: number };

const labels = ["Inbox", "Sent", "Drafts", "Junk", "Deleted", "RSS Feeds"] as const;

function folderLabel(folder: MailFolder): (typeof labels)[number] | null {
  const name = (folder.name ?? "").trim().toLowerCase();
  const id = folder.id.toLowerCase();
  if (name === "inbox" || id === "inbox") return "Inbox";
  if (["sent", "sent items", "sent mail"].includes(name) || id === "sent") return "Sent";
  if (["draft", "drafts"].includes(name) || id === "draft") return "Drafts";
  if (["junk", "junk email", "spam"].includes(name) || id === "spam") return "Junk";
  if (["deleted", "deleted items", "trash"].includes(name) || id === "trash") return "Deleted";
  if (name === "rss feeds") return "RSS Feeds";
  return null;
}

export function curatedMailFolders<T extends MailFolder>(folders: T[], provider: string): (T & { name: string })[] {
  const selected = folders.flatMap(folder => {
    const label = folderLabel(folder);
    if (label) return [{ ...folder, name: label, rank: labels.indexOf(label) }];
    if (provider === "gmail" && /^inbox\//i.test(folder.name ?? "")) return [{ ...folder, name: folder.name!, rank: 0.5 }];
    return [];
  });
  return selected.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}
