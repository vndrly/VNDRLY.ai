import { createItemizedFleetRepository } from "./fleet-itemized-repository";
import { z } from "zod/v4";
import {
  FleetDefinitionSchema,
  FleetGrantSchema,
  FleetRunSchema,
  FleetWorkspacePreferenceSchema,
  FleetSetupInputSchema,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
export const FleetStateSchema = z
  .object({
    version: z.number().int().positive(),
    enabled: z.boolean(),
    fleets: z.array(FleetDefinitionSchema).max(50),
    grants: z.array(FleetGrantSchema).max(500),
    supportGrants: FleetSetupInputSchema.shape.supportGrants
      .unwrap()
      .default([]),
    runs: z.array(FleetRunSchema).max(1000),
    preferences: z.array(FleetWorkspacePreferenceSchema).max(500).default([]),
    operations: z
      .array(
        z.object({
          id: z.uuid(),
          actorUserId: z.number().int().positive(),
          fingerprint: z.string(),
          runId: z.uuid(),
          result: FleetRunSchema,
        }),
      )
      .max(2000),
  })
  .strict();
export type FleetState = z.infer<typeof FleetStateSchema>;
export class FleetError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export const emptyFleetState = (): FleetState => ({
  version: 1,
  enabled: false,
  fleets: [],
  grants: [],
  supportGrants: [],
  runs: [],
  operations: [],
  preferences: [],
});
export type FleetSessionAuthority = {
  sv?: number;
  activeMembershipId?: number | null;
  membershipRole?: string | null;
  role?: string;
  vendorPeopleId?: number | null;
  operationId?: string;
};
export interface FleetRepository {
  transaction<T>(
    companyId: number,
    actorUserId: number,
    operation: (state: FleetState, client: PoolClient) => Promise<T>,
    authority?: FleetSessionAuthority,
  ): Promise<T>;
}
/** A bounded vendor aggregate serializes dispatch and grants. Never silently drops history. */
const boundedFleetRepository: FleetRepository = {
  async transaction(companyId, actorUserId, operation, authority) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (
        !authority ||
        !Number.isInteger(authority.sv) ||
        !Number.isInteger(authority.activeMembershipId) ||
        !["vendor", "field_employee"].includes(authority.role ?? "")
      )
        throw new FleetError("fleet.current_session_required", 403);
      const member = await client.query(
        "SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.org_type='vendor' AND m.vendor_id=$2 AND m.id=$3 AND m.role=$4 AND u.session_version=$5 AND u.suspended_at IS NULL FOR SHARE OF m,u",
        [
          actorUserId,
          companyId,
          authority.activeMembershipId,
          authority.membershipRole,
          authority.sv,
        ],
      );
      if (!member.rows.length)
        throw new FleetError("fleet.membership_required", 403);
      if (authority.role === "field_employee") {
        const person = await client.query(
          "SELECT id FROM vendor_people WHERE id=$1 AND user_id=$2 AND vendor_id=$3 AND is_active=true AND deleted_at IS NULL FOR SHARE",
          [authority.vendorPeopleId, actorUserId, companyId],
        );
        if (
          !person.rows.length ||
          authority.membershipRole !== "field_employee"
        )
          throw new FleetError("fleet.current_person_required", 403);
      } else if (!["admin", "member"].includes(authority.membershipRole ?? ""))
        throw new FleetError("fleet.current_session_required", 403);
      const vendor = await client.query(
        "SELECT fleet_ops_state FROM vendors WHERE id=$1 FOR UPDATE",
        [companyId],
      );
      if (!vendor.rows.length) throw new FleetError("fleet.not_found", 404);
      const state = FleetStateSchema.parse(
        vendor.rows[0].fleet_ops_state ?? emptyFleetState(),
      );
      const previous = JSON.stringify({ ...state, operations: [] });
      if (authority.operationId) {
        const stored = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-operation' AND target_id=$1 AND vendor_id=$2 AND action_type='fleet-operation-result' LIMIT 1",
          [authority.operationId, companyId],
        );
        if (stored.rows.length)
          state.operations = [
            FleetStateSchema.shape.operations.element.parse(
              stored.rows[0].tool_output,
            ),
          ];
      }
      const previousOperations = new Set(state.operations.map((o) => o.id));
      const result = await operation(state, client);
      FleetStateSchema.parse(state);
      for (const op of state.operations.filter(
        (o) => !previousOperations.has(o.id),
      )) {
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,actor_role,actor_membership_role,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,$3,$4,'fleet','typed','canonical','fleet_operation','fleet-operation-result','fleet-operation',$5,$6::jsonb,$7::jsonb,'completed')",
          [
            actorUserId,
            authority.role,
            authority.membershipRole,
            companyId,
            op.id,
            JSON.stringify({ fingerprint: op.fingerprint, runId: op.runId }),
            JSON.stringify(op),
          ],
        );
      }
      const serialized = JSON.stringify({ ...state, operations: [] });
      if (Buffer.byteLength(serialized) > 4_000_000)
        throw new FleetError("fleet.store_capacity_reached");
      if (serialized !== previous)
        await client.query(
          "UPDATE vendors SET fleet_ops_state=$2::jsonb WHERE id=$1",
          [companyId, serialized],
        );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

export const databaseFleetRepository = createItemizedFleetRepository(
  boundedFleetRepository,
  (code = "fleet.active_run_capacity_reached", status = 409) =>
    new FleetError(code, status),
);
