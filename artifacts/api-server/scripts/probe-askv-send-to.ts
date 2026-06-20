/**
 * One-shot probe: exxon partner → listSendToRecipientsForOrg + assistant send-to HTTP.
 * Usage: pnpm --filter @workspace/api-server exec tsx scripts/probe-askv-send-to.ts
 */
import "../../../scripts/load-env-local.mjs";
import crypto from "crypto";
import { desc, eq } from "drizzle-orm";
import {
  db,
  pool,
  assistantConversationsTable,
  assistantMessagesTable,
  userOrgMembershipsTable,
  usersTable,
} from "@workspace/db";
import { listSendToRecipientsForOrg } from "../src/lib/ticket-send-to.ts";

const API_BASE = process.env.PROBE_API_BASE ?? "http://localhost:8080";

async function main() {
  const [exxon] = await db
    .select({
      id: usersTable.id,
      sv: usersTable.sessionVersion,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(eq(usersTable.username, "exxon"))
    .limit(1);
  if (!exxon) {
    console.error("FAIL: exxon user not found");
    process.exit(1);
  }

  const [m] = await db
    .select({ partnerId: userOrgMembershipsTable.partnerId })
    .from(userOrgMembershipsTable)
    .where(eq(userOrgMembershipsTable.userId, exxon.id))
    .limit(1);

  const actor = {
    userId: exxon.id,
    role: "partner" as const,
    vendorId: null,
    partnerId: m?.partnerId ?? null,
    displayName: exxon.displayName,
  };

  const groups = await listSendToRecipientsForOrg(actor);
  const recipientCount = groups.reduce((s, g) => s + g.recipients.length, 0);
  console.log("OK org roster:", { groups: groups.length, recipientCount, partnerId: actor.partnerId });

  const [conv] = await db
    .select({ id: assistantConversationsTable.id })
    .from(assistantConversationsTable)
    .where(eq(assistantConversationsTable.userId, exxon.id))
    .orderBy(desc(assistantConversationsTable.updatedAt))
    .limit(1);

  if (!conv) {
    console.log("SKIP HTTP: no assistant conversation for exxon");
    return;
  }

  const [msg] = await db
    .select({ id: assistantMessagesTable.id, role: assistantMessagesTable.role })
    .from(assistantMessagesTable)
    .where(eq(assistantMessagesTable.conversationId, conv.id))
    .orderBy(desc(assistantMessagesTable.id))
    .limit(1);

  if (!msg || msg.role !== "assistant") {
    console.log("SKIP HTTP: no assistant message to share");
    return;
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("FAIL: SESSION_SECRET missing");
    process.exit(1);
  }

  const body = Buffer.from(
    JSON.stringify({
      userId: exxon.id,
      role: "partner",
      partnerId: m?.partnerId,
      displayName: exxon.displayName,
      exp: Math.floor(Date.now() / 1000) + 3600,
      sv: exxon.sv,
    }),
    "utf8",
  ).toString("base64");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const cookie = `${body}.${sig}`;

  const url = `${API_BASE}/api/assistant/messages/${msg.id}/send-to-recipients`;
  try {
    const res = await fetch(url, {
      headers: { Cookie: `vndrly_session=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    console.log("HTTP send-to-recipients:", res.status, text.slice(0, 500));
    if (!res.ok) process.exit(1);
  } catch (e) {
    console.log("SKIP HTTP (api not reachable):", e instanceof Error ? e.message : e);
    console.log("Org roster probe still OK — start api-server for full HTTP check.");
  }
}

main()
  .catch((e) => {
    console.error("ERR", e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
