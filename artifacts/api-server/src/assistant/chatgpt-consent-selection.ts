import { AssistantOAuthError } from "./chatgpt-oauth";

/** Consent may narrow the signed client request, never add a permission. */
export function selectConsentedScopes(requested: readonly string[], input: unknown): string[] {
  const selected = typeof input === "string" ? [input] : input;
  if (!Array.isArray(selected) || !selected.length || selected.length > requested.length ||
      selected.some(scope => typeof scope !== "string" || !requested.includes(scope)) ||
      new Set(selected).size !== selected.length) throw new AssistantOAuthError("invalid_scope");
  return requested.filter(scope => selected.includes(scope));
}

