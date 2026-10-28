# Work Hub and Microsoft Teams

Approved first release: delegated Microsoft sign-in, private calendar and Teams
chat reads, explicit chat sends, and two-way synchronization of selected hosted
Work Hub meetings. The existing one-way Microsoft migration remains separate.

## Boundaries

- Connections belong to the signed-in VNDRLY user, active membership and
  organization. Revalidate that membership on every request. Never share another
  user's Microsoft calendar or chats through organization-wide imports.
- Authorization-code OAuth uses PKCE, a ten-minute single-use state, encrypted
  credentials, refresh-token rotation and explicit disconnect. No browser tokens.
- Request only User.Read, Calendars.ReadWrite, Chat.Read, ChatMessage.Send and
  sign-in/offline scopes. Microsoft tenant policies may require administrator
  consent; connection is not complete until the real account grants access.
- Chat sends require a selected destination and explicit confirmation. Persist
  an operation fingerprint before sending. An uncertain provider response cannot
  be automatically resent under a new request.
- Publish only meetings the current user hosts. Stable provider transaction IDs
  and per-connection mappings prevent duplicate creation. Do not invite attendees
  automatically or replace native audio, admission, recording or consent state.
- Reconcile only linked meetings. Concurrent edits become visible conflicts;
  never silently overwrite both sides. Deleted/cancelled provider records require
  review rather than silently ending a native live meeting.

## Delivery and verification

Use existing tables and dependencies. Verify provider URL restrictions, OAuth
state reuse and account boundaries, durable send retries, and linked meeting
conflicts with focused checks. Bundle integration checks before deployment;
reuse unchanged verification evidence. After deployment, connect MidCon (and one non-MidCon tenant in multi-tenant mode) with
v@vndrly.ai and verify actual account identity, calendar/chat reads and an
explicitly approved harmless write. Report admin-consent or licensing blocks
as blocks, never as a successful connection.

## Server registration

The dedicated Microsoft app is `VNDRLY/work hub Teams`, client ID
`ed725bbf-b859-4ad7-8258-3e5d055550e3`, home tenant
`d59a479f-2195-4137-9cc7-f1b9f81d21f6` (MidCon). It does not replace existing
Microsoft registrations.

### Tenant modes

| `MICROSOFT_365_TENANT_ID` | Who can connect |
| --- | --- |
| unset or `organizations` (default) | Any work/school Microsoft Entra tenant (multi-tenant). |
| `common` | Same as `organizations` in practice: personal Microsoft accounts are always rejected (`teams_tenant_not_allowed`). |
| a tenant GUID | Only that tenant (single-tenant pinning). |
| `consumers` / the consumer tenant GUID | Rejected at startup as `invalid_tenant_config`. |

Optional `MICROSOFT_365_ALLOWED_TENANT_IDS` is a comma-separated list of tenant
GUIDs. When set, only those tenants may connect, even in multi-tenant mode.

Token validation: the authorization code and refresh token are exchanged only
with Microsoft's TLS token endpoint. The ID token's `aud` must equal the client
ID, `exp` must be in the future, and `iss` must equal
`https://login.microsoftonline.com/{tid}/v2.0` for that token's own `tid`. The
issuer is not hard-coded to MidCon. The verified `tid` is bound to the
connection. A later refresh may not change it. In multi-tenant mode, refresh is
sent to the user's own tenant authority.

**Required Azure change for multi-tenant use:** in Entra admin center → App
registrations → `VNDRLY/work hub Teams` → Authentication, set *Supported account
types* to **Accounts in any organizational directory (Any Microsoft Entra ID
tenant - Multitenant)**. If you skip this, other tenants fail with AADSTS50194.
That failure is reported as `teams_app_misconfigured`, not as a user sign-in
problem.

Each customer tenant whose policy blocks user consent needs one administrator
to grant consent. Other tenants can also block the app with Conditional Access.
Keep the redirect URI below registered under *Web*.

Configure these private server environment variables (never VITE variables):

```
MICROSOFT_365_CLIENT_ID=ed725bbf-b859-4ad7-8258-3e5d055550e3
MICROSOFT_365_TENANT_ID=organizations        # or a tenant GUID to pin one tenant
MICROSOFT_365_ALLOWED_TENANT_IDS=            # optional comma-separated tenant GUIDs
MICROSOFT_365_REDIRECT_URI=https://vndrly.ai/api/work-hub/teams/callback
MICROSOFT_365_CLIENT_SECRET=<private Microsoft client secret Value>
```

The secret remains outside source control. Track its expiry in the operator's
credential inventory. `.github/workflows/deploy-api.yml` does not currently pass
any `MICROSOFT_365_*` value. They must be present in the API host environment,
or be added as repository secrets and forwarded by the deploy workflow.

## Connection states and errors

- `connected`: tokens are usable.
- `reconnect_required`: Microsoft rejected the stored refresh token
  (`invalid_grant`, `interaction_required`, `consent_required`,
  `login_required`). This happens when access is revoked, the password is reset,
  the token expires through inactivity, or consent is withdrawn. Tokens are
  deleted. The account identity and meeting mappings are kept. `GET
  /work-hub/teams/status` returns `reconnectRequired: true` and `errorCode:
  "teams_reconnect_required"`, and the settings card offers *Reconnect Microsoft
  Teams*. A Graph 401 forces one refresh to detect this. Read endpoints retry
  once with the new token. Writes never retry automatically.
- `revoked`: the user disconnected.

`teams_app_misconfigured` (HTTP 503) means a server or app-registration fault,
never a user fault. Examples: `invalid_client` (AADSTS7000215 wrong secret,
7000222 expired secret), `unauthorized_client`, AADSTS50194, 700016 and 700025.
It does not change the user's connection state. The server logs
`teams.token_error` / `teams.authorize_error` with only the grant type, HTTP
status, OAuth error, AADSTS codes and trace/correlation IDs. It never logs the
error description, secrets, codes or tokens.

`teams_tenant_not_allowed` (HTTP 403) means the account's tenant is the consumer
tenant, is outside the pinned tenant, or is not on the allow-list.

The `status` column is free text, so the new `reconnect_required` state needs no
database migration.

## First-release limits

The private calendar shows a bounded thirty-day window. Calendar and chat lists
follow `@odata.nextLink` in pages of fifty. The calendar is capped at 10 pages /
500 events and chats at 5 pages / 250 chats. `hasMore` is true when a cap stops
paging. Next links are followed only on `https://graph.microsoft.com/v1.0/`.
Chat messages show the latest fifty. Chat means existing one-to-one/group Teams
chats, not Teams channels or automatic company-chat mirroring. Linked scheduled
meetings synchronize on the explicit refresh action, ten oldest links per batch.
Recurring meetings and cancellation conflicts require review. Native audio and
recording remain independent; joining Teams does not record a Work Hub meeting.
