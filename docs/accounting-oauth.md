# OpenAccountant Connect — Admin Setup

This guide walks platform admins through wiring up the **OpenAccountant**
("OA") connection that vendors see on the Reports page. OA is now the
default connect path (mirroring how QuickBooks Online works), but the
flow only works once the environment variables described below are set
on the API server. If OA OAuth is not configured the connect popup will
fail with `oa.not_configured` and tell the user to ask an admin to set
the secrets.

There are two ways a vendor can connect to OpenAccountant:

1. **OAuth2 (default).** Vendor clicks **Connect OpenAccountant** →
   popup opens at OA's `/oauth/authorize` → vendor approves → OA
   redirects back to `/api/accounting/oa/callback` with a code →
   server swaps the code for `access_token` + `refresh_token` and
   stores them on the connection row.
2. **API key (fallback).** Vendor clicks **Use API key instead** in
   the connect dialog and pastes a long-lived OA API key. No admin
   setup is required for this path; it always works as long as the
   tenant can issue an API key from OA settings.

Existing API-key connections keep working unchanged — the OAuth flow
ships *alongside* the API key flow, not in place of it.

---

## 1. Register an OAuth client in OpenAccountant

In the OpenAccountant admin console:

1. Open **Settings → Developer → OAuth applications**.
2. Click **New application**.
3. Fill in:
   - **Name** — e.g. `VNDRLY Field Operations`.
   - **Redirect URI** — must be the absolute, HTTPS URL of the
     callback route on the API server. This is the same value you
     will set as `OPENACCOUNTANT_REDIRECT_URI` below.

     ```
     https://<your-vndrly-host>/api/accounting/oa/callback
     ```

     For Replit deployments use the published domain
     (`$REPLIT_DOMAINS`) — for example
     `https://vndrly.example.com/api/accounting/oa/callback`. The path
     `/api/accounting/oa/callback` is fixed; only the host changes per
     environment.
   - **Scopes** — request at minimum `accounting.write` (the default
     scope VNDRLY asks for). If you scope down further, set
     `OPENACCOUNTANT_OAUTH_SCOPE` to match exactly.
4. Save the application. OA will generate a **Client ID** and a
   **Client Secret**. Copy both — the secret is shown only once.

If you maintain separate OA applications per environment (recommended:
one for staging, one for production), repeat the steps above for each
and use the matching redirect URI.

---

## 2. Set the environment variables

Set the following on the API server via the Replit secrets pane (or
your deployment's environment configuration). The first three are
**required**; the last two are optional and have safe defaults.

| Variable | Required | Description |
| --- | --- | --- |
| `OPENACCOUNTANT_CLIENT_ID` | yes | Client ID issued by OA when you registered the OAuth application. |
| `OPENACCOUNTANT_CLIENT_SECRET` | yes | Client secret issued by OA. Treat as a credential — never commit it. |
| `OPENACCOUNTANT_REDIRECT_URI` | yes | Absolute HTTPS URL of `/api/accounting/oa/callback` on this environment. Must match the redirect URI registered in OA exactly (including scheme, host, and path). |
| `OPENACCOUNTANT_OAUTH_BASE_URL` | no | OA OAuth host root, no trailing slash. Defaults to `https://accounts.openaccountant.com`. Override only when OA gives you a regional or sandbox auth endpoint (e.g. `https://accounts.eu.openaccountant.com`). |
| `OPENACCOUNTANT_OAUTH_SCOPE` | no | Space-delimited OAuth scope list. Defaults to `accounting.write`. Set this only if you registered the OA application with a different scope. |

After changing any of these, restart the **API Server** workflow so the
new values are picked up by `loadOaOAuthConfig()`.

### Related (optional) OA API host vars

These are unrelated to OAuth itself but commonly configured at the same
time:

- `OPENACCOUNTANT_BASE_URL` — Default OA REST API base (used when a
  connection has no per-row `apiBaseUrl` override). Defaults to
  `https://api.openaccountant.com/v1`.
- `OPENACCOUNTANT_HOST_ALLOWLIST` — Comma-separated list of host
  suffixes that are accepted as OA endpoints. Defaults to
  `openaccountant.com,api.openaccountant.com`. Extend this only when
  you need a regional or sandbox API host (e.g.
  `openaccountant.com,api.eu.openaccountant.com`). The allowlist is
  enforced by `validateOaBaseUrl()` as an SSRF guard, so any host not
  matched here is rejected at save and push time.

---

## 3. Verify the setup

1. Sign in to VNDRLY as a vendor admin (or as a platform admin acting
   on behalf of a vendor).
2. Navigate to **Reports** → the **OpenAccountant** card.
3. Click **Connect OpenAccountant**. A popup should open on
   `accounts.openaccountant.com/oauth/authorize` (or your override host).
4. Approve the application. The popup should redirect back to
   `/api/accounting/oa/callback`, show a green "OpenAccountant
   connected" page, and post a `vndrly.accounting.connected` message
   to the opener so the Reports page refreshes the connection state.
5. The Reports card should now read **Connected (OpenAccountant)** and
   the **Sync to OpenAccountant** action should be enabled.

If the popup shows **"OpenAccountant OAuth is not configured"**,
double-check that all three required env vars are set on the same
environment as the API server and that the workflow has been
restarted.

If the popup shows **"Session mismatch"**, sign in as the same user
that started the connect flow and try again — the callback verifies
the signed `state` parameter against the current session for CSRF
protection.

---

## 4. Fallback: connect with an API key

Tenants whose OA workspace doesn't have OAuth enabled (or that prefer
a service account) can still connect using a long-lived API key. No
admin env vars are required for this path.

1. In OpenAccountant, open **Settings → API keys** and generate a new
   key. Copy it — OA only shows the value once.
2. In VNDRLY, on the Reports → OpenAccountant card, click
   **Connect OpenAccountant** and then **Use API key instead** in the
   dialog.
3. Paste the API key. Optionally set an **API base URL** if your
   tenant uses a non-default OA host (it must be HTTPS and match
   `OPENACCOUNTANT_HOST_ALLOWLIST`).
4. Click **Save connection**.

The vendor's connection row stores the API key as the access token,
with no refresh token, so subsequent **Sync to OpenAccountant** pushes
work identically to the OAuth path. Disconnecting an API-key
connection only deletes the local row — there is no upstream revoke
because OA API keys are managed in OA's settings UI.

---

## 5. Disconnecting

When a vendor clicks **Disconnect** on an OAuth-issued OA connection,
the API server makes a best-effort POST to OA's
`/oauth/revoke` endpoint (using the same client credentials) before
deleting the local row. Revoke failures are logged but do not block
the delete. API-key connections skip the upstream revoke step.
