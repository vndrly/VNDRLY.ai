/**
 * Probe send-to recipients (direct + HTTP) for common demo users.
 *   pnpm --filter @workspace/api-server exec tsx scripts/probe-send-to.ts
 */
import crypto from "crypto";
import "../../../scripts/load-env-local.mjs";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, notificationsTable, userOrgMembershipsTable, usersTable } from "@workspace/db";
import { parseTicketIdFromHref } from "../src/lib/parse-ticket-href";
import {
  actorCanSendToTicket,
  listSendToRecipients,
} from "../src/lib/ticket-send-to";

const API = process.env.PROBE_API_BASE ?? "http://localhost:8080";

function signSessionCookie(payload: object, sv?: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET missing");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp, ...(typeof sv === "number" ? { sv } : {}) }),
    "utf8",
  ).toString("base64");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `vndrly_session=${body}.${sig}`;
}

async function probeUser(username: string, sessionExtras: Record<string, unknown> = {}) {
  const [userRow] = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      role: usersTable.role,
      sessionVersion: usersTable.sessionVersion,
    })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  const user = userRow;

  if (!user) {
    console.log(`\n== ${username}: user not found ==`);
    return;
  }

  console.log(`\n== ${username} (id=${user.id}, role=${user.role}) ==`);

  const rows = await db
    .select({
      id: notificationsTable.id,
      link: notificationsTable.link,
    })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, user.id), isNotNull(notificationsTable.link)))
    .orderBy(desc(notificationsTable.id))
    .limit(10);

  const withTicket = rows.filter((r) => parseTicketIdFromHref(r.link ?? "") !== null);
  console.log(`owned ticket notifications: ${withTicket.length}`);
  if (!withTicket.length) return;

  console.log(`  sessionVersion=${user.sessionVersion}`);

  const [membership] = await db
    .select({
      orgType: userOrgMembershipsTable.orgType,
      role: userOrgMembershipsTable.role,
      vendorId: userOrgMembershipsTable.vendorId,
      partnerId: userOrgMembershipsTable.partnerId,
    })
    .from(userOrgMembershipsTable)
    .where(eq(userOrgMembershipsTable.userId, user.id))
    .limit(1);

  const sessionVendorId =
    (sessionExtras.vendorId as number | null | undefined) ??
    (membership?.orgType === "vendor" ? membership.vendorId : null);
  const sessionPartnerId =
    (sessionExtras.partnerId as number | null | undefined) ??
    (membership?.orgType === "partner" ? membership.partnerId : null);

  const n = withTicket[0];
  const ticketId = parseTicketIdFromHref(n.link ?? "")!;
  const actor = {
    userId: user.id,
    role: user.role,
    vendorId: sessionVendorId,
    partnerId: sessionPartnerId,
    displayName: user.displayName,
    fieldEmployee: null,
  };

  try {
    const allowed = await actorCanSendToTicket(ticketId, actor);
    console.log(`notification ${n.id} ticket ${ticketId}: actorCanSendTo=${allowed}`);
    if (allowed) {
      const groups = await listSendToRecipients(ticketId, actor);
      console.log(
        `  direct: groups=${groups.length} recipients=${groups.reduce((s, g) => s + g.recipients.length, 0)}`,
      );
    }
  } catch (err) {
    console.error("  direct ERROR", err);
  }

  const cookie = signSessionCookie(
    {
      userId: user.id,
      role: user.role,
      membershipRole: membership?.role ?? null,
      vendorId: sessionVendorId,
      partnerId: sessionPartnerId,
      displayName: user.displayName,
    },
    user.sessionVersion,
  );
  const res = await fetch(`${API}/api/notifications/${n.id}/send-to-recipients`, {
    headers: { Cookie: cookie },
  });
  const text = await res.text();
  console.log(`  HTTP: ${res.status} ${text.slice(0, 200)}`);
}

async function main() {
  const [bakerMembership] = await db
    .select({ vendorId: userOrgMembershipsTable.vendorId })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(userOrgMembershipsTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, "baker"), eq(userOrgMembershipsTable.orgType, "vendor")))
    .limit(1);

  const [exxonMembership] = await db
    .select({ partnerId: userOrgMembershipsTable.partnerId })
    .from(userOrgMembershipsTable)
    .innerJoin(usersTable, eq(userOrgMembershipsTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, "exxon"), eq(userOrgMembershipsTable.orgType, "partner")))
    .limit(1);

  await probeUser("admin");
  await probeUser("baker", { vendorId: null });
  await probeUser("baker", { vendorId: bakerMembership?.vendorId ?? null });
  await probeUser("exxon", { partnerId: null });
  await probeUser("exxon", { partnerId: exxonMembership?.partnerId ?? null });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
