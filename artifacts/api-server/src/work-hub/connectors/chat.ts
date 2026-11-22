import {
  ConnectorError,
  graph,
  slack,
  segment,
  type Provider,
} from "./providers";
import { textOnly } from "./mail";
export async function conversations(
  p: Provider,
  t: string,
  kind: "chats" | "channels",
  cursor?: string,
  team?: string,
) {
  if (p === "slack") {
    const r = await slack(t, "users.conversations", {
      types: kind === "chats" ? "im,mpim" : "public_channel,private_channel",
      exclude_archived: true,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    const items = [];
    for (const c of r.channels || []) {
      let name = c.name || c.id;
      if (c.is_im && c.user) {
        const u = await slack(t, "users.info", { user: c.user });
        name =
          u.user?.profile?.display_name ||
          u.user?.real_name ||
          u.user?.name ||
          name;
      }
      items.push({ id: c.id, name, kind });
    }
    return { items, next: r.response_metadata?.next_cursor || undefined };
  }
  if (p !== "teams") throw new ConnectorError("chat_account_required", 400);
  let path =
    kind === "chats"
      ? "/me/chats?$expand=members&$top=50"
      : team
        ? `/teams/${segment(team)}/channels`
        : "/me/joinedTeams";
  if (cursor) {
    const u = new URL(Buffer.from(cursor, "base64url").toString());
    const expected = new URL(`https://graph.microsoft.com/v1.0${path}`);
    if (u.origin !== expected.origin || u.pathname !== expected.pathname)
      throw new ConnectorError("invalid_cursor", 400);
    path = u.pathname.slice(5) + u.search;
  }
  const r = await graph(t, path);
  const items = (r.value || []).map((c: any) => ({
    id: team ? `${team}/${c.id}` : c.id,
    name:
      c.topic ||
      c.displayName ||
      (c.members || []).map((m: any) => m.displayName).join(", ") ||
      "Chat",
    kind,
    team: kind === "channels" && !team,
  }));
  return {
    items,
    next: r["@odata.nextLink"]
      ? Buffer.from(r["@odata.nextLink"]).toString("base64url")
      : undefined,
  };
}
function teamsPath(kind: string, id: string) {
  if (kind === "chats") return `/chats/${segment(id)}/messages`;
  const [team, channel, ...extra] = id.split("/");
  if (!team || !channel || extra.length)
    throw new ConnectorError("invalid_channel", 400);
  return `/teams/${segment(team)}/channels/${segment(channel)}/messages`;
}
export async function chatMessages(
  p: Provider,
  t: string,
  kind: "chats" | "channels",
  id: string,
  cursor?: string,
  thread?: string,
) {
  if (p === "slack") {
    const r = await slack(
      t,
      thread ? "conversations.replies" : "conversations.history",
      {
        channel: id,
        limit: 15,
        ...(cursor ? { cursor } : {}),
        ...(thread ? { ts: thread } : {}),
      },
    );
    const people = new Map<string, string>();
    const items = [];
    for (const m of r.messages || []) {
      const user = m.user || "";
      if (user && !people.has(user)) {
        const u = await slack(t, "users.info", { user });
        people.set(
          user,
          u.user?.profile?.display_name || u.user?.real_name || user,
        );
      }
      items.push({
        id: m.ts,
        text: m.text || "",
        from: people.get(user) || m.username || "Slack",
        date: new Date(Number(m.ts) * 1000).toISOString(),
        replies: m.reply_count || 0,
      });
    }
    return {
      items: items.reverse(),
      next: r.response_metadata?.next_cursor || undefined,
    };
  }
  if (p !== "teams") throw new ConnectorError("chat_account_required", 400);
  const base =
    teamsPath(kind, id) + (thread ? `/${segment(thread)}/replies` : "");
  let path = `${base}?$top=50`;
  if (cursor) {
    const u = new URL(Buffer.from(cursor, "base64url").toString());
    if (
      u.origin !== "https://graph.microsoft.com" ||
      u.pathname !== `/v1.0${base}`
    )
      throw new ConnectorError("invalid_cursor", 400);
    path = u.pathname.slice(5) + u.search;
  }
  const r = await graph(t, path);
  return {
    items: (r.value || [])
      .map((m: any) => ({
        id: m.id,
        text: textOnly(m.body?.content || ""),
        from:
          m.from?.user?.displayName ||
          m.from?.application?.displayName ||
          "Teams",
        date: m.createdDateTime,
        replies: kind === "channels" && !thread ? 1 : 0,
      }))
      .reverse(),
    next: r["@odata.nextLink"]
      ? Buffer.from(r["@odata.nextLink"]).toString("base64url")
      : undefined,
  };
}
export async function sendChat(
  p: Provider,
  t: string,
  kind: "chats" | "channels",
  id: string,
  text: string,
  operationId: string,
  thread?: string,
) {
  if (p === "slack") {
    const r = await slack(t, "chat.postMessage", {
      channel: id,
      text,
      client_msg_id: operationId,
      ...(thread ? { thread_ts: thread } : {}),
    });
    return { id: r.ts };
  }
  if (p !== "teams") throw new ConnectorError("chat_account_required", 400);
  return graph(
    t,
    teamsPath(kind, id) + (thread ? `/${segment(thread)}/replies` : ""),
    "POST",
    { body: { contentType: "text", content: text } },
  );
}
