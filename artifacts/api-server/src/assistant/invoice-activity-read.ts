import { pool } from "@workspace/db";
import type { Pool } from "pg";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { requireChatGptReadableTool } from "./chatgpt-tool-access";
import { readInvoiceActivityInTransaction } from "./invoice-activity-transaction-read";

const inputSchema = z.object({ basis: z.enum(["recorded_invoice_activity", "provider_acceptance"]).default("recorded_invoice_activity") }).strict();

/** Complete company chronology, not a createdAt window or a delivery assertion. */
export async function readInvoiceActivity(raw: unknown, session: SessionPayload, scopes: string[], database: Pick<Pool, "connect"> = pool, now = new Date()) {
  const input = inputSchema.parse(raw);
  requireChatGptReadableTool(session, scopes, "query_invoices");
  const type = session.role === "vendor" ? "vendor" : session.role === "partner" ? "partner" : null;
  const id = type === "vendor" ? session.vendorId : session.partnerId;
  if (!type || !id || !session.userId || !session.activeMembershipId || !session.sv || !Number.isFinite(now.getTime())) throw Error("invoice_activity.current_company_required");
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const result = await readInvoiceActivityInTransaction(input, session, client, now);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
