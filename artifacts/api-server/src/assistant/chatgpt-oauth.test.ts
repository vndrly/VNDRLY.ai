import { describe, it, expect } from "vitest";
import { ASSISTANT_RESOURCE, CHATGPT_CLIENT_ID, assistantPkceChallenge, validateAssistantAuthorization, issueAssistantCode, exchangeAssistantCode, refreshAssistantTokens, assistantAccessMatches, assistantTokenUserId } from "./chatgpt-oauth";

describe("assistant OAuth security", () => {
  const verifier = "x".repeat(43);
  const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
  const request = { client_id: CHATGPT_CLIENT_ID, redirect_uri: redirect, response_type: "code", resource: ASSISTANT_RESOURCE, code_challenge_method: "S256", code_challenge: assistantPkceChallenge(verifier), scope: "gate:read work_hub:read" };
  const fresh = () => issueAssistantCode(validateAssistantAuthorization(request, [redirect]), { userId: 17, role: "vendor", sv: 1 }, 1000);
  const exchange = (code: string) => ({ client_id: CHATGPT_CLIENT_ID, redirect_uri: redirect, resource: ASSISTANT_RESOURCE, code, code_verifier: verifier });
  it("requires exact registered redirects, S256, resource and scopes", () => {
    for (const override of [{ redirect_uri: `${redirect}?other=1` }, { code_challenge_method: "plain" }, { resource: "https://other.test/mcp" }, { scope: "payments:write" }, { client_id: "https://attacker.test/client.json" }]) {
      expect(() => validateAssistantAuthorization({ ...request, ...override }, [redirect])).toThrow();
    }
  });
  it("rejects wrong proof without consuming the valid code", () => {
    const { code, grant } = fresh();
    expect(() => exchangeAssistantCode(grant, { ...exchange(code), code_verifier: "z".repeat(43) }, 2000)).toThrow();
    const result = exchangeAssistantCode(grant, exchange(code), 2000);
    expect(assistantAccessMatches(grant, result.access_token, 2000)).toBe(true);
    expect(() => exchangeAssistantCode(grant, exchange(code), 2000)).toThrow();
  });
  it("expires codes and access tokens", () => {
    const { code, grant } = fresh();
    expect(() => exchangeAssistantCode(grant, exchange(code), 301000)).toThrow();
    const result = exchangeAssistantCode(grant, exchange(code), 2000);
    expect(assistantAccessMatches(grant, result.access_token, 602000)).toBe(false);
  });
  it("rotates refresh tokens and revokes a replayed grant", () => {
    const { code, grant } = fresh();
    const first = exchangeAssistantCode(grant, exchange(code), 2000);
    const args = { client_id: CHATGPT_CLIENT_ID, resource: ASSISTANT_RESOURCE, refresh_token: first.refresh_token };
    const next = refreshAssistantTokens(grant, args, 3000);
    expect(assistantAccessMatches(grant, first.access_token, 3000)).toBe(true);
    expect(assistantAccessMatches(grant, next.access_token, 3000)).toBe(true);
    expect(() => refreshAssistantTokens(grant, args, 4000)).toThrow();
    expect(assistantAccessMatches(grant, next.access_token, 4000)).toBe(false);
    expect(assistantAccessMatches(grant, first.access_token, 4000)).toBe(false);
  });
  it("keeps overlapping access tokens only until their original expiry", () => {
    const { code, grant } = fresh();
    const first = exchangeAssistantCode(grant, exchange(code), 2000);
    const next = refreshAssistantTokens(grant, { client_id: CHATGPT_CLIENT_ID, resource: ASSISTANT_RESOURCE, refresh_token: first.refresh_token }, 3000);
    expect(assistantAccessMatches(grant, first.access_token, 601999)).toBe(true);
    expect(assistantAccessMatches(grant, first.access_token, 602000)).toBe(false);
    expect(assistantAccessMatches(grant, next.access_token, 602000)).toBe(true);
    const last = refreshAssistantTokens(grant, { client_id: CHATGPT_CLIENT_ID, resource: ASSISTANT_RESOURCE, refresh_token: next.refresh_token }, 602000);
    expect(grant.previousAccessTokens).toHaveLength(1);
    expect(assistantAccessMatches(grant, last.access_token, 602000)).toBe(true);
  });
  it("rejects an expanded refresh scope and malformed opaque tokens", () => {
    const { code, grant } = fresh();
    const result = exchangeAssistantCode(grant, exchange(code), 2000);
    expect(() => refreshAssistantTokens(grant, { client_id: CHATGPT_CLIENT_ID, resource: ASSISTANT_RESOURCE, refresh_token: result.refresh_token, scope: "*" }, 3000)).toThrow();
    expect(assistantTokenUserId(result.access_token)).toBe(17);
    for (const invalid of ["17", "0." + "x".repeat(43), "2147483648." + "x".repeat(43), {}, "17.bad"]) expect(assistantTokenUserId(invalid)).toBeNull();
  });
});
