import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionPayload } from "../lib/session";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { CHATGPT_WRITE_CAPABILITIES } from "./chatgpt-write-capabilities";

export const ASSISTANT_ISSUER = "https://vndrly.ai/api/assistant-connection";
export const ASSISTANT_RESOURCE = `${ASSISTANT_ISSUER}/mcp`;
export const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";
export const ASSISTANT_SCOPES = ["gate:read", "work_hub:read", "gate:write", "work_hub:write", ...Object.keys(CHATGPT_READ_CAPABILITIES), ...Object.keys(CHATGPT_WRITE_CAPABILITIES)] as const;
const ACCESS_MS = 10 * 60_000;
const REFRESH_MS = 30 * 24 * 60 * 60_000;

export class AssistantOAuthError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export type AssistantAuthorization = {
  clientId: string; redirectUri: string; resource: string;
  challenge: string; scopes: string[];
};
export type AssistantOAuthGrant = AssistantAuthorization & {
  session: SessionPayload; codeHash?: string; codeExpiresAt: number;
  accessHash?: string; accessExpiresAt?: number;
  refreshHash?: string; previousRefreshHashes: string[]; refreshExpiresAt?: number;
  revoked: boolean;
  consentHash?: string;
  actions?: AssistantPreparedAction[];
};
export type AssistantPreparedAction = {
  tokenHash: string; toolName: string; arguments: Record<string, unknown>;
  fingerprint: string; createdAt: number; expiresAt: number; turnId: number;
  state: "pending" | "running" | "completed" | "outcome_unknown"; result?: string;
  executionFingerprint?: string;
  /** Lookup reference only: it cannot authorize a read or write without the bound account. */
  reference?: string;
};
export const assistantTokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function assistantPkceChallenge(verifier: string): string {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new AssistantOAuthError("invalid_grant");
  return createHash("sha256").update(verifier).digest("base64url");
}
function same(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function validateAssistantAuthorization(
  input: Record<string, unknown>, allowedRedirects: readonly string[],
): AssistantAuthorization {
  if (input.client_id !== CHATGPT_CLIENT_ID) throw new AssistantOAuthError("invalid_client");
  if (typeof input.redirect_uri !== "string" || !allowedRedirects.includes(input.redirect_uri)) throw new AssistantOAuthError("invalid_request");
  if (input.response_type !== "code" || input.resource !== ASSISTANT_RESOURCE || input.code_challenge_method !== "S256" ||
      typeof input.code_challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge)) throw new AssistantOAuthError("invalid_request");
  const scopes = typeof input.scope === "string" ? [...new Set(input.scope.split(" ").filter(Boolean))] : [];
  if (!scopes.length || scopes.some((scope) => !(ASSISTANT_SCOPES as readonly string[]).includes(scope))) throw new AssistantOAuthError("invalid_scope");
  return { clientId: CHATGPT_CLIENT_ID, redirectUri: input.redirect_uri, resource: ASSISTANT_RESOURCE, challenge: input.code_challenge, scopes };
}
function token(userId: number): string { return `${userId}.${randomBytes(32).toString("base64url")}`; }
export function assistantTokenUserId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const id = Number(value.split(".")[0]);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}
export function issueAssistantCode(authorization: AssistantAuthorization, session: SessionPayload, now = Date.now()) {
  if (!session.userId || !session.sv) throw new AssistantOAuthError("access_denied");
  const code = token(session.userId);
  const grant: AssistantOAuthGrant = { ...authorization, session: { ...session }, codeHash: assistantTokenHash(code), codeExpiresAt: now + 5 * 60_000, previousRefreshHashes: [], revoked: false };
  return { code, grant };
}
function issueTokens(grant: AssistantOAuthGrant, now: number) {
  const access = token(grant.session.userId!);
  const refresh = token(grant.session.userId!);
  grant.accessHash = assistantTokenHash(access); grant.accessExpiresAt = now + ACCESS_MS;
  grant.refreshHash = assistantTokenHash(refresh); grant.refreshExpiresAt ??= now + REFRESH_MS;
  return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_MS / 1000, scope: grant.scopes.join(" ") };
}
/** Caller must lock and persist the grant atomically, including revocations on errors. */
export function exchangeAssistantCode(grant: AssistantOAuthGrant, input: Record<string, unknown>, now = Date.now()) {
  if (grant.revoked || !grant.codeHash || grant.codeExpiresAt <= now || input.client_id !== grant.clientId || input.resource !== grant.resource || input.redirect_uri !== grant.redirectUri ||
      typeof input.code !== "string" || !same(assistantTokenHash(input.code), grant.codeHash) || typeof input.code_verifier !== "string" || !same(assistantPkceChallenge(input.code_verifier), grant.challenge)) throw new AssistantOAuthError("invalid_grant");
  delete grant.codeHash;
  return issueTokens(grant, now);
}
export function refreshAssistantTokens(grant: AssistantOAuthGrant, input: Record<string, unknown>, now = Date.now()) {
  if (typeof input.refresh_token !== "string" || input.client_id !== grant.clientId || input.resource !== grant.resource) throw new AssistantOAuthError("invalid_grant");
  const hash = assistantTokenHash(input.refresh_token);
  if (grant.previousRefreshHashes.includes(hash)) { grant.revoked = true; throw new AssistantOAuthError("invalid_grant"); }
  if (grant.revoked || !grant.refreshHash || !grant.refreshExpiresAt || grant.refreshExpiresAt <= now || !same(hash, grant.refreshHash) ||
      (input.scope !== undefined && input.scope !== grant.scopes.join(" "))) throw new AssistantOAuthError("invalid_grant");
  // Bounded history: fail closed rather than dropping replay evidence.
  if (grant.previousRefreshHashes.length >= 512) { grant.revoked = true; throw new AssistantOAuthError("invalid_grant"); }
  grant.previousRefreshHashes.push(grant.refreshHash);
  return issueTokens(grant, now);
}
export function assistantAccessMatches(grant: AssistantOAuthGrant, access: string, now = Date.now()): boolean {
  return !grant.revoked && Boolean(grant.accessHash && grant.accessExpiresAt && grant.accessExpiresAt > now && same(assistantTokenHash(access), grant.accessHash));
}
