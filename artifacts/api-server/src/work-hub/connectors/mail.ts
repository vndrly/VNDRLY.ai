import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import {
  ConnectorError,
  gmail,
  graph,
  segment,
  type Provider,
} from "./providers";
export const attachmentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => !/[\r\n]/.test(s)),
  type: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  data: z
    .string()
    .max(2800000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export const mailSchema = z
  .object({
    to: z.array(z.email()).max(100),
    cc: z.array(z.email()).max(100).default([]),
    bcc: z.array(z.email()).max(100).default([]),
    subject: z
      .string()
      .max(998)
      .refine((s) => !/[\r\n]/.test(s)),
    text: z.string().max(200000),
    attachments: z.array(attachmentSchema).max(10).default([]),
    replyId: z.string().max(2048).optional(),
    draftId: z.string().max(2048).optional(),
    mode: z.enum(["new", "reply", "forward"]).default("new"),
  })
  .refine(
    (m) =>
      m.attachments.reduce(
        (n, a) => n + Buffer.from(a.data, "base64").length,
        0,
      ) <= 2000000,
    "Attachments must total 2 MB or less",
  );
export type MailInput = z.infer<typeof mailSchema>;
export function textOnly(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function assertMail(p: Provider) {
  if (p !== "gmail" && p !== "outlook")
    throw new ConnectorError("mail_account_required", 400);
}
function nextGraph(value: any, prefix: string) {
  if (!value?.["@odata.nextLink"]) return undefined;
  const u = new URL(value["@odata.nextLink"]);
  const endpoint = prefix.slice(prefix.lastIndexOf("/") + 1);
  if (
    u.origin !== "https://graph.microsoft.com" ||
    !u.pathname.startsWith("/v1.0/me/") ||
    u.pathname.split("/").at(-1) !== endpoint ||
    !u.search
  )
    throw new ConnectorError("invalid_provider_cursor");
  // Graph may canonicalize a folder URL in nextLink. Keep only its paging
  // parameters and reapply them to the selected folder on the next request.
  return Buffer.from(u.search).toString("base64url");
}
function pageGraph(
  cursor: string | undefined,
  prefix: string,
  initial: string,
) {
  if (!cursor) return initial;
  const query = Buffer.from(cursor, "base64url").toString();
  if (!query.startsWith("?")) throw new ConnectorError("invalid_cursor", 400);
  const params = new URLSearchParams(query);
  if (
    ![...params.keys()].every(key => ["$top", "$select", "$orderby", "$search", "$skip", "$skiptoken"].includes(key)) ||
    !["$skip", "$skiptoken"].some(key => params.has(key)) ||
    (params.has("$top") && (!/^\d+$/.test(params.get("$top")!) || Number(params.get("$top")) > 50))
  )
    throw new ConnectorError("invalid_cursor", 400);
  return prefix + query;
}
export async function inboxSummary(p: Provider, t: string) {
  assertMail(p);
  const value = p === "gmail"
    ? await gmail(t, "/labels/INBOX")
    : await graph(t, "/me/mailFolders/inbox?$select=id,totalItemCount,unreadItemCount");
  return { total: p === "gmail" ? value.messagesTotal : value.totalItemCount, unread: (p === "gmail" ? value.messagesUnread : value.unreadItemCount) ?? 0 };
}
export async function folders(
  p: Provider,
  t: string,
  parent?: string,
  cursor?: string,
) {
  assertMail(p);
  if (p === "gmail") {
    const r = await gmail(t, "/labels");
    const standard = ["INBOX", "SENT", "DRAFT", "SPAM", "TRASH"];
    return {
      items: (r.labels || [])
        .filter(
          (l: any) =>
            standard.includes(l.id) || l.type === "user",
        )
        .sort((a: any, b: any) => {
          const rank = (id: string) => standard.includes(id) ? standard.indexOf(id) : standard.length;
          return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
        })
        .map((l: any) => ({
          id: l.id,
          name:
            (
              {
                INBOX: "Inbox",
                SENT: "Sent",
                DRAFT: "Drafts",
                SPAM: "Junk",
                TRASH: "Deleted",
                ALL: "All mail",
              } as Record<string, string>
            )[l.id] || l.name,
          children: 0,
        })),
    };
  }
  const path = parent
    ? `/me/mailFolders/${segment(parent)}/childFolders`
    : "/me/mailFolders";
  const r = await graph(
    t,
    pageGraph(cursor, path, `${path}?$top=100&includeHiddenFolders=false`),
  );
  return {
    items: (r.value || []).map((f: any) => ({
      id: f.id,
      name: f.displayName,
      unread: f.unreadItemCount,
      total: f.totalItemCount,
      children: f.childFolderCount,
    })),
    next: nextGraph(r, path),
  };
}
export async function folderCounts(p: Provider, t: string, parent?: string, cursor?: string) {
  const result = await folders(p, t, parent, cursor);
  if (p !== "gmail") return Object.fromEntries(result.items.map((f: any) => [f.id, f.total]));
  const totals: Record<string, number> = {};
  let next = 0;
  await Promise.all(Array.from({length: Math.min(5, result.items.length)}, async () => {
    while (next < result.items.length) {
      const folder = result.items[next++];
      const detail = await gmail(t, `/labels/${segment(folder.id)}`);
      totals[folder.id] = detail.messagesTotal;
    }
  }));
  return totals;
}
function outlookMessage(m: any) {
  return {
    id: m.id,
    subject: m.subject || "(No subject)",
    from: m.from?.emailAddress?.address || "",
    to: (m.toRecipients || []).map((v: any) => v.emailAddress.address),
    cc: (m.ccRecipients || []).map((v: any) => v.emailAddress.address),
    bcc: (m.bccRecipients || []).map((v: any) => v.emailAddress.address),
    text:
      m.body?.contentType?.toLowerCase() === "html"
        ? textOnly(m.body.content)
        : m.body?.content || m.bodyPreview || "",
    date: m.receivedDateTime || m.sentDateTime,
    unread: !m.isRead,
    starred: m.flag?.flagStatus === "flagged",
    draftId: m.isDraft ? m.id : undefined,
    hasAttachments: m.hasAttachments,
    attachments: [],
  };
}
function gmailMessage(m: any) {
  const headers = m.payload?.headers || [],
    h = (n: string) =>
      headers.find((v: any) => v.name.toLowerCase() === n)?.value || "";
  const attachments: any[] = [];
  let plain = "",
    html = "";
  function walk(part: any) {
    if (part.filename)
      attachments.push({
        id: part.body?.attachmentId || `part:${part.partId}`,
        name: part.filename,
        type: part.mimeType,
        size: part.body?.size || 0,
      });
    else if (part.body?.data) {
      const body = Buffer.from(part.body.data, "base64url").toString("utf8");
      if (part.mimeType === "text/plain") plain += body;
      else if (part.mimeType === "text/html") html += body;
    }
    (part.parts || []).forEach(walk);
  }
  if (m.payload) walk(m.payload);
  return {
    id: m.id,
    threadId: m.threadId,
    subject: h("subject") || "(No subject)",
    from: h("from"),
    to: h("to") ? [h("to")] : [],
    cc: h("cc") ? [h("cc")] : [],
    bcc: h("bcc") ? [h("bcc")] : [],
    text: plain || textOnly(html) || m.snippet || "",
    date: new Date(Number(m.internalDate) || 0).toISOString(),
    unread: (m.labelIds || []).includes("UNREAD"),
    starred: (m.labelIds || []).includes("STARRED"),
    isDraft: (m.labelIds || []).includes("DRAFT"),
    messageId: h("message-id"),
    references: h("references"),
    attachments,
  };
}
export async function messages(
  p: Provider,
  t: string,
  folder: string,
  cursor?: string,
  q?: string,
  limit?: number,
) {
  assertMail(p);
  if (p === "outlook") {
    const path = `/me/mailFolders/${segment(folder)}/messages`,
      params = new URLSearchParams({
        $top: String(limit ?? (cursor ? 25 : 5)),
        $select:
          "id,subject,from,toRecipients,ccRecipients,bodyPreview,receivedDateTime,isRead,isDraft,hasAttachments,flag",
      });
    if (q) params.set("$search", JSON.stringify(q));
    else params.set("$orderby", "receivedDateTime desc");
    const r = await graph(t, pageGraph(cursor, path, `${path}?${params}`));
    return {
      items: (r.value || []).map(outlookMessage),
      next: nextGraph(r, path),
    };
  }
  const drafts = folder === "DRAFT";
  const params = new URLSearchParams({ maxResults: String(limit ?? (cursor ? 25 : 5)) });
  if (!drafts) params.set("labelIds", folder);
  if (cursor) params.set("pageToken", cursor);
  if (q) params.set("q", q);
  if (!drafts) params.set("includeSpamTrash", "true");
  const r = await gmail(t, `${drafts ? "/drafts" : "/messages"}?${params}`);
  const rows = r[drafts ? "drafts" : "messages"] || [];
  const items = new Array(rows.length);
  let nextIndex = 0;
  // Keep ten requests in flight without making each batch wait for its slowest item.
  await Promise.all(Array.from({ length: Math.min(10, rows.length) }, async () => {
    while (nextIndex < rows.length) {
      const index = nextIndex++;
      const v = rows[index];
      items[index] = {
        ...gmailMessage(await gmail(t,
          `/messages/${segment(drafts ? v.message.id : v.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`)),
        ...(drafts ? { draftId: v.id } : {}),
      };
    }
  }));
  return { items, next: r.nextPageToken };
}
export async function message(p: Provider, t: string, id: string) {
  assertMail(p);
  if (p === "gmail")
    return gmailMessage(await gmail(t, `/messages/${segment(id)}?format=full`));
  const m = outlookMessage(await graph(t, `/me/messages/${segment(id)}`));
  const a = await graph(
    t,
    `/me/messages/${segment(id)}/attachments?$select=id,name,contentType,size`,
  );
  return {
    ...m,
    attachments: (a.value || [])
      .filter(
        (a: any) => a["@odata.type"] === "#microsoft.graph.fileAttachment",
      )
      .map((a: any) => ({
        id: a.id,
        name: a.name,
        type: a.contentType,
        size: a.size,
      })),
  };
}
export async function attachment(
  p: Provider,
  t: string,
  id: string,
  attachmentId: string,
) {
  assertMail(p);
  if (p === "outlook") {
    const a = await graph(
      t,
      `/me/messages/${segment(id)}/attachments/${segment(attachmentId)}`,
    );
    if (!a.contentBytes)
      throw new ConnectorError("attachment_unavailable", 404);
    return { data: a.contentBytes };
  }
  if (attachmentId.startsWith("part:")) {
    const m = await gmail(t, `/messages/${segment(id)}?format=full`);
    let data: string | undefined;
    function find(part: any) {
      if (part.partId === attachmentId.slice(5)) data = part.body?.data;
      (part.parts || []).forEach(find);
    }
    find(m.payload);
    if (!data) throw new ConnectorError("attachment_unavailable", 404);
    return { data: Buffer.from(data, "base64url").toString("base64") };
  }
  const a = await gmail(
    t,
    `/messages/${segment(id)}/attachments/${segment(attachmentId)}`,
  );
  return { data: Buffer.from(a.data, "base64url").toString("base64") };
}
const encoded = (s: string) =>
  `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
const lines = (s: string) => s.match(/.{1,76}/g)?.join("\r\n") || "";
export function mime(
  input: MailInput,
  from: string,
  reply?: { messageId: string; references: string },
) {
  const boundary = `vndrly_${randomUUID()}`;
  const headers = [
    `From: ${from}`,
    `To: ${input.to.join(", ")}`,
    `Cc: ${input.cc.join(", ")}`,
    `Bcc: ${input.bcc.join(", ")}`,
    `Subject: ${encoded(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (reply?.messageId && !/[\r\n]/.test(reply.messageId + reply.references))
    headers.push(
      `In-Reply-To: ${reply.messageId}`,
      `References: ${(reply.references + " " + reply.messageId).trim()}`,
    );
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines(Buffer.from(input.text).toString("base64"))}`,
  ];
  for (const a of input.attachments)
    parts.push(
      `--${boundary}\r\nContent-Type: ${a.type}\r\nContent-Disposition: attachment; filename="${encoded(a.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines(a.data)}`,
    );
  return Buffer.from(
    headers.join("\r\n") +
      "\r\n\r\n" +
      parts.join("\r\n") +
      `\r\n--${boundary}--\r\n`,
  ).toString("base64url");
}
export async function writeMail(
  p: Provider,
  t: string,
  label: string,
  input: MailInput,
  draft: boolean,
) {
  assertMail(p);
  if (!draft && !input.to.length)
    throw new ConnectorError("recipient_required", 400);
  if (p === "gmail") {
    const reply =
      input.mode === "reply" && input.replyId
        ? await message(p, t, input.replyId)
        : undefined;
    const raw = mime(input, label, reply as any),
      body = {
        raw,
        ...(reply && "threadId" in reply ? { threadId: reply.threadId } : {}),
      };
    if (draft)
      return gmail(
        t,
        input.draftId ? `/drafts/${segment(input.draftId)}` : "/drafts",
        input.draftId ? "PUT" : "POST",
        { message: body },
      );
    if (input.draftId)
      return gmail(t, "/drafts/send", "POST", {
        id: input.draftId,
        message: body,
      });
    return gmail(t, "/messages/send", "POST", body);
  }
  const recipients = (values: string[]) =>
    values.map((address) => ({ emailAddress: { address } }));
  const body = {
    subject: input.subject,
    body: { contentType: "Text", content: input.text },
    toRecipients: recipients(input.to),
    ccRecipients: recipients(input.cc),
    bccRecipients: recipients(input.bcc),
  };
  let id = input.draftId;
  let previousAttachments: { id: string }[] = [];
  if (id) {
    const existing = await graph(
      t,
      `/me/messages/${segment(id)}?$select=isDraft`,
    );
    if (!existing.isDraft) throw new ConnectorError("draft_required", 400);
    previousAttachments =
      (await graph(t, `/me/messages/${segment(id)}/attachments?$select=id`))
        .value || [];
    await graph(t, `/me/messages/${segment(id)}`, "PATCH", body);
  } else if (input.mode === "reply" && input.replyId) {
    const r = await graph(
      t,
      `/me/messages/${segment(input.replyId)}/createReply`,
      "POST",
      {},
    );
    id = r.id;
    await graph(t, `/me/messages/${segment(id!)}`, "PATCH", body);
  } else {
    const r = await graph(t, "/me/messages", "POST", body);
    id = r.id;
  }
  for (const a of input.attachments)
    await graph(t, `/me/messages/${segment(id!)}/attachments`, "POST", {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.type,
      contentBytes: a.data,
    });
  for (const a of previousAttachments)
    await graph(
      t,
      `/me/messages/${segment(id!)}/attachments/${segment(a.id)}`,
      "DELETE",
    );
  if (!draft) await graph(t, `/me/messages/${segment(id!)}/send`, "POST");
  return { id, sent: !draft };
}
export async function mutateMail(
  p: Provider,
  t: string,
  id: string,
  action: string,
  destination?: string,
  source?: string,
) {
  assertMail(p);
  if (action === "star" || action === "unstar") {
    if (p === "outlook") return graph(t, `/me/messages/${segment(id)}`, "PATCH", {flag:{flagStatus:action === "star" ? "flagged" : "notFlagged"}});
    return gmail(t, `/messages/${segment(id)}/modify`, "POST", {addLabelIds:action === "star" ? ["STARRED"] : [], removeLabelIds:action === "unstar" ? ["STARRED"] : []});
  }
  if (p === "outlook") {
    if (action === "read" || action === "unread")
      return graph(t, `/me/messages/${segment(id)}`, "PATCH", {
        isRead: action === "read",
      });
    return graph(t, `/me/messages/${segment(id)}/move`, "POST", {
      destinationId:
        action === "trash"
          ? "deleteditems"
          : action === "archive"
            ? "archive"
            : destination,
    });
  }
  if (action === "trash")
    return gmail(t, `/messages/${segment(id)}/trash`, "POST", {});
  return gmail(t, `/messages/${segment(id)}/modify`, "POST", {
    addLabelIds:
      action === "unread"
        ? ["UNREAD"]
        : action === "move" && destination
          ? [destination]
          : [],
    removeLabelIds:
      action === "read"
        ? ["UNREAD"]
        : action === "archive" || action === "move"
          ? [action === "move" ? source || "INBOX" : "INBOX"].filter(label => label !== destination)
          : [],
  });
}
