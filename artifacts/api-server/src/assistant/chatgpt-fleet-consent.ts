import type { FleetOverview } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { chatGptActionTools, chatGptReadableTools } from "./chatgpt-tool-access";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { CHATGPT_WRITE_CAPABILITIES } from "./chatgpt-write-capabilities";

export function fleetToolSecuritySchemes(name: string, grantedScopes: readonly string[] = []) {
  const matches = [...Object.entries(CHATGPT_READ_CAPABILITIES), ...Object.entries(CHATGPT_WRITE_CAPABILITIES)]
    .filter(([scope, capability]) => scope.startsWith("fleet:") && (capability.tools as readonly string[]).includes(name));
  const scope = (matches.find(([scope]) => grantedScopes.includes(scope)) ?? matches[0])?.[0];
  return scope ? [{ type: "oauth2" as const, scopes: [scope] }] : undefined;
}

/** Trusted current Fleet capabilities select discovery hints, never execution authority. */
export function fleetConsentUpgradeTools(session: SessionPayload, scopes: readonly string[], overview: FleetOverview | null) {
  if (!overview || !session.vendorId || overview.companyId !== session.vendorId) return [];
  const eligible = new Set<string>();
  if (overview.roles.length || overview.capabilities.canSetup) eligible.add("fleet:read");
  if (overview.capabilities.canDispatch) eligible.add("fleet:dispatch");
  if (overview.capabilities.canDrive) eligible.add("fleet:run");
  if (overview.capabilities.canManage) eligible.add("fleet:review");
  if (overview.capabilities.canMaintain === true) eligible.add("fleet:maintenance");
  if (overview.capabilities.canSetup) eligible.add("fleet:admin");
  const available = new Set([...chatGptReadableTools(session, scopes), ...chatGptActionTools(session, scopes)].map(tool => tool.name));
  const candidates = [...eligible].filter(scope => !scopes.includes(scope)).flatMap(scope => {
    const reads = CHATGPT_READ_CAPABILITIES[scope as keyof typeof CHATGPT_READ_CAPABILITIES];
    const writes = CHATGPT_WRITE_CAPABILITIES[scope as keyof typeof CHATGPT_WRITE_CAPABILITIES];
    const names = new Set<string>([...(reads?.tools ?? []), ...(writes?.tools ?? [])]);
    return [...chatGptReadableTools(session, [...scopes, scope]), ...chatGptActionTools(session, [...scopes, scope])]
      .filter(tool => names.has(tool.name) && !available.has(tool.name)
        && (tool.name !== "query_fleet_resources" || overview.capabilities.canDispatch)
        && (tool.name !== "query_fleet_settings" || overview.capabilities.canSetup))
      .map(tool => ({ tool, scope }));
  });
  return [...new Map(candidates.map(item => [item.tool.name, item])).values()];
}

export function fleetConsentChallenge(issuer: string, scopes: readonly string[], requiredScope: string) {
  const scope = [...new Set([...scopes, requiredScope])].join(" ");
  return { isError: true, content: [{ type: "text", text: "Additional Fleet consent is required. No Fleet records were returned or changes prepared by this request. Reauthorize the intended VNDRLY account and verify its identity and permissions before continuing." }],
    _meta: { "mcp/www_authenticate": [`Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Fleet consent is required", scope="${scope}"`] } };
}

/** Choices must come from the trusted site service under the current Partner membership. */
export function partnerFleetConsentUpgradeTools(session: SessionPayload, scopes: readonly string[], choices: {sites: {siteId: number}[]} | null) {
  if(session.role!=="partner" || !session.partnerId || !choices?.sites.length || scopes.includes("fleet:read")) return [];
  return chatGptReadableTools(session,[...scopes,"fleet:read"]).filter(tool=>tool.name==="query_fleet_site_activity").map(tool=>({tool,scope:"fleet:read"}));
}

/** Platform title alone never grants company access; choices require an active support grant. */
export function supportFleetConsentUpgradeTools(session: SessionPayload, scopes: readonly string[], choices: {companies: unknown[]} | null) {
  if(session.role!=="admin" || !session.userId || !choices?.companies.length || scopes.includes("fleet:read")) return [];
  return chatGptReadableTools(session,[...scopes,"fleet:read"]).filter(tool=>tool.name==="query_fleet_support").map(tool=>({tool,scope:"fleet:read"}));
}
