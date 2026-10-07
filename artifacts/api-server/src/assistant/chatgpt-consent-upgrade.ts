import type { SessionPayload } from "../lib/session";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { CHATGPT_WRITE_CAPABILITIES } from "./chatgpt-write-capabilities";

export const FINANCE_SECURITY_SCHEMES = [{ type: "oauth2" as const, scopes: ["finance:write"] }];
const financeNames = new Set<string>(CHATGPT_WRITE_CAPABILITIES["finance:write"].tools);

/** Hypothetical consent is used for discovery only, never for execution. */
export function financeConsentUpgradeTools(session: SessionPayload, scopes: readonly string[]) {
  if (scopes.includes("finance:write")) return [];
  return chatGptActionTools(session, [...scopes, "finance:write"]).filter(tool => financeNames.has(tool.name));
}

export function requiresFinanceConsent(session: SessionPayload, scopes: readonly string[], name: string, args: Record<string, unknown>) {
  const target = name === "v_prepare_action" ? args.toolName : name;
  return financeConsentUpgradeTools(session, scopes).some(tool => tool.name === target);
}

export function financeConsentChallenge(issuer: string, scopes: readonly string[]) {
  const scope = [...new Set([...scopes, "finance:write"])].join(" ");
  return { isError: true, content: [{ type: "text", text: "Additional finance consent is required. No change was prepared or submitted. Reauthorization can select another account. Sign into the intended VNDRLY account and verify the connection account before preparation." }],
    _meta: { "mcp/www_authenticate": [`Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Finance consent is required", scope="${scope}"`] } };
}

