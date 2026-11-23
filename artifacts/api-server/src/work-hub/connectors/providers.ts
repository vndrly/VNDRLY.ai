import { createHash, randomBytes } from "node:crypto";
import { z } from "zod/v4";
export const providerSchema = z.enum(["outlook", "gmail", "teams", "slack"]);
export type Provider = z.infer<typeof providerSchema>;
export class ConnectorError extends Error {
  constructor(
    public code: string,
    public status = 502,
    public retryAfter?: number,
  ) {
    super(code.replaceAll("_", " "));
  }
}
export const scopes = {
  outlook: ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"],
  gmail: ["https://www.googleapis.com/auth/gmail.modify"],
  teams: [
    "offline_access",
    "User.Read",
    "Chat.Read",
    "ChatMessage.Send",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "ChannelMessage.Read.All",
    "ChannelMessage.Send",
  ],
  slack: [
    "channels:read",
    "channels:history",
    "groups:read",
    "groups:history",
    "im:read",
    "im:history",
    "mpim:read",
    "mpim:history",
    "chat:write",
    "users:read",
  ],
};
export function config(provider: Provider) {
  const prefix =
    provider === "gmail"
      ? "GOOGLE_MAIL"
      : provider === "slack"
        ? "SLACK"
        : provider === "outlook"
          ? "OUTLOOK_COMMS"
          : "MICROSOFT_365";
  const clientId = process.env[`${prefix}_CLIENT_ID`],
    clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret)
    throw new ConnectorError(`${provider}_registration_required`, 503);
  const base = process.env.PUBLIC_APP_URL || "https://vndrly.ai";
  const redirectUri =
    process.env[`${provider.toUpperCase()}_COMMS_REDIRECT_URI`] ||
    `${base}/api/work-hub/connectors/${provider}/callback`;
  const redirect = new URL(redirectUri);
  if (
    redirect.protocol !== "https:" &&
    !(
      redirect.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(redirect.hostname)
    )
  )
    throw new ConnectorError("invalid_redirect_configuration", 503);
  const tenant =
    provider === "outlook"
      ? process.env.MICROSOFT_MAIL_TENANT_ID || "common"
      : process.env.MICROSOFT_365_TENANT_ID || "organizations";
  if (!/^[\w.-]+$/.test(tenant))
    throw new ConnectorError("invalid_tenant_configuration", 503);
  return { clientId, clientSecret, redirectUri, tenant };
}
export function authorization(
  provider: Provider,
  state: string,
  verifier: string,
) {
  const c = config(provider);
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    state,
    response_type: "code",
  });
  if (provider === "slack") params.set("user_scope", scopes.slack.join(","));
  else {
    params.set("scope", scopes[provider].join(" "));
    params.set("code_challenge_method", "S256");
    params.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    params.set(
      "prompt",
      provider === "gmail" ? "consent select_account" : "select_account",
    );
    if (provider === "gmail") params.set("access_type", "offline");
  }
  return `${provider === "gmail" ? "https://accounts.google.com/o/oauth2/v2/auth" : provider === "slack" ? "https://slack.com/oauth/v2/authorize" : `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/authorize`}?${params}`;
}
export type Tokens = {
  access: string;
  refresh?: string;
  expires: number;
  scope: string;
};
export async function json(url: string, init: RequestInit = {}): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ConnectorError("provider_delivery_uncertain", 502);
  }
  if (!response.ok)
    throw new ConnectorError(
      url.startsWith("https://slack.com/api/")
        ? `slack_http_${response.status}`
        : response.status === 429
        ? "provider_rate_limited"
        : response.status === 401
          ? "reconnect_required"
          : response.status === 403
            ? "provider_permission_denied"
            : "provider_request_failed",
      response.status === 401 ? 409 : response.status,
      Number(response.headers.get("retry-after")) || undefined,
    );
  if (response.status === 204 || response.status === 202) return {};
  const value: any = await response.json();
  if (
    url.startsWith("https://slack.com/api/") &&
    typeof value.error === "string" &&
    /^[a-z0-9_]{1,80}$/.test(value.error)
  )
    throw new ConnectorError(`slack_${value.error}`, 400);
  if (value.error || value.ok === false)
    throw new ConnectorError(
      [
        "invalid_grant",
        "invalid_auth",
        "token_revoked",
        "token_expired",
      ].includes(value.error)
        ? "reconnect_required"
        : value.error === "missing_scope"
          ? "provider_permission_denied"
          : "provider_request_failed",
      400,
    );
  return value;
}
export async function exchange(
  provider: Provider,
  grant: { code: string; verifier: string } | { refresh: string },
): Promise<Tokens> {
  const c = config(provider);
  const body = new URLSearchParams({ redirect_uri: c.redirectUri });
  if (provider !== "slack") {
    body.set("client_id", c.clientId);
    body.set("client_secret", c.clientSecret);
  }
  if ("code" in grant) {
    body.set("code", grant.code);
    body.set("grant_type", "authorization_code");
    if (provider !== "slack") body.set("code_verifier", grant.verifier);
  } else {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", grant.refresh);
  }
  const value = await json(
    provider === "gmail"
      ? "https://oauth2.googleapis.com/token"
      : provider === "slack"
        ? "https://slack.com/api/oauth.v2.access"
        : `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(provider === "slack"
          ? {
              Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
            }
          : {}),
      },
      body: body.toString(),
    },
  );
  const token =
    provider === "slack" && "code" in grant ? value.authed_user : value;
  if (!token?.access_token) throw new ConnectorError("provider_invalid_token");
  const scope =
    token.scope || ("refresh" in grant ? scopes[provider].join(" ") : "");
  const granted = new Set(
    String(scope)
      .split(/[ ,]+/)
      .map((s) => s.toLowerCase()),
  );
  if (
    "code" in grant &&
    scopes[provider]
      .filter((s) => s !== "offline_access")
      .some((s) => !granted.has(s.toLowerCase()))
  )
    throw new ConnectorError("provider_permissions_required", 403);
  return {
    access: token.access_token,
    refresh:
      token.refresh_token || ("refresh" in grant ? grant.refresh : undefined),
    expires: token.expires_in
      ? Date.now() + token.expires_in * 1000
      : provider === "slack"
        ? Number.MAX_SAFE_INTEGER
        : Date.now() + 3600000,
    scope,
  };
}
export async function graph(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return json(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.body-content-type="text"',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export async function gmail(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return json(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export async function slack(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
) {
  return json(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json;charset=utf-8",
    },
    body: JSON.stringify(body),
  });
}
export async function profile(provider: Provider, token: string) {
  if (provider === "gmail") {
    const p = await gmail(token, "/profile");
    return { id: p.emailAddress, label: p.emailAddress };
  }
  if (provider === "slack") {
    const p = await slack(token, "auth.test");
    return { id: `${p.team_id}:${p.user_id}`, label: `${p.user} · ${p.team}` };
  }
  const p = await graph(
    token,
    "/me?$select=id,displayName,mail,userPrincipalName",
  );
  return { id: p.id, label: p.mail || p.userPrincipalName || p.displayName };
}
export const segment = (value: string) => {
  if (!value || value === "." || value === "..")
    throw new ConnectorError("invalid_resource_id", 400);
  return encodeURIComponent(value);
};
export const randomId = () => randomBytes(32).toString("base64url");
