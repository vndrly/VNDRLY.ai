import { pool } from "@workspace/db";
import { BillingError, billingInboxEntrySchema, billingStateSchema, billingTenantSchema, newBillingState, type BillingStore, type BillingTenant } from "./stripe-billing";

/** Dedicated raw SQL column intentionally excluded from normal org projections. */
export function createBillingRepository(mode: "test" | "live", connectionPool = pool): BillingStore {
  return {
    async withTenant(tenant, action) {
      billingTenantSchema.parse(tenant);
      const table = tenant.type === "vendor" ? "vendors" : "partners";
      const client = await connectionPool.connect();
      try {
        await client.query("BEGIN");
        // Serializes cross-table customer binding, so a customer cannot belong to
        // both a partner and vendor. This foundation favors correctness over throughput.
        await client.query("SELECT pg_advisory_xact_lock(923617041)");
        const result = await client.query(`SELECT stripe_billing_state FROM ${table} WHERE id=$1 FOR UPDATE`, [tenant.id]);
        if (!result.rows[0]) throw new BillingError("billing.tenant_not_found", 404);
        const state = result.rows[0].stripe_billing_state == null ? newBillingState(mode) : billingStateSchema.parse(result.rows[0].stripe_billing_state);
        const output = await action(state, client);
        billingStateSchema.parse(state);
        if (state.customerId) {
          const duplicate = await client.query(`SELECT 'vendor' AS type,id FROM vendors WHERE stripe_billing_state->>'customerId'=$1 UNION ALL SELECT 'partner' AS type,id FROM partners WHERE stripe_billing_state->>'customerId'=$1`, [state.customerId]);
          if (duplicate.rows.some(row => row.type !== tenant.type || row.id !== tenant.id)) throw new BillingError("billing.customer_binding_conflict", 409);
        }
        await client.query(`UPDATE ${table} SET stripe_billing_state=$2::jsonb WHERE id=$1`, [tenant.id, JSON.stringify(state)]);
        await client.query("COMMIT"); return output;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async findCustomer(customerId: string): Promise<BillingTenant | null> {
      const result = await connectionPool.query(`SELECT 'vendor' AS type,id FROM vendors WHERE stripe_billing_state->>'customerId'=$1 UNION ALL SELECT 'partner' AS type,id FROM partners WHERE stripe_billing_state->>'customerId'=$1`, [customerId]);
      if (result.rows.length > 1) throw new BillingError("billing.customer_binding_conflict", 409);
      return result.rows[0] ? billingTenantSchema.parse(result.rows[0]) : null;
    },
    async pendingEvents(limit) {
      const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
      const result = await connectionPool.query(`SELECT entry FROM (
        SELECT inbox.value AS entry,inbox.key AS event_id FROM vendors v CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(v.stripe_billing_state->'inbox')='object' THEN v.stripe_billing_state->'inbox' ELSE '{}'::jsonb END) inbox
        UNION ALL
        SELECT inbox.value AS entry,inbox.key AS event_id FROM partners p CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.stripe_billing_state->'inbox')='object' THEN p.stripe_billing_state->'inbox' ELSE '{}'::jsonb END) inbox
      ) pending WHERE entry->>'nextAttemptAt'<=$2 ORDER BY entry->>'nextAttemptAt',event_id LIMIT $1`, [bounded, new Date().toISOString()]);
      return result.rows.flatMap(row => { const parsed = billingInboxEntrySchema.safeParse(row.entry); return parsed.success ? [parsed.data.event] : []; });
    },
  };
}
