import fs from "node:fs";
import { ASK_V_TOOL_REGISTRY } from "../src/assistant/tool-registry";
import { chatGptReadableTools, chatGptActionTools } from "../src/assistant/chatgpt-tool-access";
import { CHATGPT_READ_CAPABILITIES } from "../src/assistant/chatgpt-read-capabilities";
import { CHATGPT_WRITE_CAPABILITIES } from "../src/assistant/chatgpt-write-capabilities";
import type { SessionPayload } from "../src/lib/session";

// Pure descriptor audit: no credentials, database, network or real tenant access.
const scopes = ["gate:read", "gate:write", "work_hub:read", "work_hub:write", ...Object.keys(CHATGPT_READ_CAPABILITIES), ...Object.keys(CHATGPT_WRITE_CAPABILITIES)];
const identities: Record<string, SessionPayload> = {
  platform_admin: { userId: 1, role: "admin" },
  partner_admin: { userId: 1, role: "partner", partnerId: 1, membershipRole: "admin" },
  vendor_admin: { userId: 1, role: "vendor", vendorId: 1, membershipRole: "admin" },
  office: { userId: 1, role: "vendor", vendorId: 1, membershipRole: "member" },
  field_employee: { userId: 1, role: "field_employee", vendorId: 1, vendorPeopleId: 1, vendorRole: "field" },
  foreman: { userId: 1, role: "field_employee", vendorId: 1, vendorPeopleId: 1, vendorRole: "foreman" },
  gatekeeper: { userId: 1, role: "field_employee", vendorId: 1, vendorPeopleId: 1, vendorRole: "gatekeeper" },
  gate_supervisor: { userId: 1, role: "field_employee", vendorId: 1, vendorPeopleId: 1, vendorRole: "gate_supervisor" },
};
const rows = Object.entries(identities).map(([persona, session]) => {
  const reads = chatGptReadableTools(session, scopes).map(tool => tool.name).sort();
  const writes = chatGptActionTools(session, scopes).map(tool => tool.name).sort();
  return { persona, reads, writes, readCount: reads.length, writeCount: writes.length };
});
const exposed = new Set(rows.flatMap(row => [...row.reads, ...row.writes]));
const output = { generatedAt: new Date().toISOString(), descriptorAuditOnly: true,
  warning: "All optional scopes are hypothetical here. Descriptor availability does not prove company/site assignments, current grants, canonical endpoint permission or successful execution. Fleet Manager, Dispatcher and Driver await Fleet backend integration.",
  registeredCount: ASK_V_TOOL_REGISTRY.length, exposedUnionCount: exposed.size,
  missing: ASK_V_TOOL_REGISTRY.filter(tool => !exposed.has(tool.name)).map(tool => ({ name: tool.name, execution: tool.execution, mutating: tool.mutating })), rows };
const destination = process.argv[2];
if (destination) fs.writeFileSync(destination, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ registeredCount: output.registeredCount, exposedUnionCount: output.exposedUnionCount, missing: output.missing, roles: rows.map(({ persona, readCount, writeCount }) => ({ persona, readCount, writeCount })) }));

