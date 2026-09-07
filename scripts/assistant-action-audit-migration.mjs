import { createHash } from "node:crypto";

// Pins the four normalized statements in the existing chunk_388 migration:
// CREATE TABLE IF NOT EXISTS assistant_action_audit and its three indexes.
// Changing any column, target, constraint, index, or adding SQL fails closed.
const APPROVED_SQL_SHA256 = "94d8eaec6458e821d4d0b35d8d58e9045f1108039f8379261f434574f9949c62";
const EXPECTED_COLUMNS = [
  ["id", "integer", "NO"], ["user_id", "integer", "YES"],
  ["actor_role", "text", "YES"], ["actor_membership_role", "text", "YES"],
  ["partner_id", "integer", "YES"], ["vendor_id", "integer", "YES"], ["vendor_people_id", "integer", "YES"],
  ["client_surface", "text", "NO"], ["input_mode", "text", "NO"], ["provider", "text", "NO"],
  ["conversation_id", "integer", "YES"], ["assistant_message_id", "integer", "YES"],
  ["tool_name", "text", "NO"], ["action_type", "text", "NO"],
  ["target_type", "text", "YES"], ["target_id", "text", "YES"], ["transcript_text", "text", "YES"],
  ["parsed_intent", "jsonb", "YES"], ["tool_input", "jsonb", "YES"], ["tool_output", "jsonb", "YES"],
  ["confidence", "real", "YES"], ["confirmation_phrase", "text", "YES"],
  ["gps_latitude", "real", "YES"], ["gps_longitude", "real", "YES"], ["gps_accuracy_meters", "real", "YES"],
  ["result_status", "text", "NO"], ["error_code", "text", "YES"], ["error_message", "text", "YES"],
  ["created_at", "timestamp with time zone", "NO"],
];

export function parseAssistantActionAuditMigration(sqlText) {
  const statements = String(sqlText).split(";").map(statement => statement.trim().replace(/\s+/g, " ")).filter(Boolean);
  const digest = createHash("sha256").update(statements.join(";"), "utf8").digest("hex");
  if (statements.length !== 4 || digest !== APPROVED_SQL_SHA256) {
    throw new Error("Migration must contain exactly the approved assistant_action_audit table and three indexes from chunk_388");
  }
  return statements;
}

export async function runAssistantActionAuditMigration(client, sqlText) {
  const statements = parseAssistantActionAuditMigration(sqlText);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    for (const statement of statements) await client.query(statement);
    // Supabase's public schema can inherit browser-role grants by default.
    // The Express server uses its private database role and enforces user RBAC.
    await client.query('ALTER TABLE public."assistant_action_audit" ENABLE ROW LEVEL SECURITY');
    const browserRoles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname");
    const roles = ["PUBLIC", ...browserRoles.rows.map(row => {
      if (!["anon", "authenticated"].includes(row.rolname)) throw new Error("Unexpected browser role");
      return `"${row.rolname}"`;
    })].join(", ");
    await client.query(`REVOKE ALL ON TABLE public."assistant_action_audit" FROM ${roles}`);
    await client.query(`REVOKE ALL ON SEQUENCE public."assistant_action_audit_id_seq" FROM ${roles}`);

    const columns = await client.query(`SELECT column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistant_action_audit' ORDER BY ordinal_position`);
    if (JSON.stringify(columns.rows.map(row => [row.column_name, row.data_type, row.is_nullable])) !== JSON.stringify(EXPECTED_COLUMNS)) {
      throw new Error("assistant_action_audit column preflight failed; existing data will not be altered");
    }
    const indexes = await client.query(`SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'assistant_action_audit' ORDER BY indexname`);
    const expectedIndexes = {
      assistant_action_audit_pkey: "(id)", assistant_action_audit_target_idx: "(target_type, target_id, created_at)",
      assistant_action_audit_tool_idx: "(tool_name, created_at)", assistant_action_audit_user_idx: "(user_id, created_at)",
    };
    for (const [name, suffix] of Object.entries(expectedIndexes)) {
      const index = indexes.rows.find(row => row.indexname === name);
      if (!index?.indexdef.endsWith(suffix) || (name.endsWith("_pkey") && !index.indexdef.includes("UNIQUE INDEX"))) {
        throw new Error("assistant_action_audit index preflight failed");
      }
    }
    const foreignKeys = await client.query(`SELECT a.attname AS column_name, f.confrelid::regclass::text AS target, f.confdeltype
      FROM pg_constraint f JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = f.conkey[1]
      WHERE f.conrelid = 'public.assistant_action_audit'::regclass AND f.contype = 'f' ORDER BY a.attname`);
    if (JSON.stringify(foreignKeys.rows) !== JSON.stringify([
      { column_name: "assistant_message_id", target: "assistant_messages", confdeltype: "n" },
      { column_name: "conversation_id", target: "assistant_conversations", confdeltype: "n" },
      { column_name: "user_id", target: "users", confdeltype: "n" },
    ])) throw new Error("assistant_action_audit foreign-key preflight failed");
    const security = await client.query(`SELECT c.relrowsecurity AS rls_enabled,
      (r.rolsuper OR r.rolbypassrls OR c.relowner = r.oid) AS server_access,
      pg_get_serial_sequence('public.assistant_action_audit', 'id') = 'public.assistant_action_audit_id_seq' AS serial_ready,
      NOT EXISTS (SELECT 1 FROM pg_class object CROSS JOIN LATERAL aclexplode(object.relacl) grant_row
        WHERE object.oid IN ('public.assistant_action_audit'::regclass, 'public.assistant_action_audit_id_seq'::regclass) AND grant_row.grantee = 0) AS public_denied
      FROM pg_class c JOIN pg_roles r ON r.rolname = current_user WHERE c.oid = 'public.assistant_action_audit'::regclass`);
    const state = security.rows[0];
    if (!state?.rls_enabled || !state.server_access || !state.serial_ready || !state.public_denied) {
      throw new Error("assistant_action_audit RLS/server-access preflight failed");
    }
    const access = await client.query(`SELECT rolname,
      has_table_privilege(rolname, 'public.assistant_action_audit', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(rolname, 'public.assistant_action_audit', 'SELECT,INSERT,UPDATE,REFERENCES')
        OR has_sequence_privilege(rolname, 'public.assistant_action_audit_id_seq', 'USAGE,SELECT,UPDATE') AS has_access
      FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname`);
    if (access.rows.some(row => row.has_access)) throw new Error("assistant_action_audit must deny browser-role table, column and sequence access");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
