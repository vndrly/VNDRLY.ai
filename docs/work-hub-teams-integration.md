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
reuse unchanged verification evidence. After deployment, connect MidCon with
v@vndrly.ai and verify actual account identity, calendar/chat reads and an
explicitly approved harmless write. Report admin-consent or licensing blocks
as blocks, never as a successful connection.

## Server registration

The dedicated Microsoft app is `VNDRLY/work hub Teams`, client ID
`ed725bbf-b859-4ad7-8258-3e5d055550e3`, tenant
`d59a479f-2195-4137-9cc7-f1b9f81d21f6`. It is single-tenant for this initial
MidCon connection. It does not replace existing Microsoft registrations.

Configure these private server environment variables (never VITE variables):

```
MICROSOFT_365_CLIENT_ID=ed725bbf-b859-4ad7-8258-3e5d055550e3
MICROSOFT_365_TENANT_ID=d59a479f-2195-4137-9cc7-f1b9f81d21f6
MICROSOFT_365_REDIRECT_URI=https://vndrly.ai/api/work-hub/teams/callback
MICROSOFT_365_CLIENT_SECRET=<private Microsoft client secret Value>
```

The secret remains outside source control. Track its expiry in the operator's
credential inventory. This release uses existing connector, cursor, audit and
client-operation tables; no new database migration is needed.

## First-release limits

The private calendar shows a bounded thirty-day window and lists up to fifty
events, chats or messages per read. Chat means existing one-to-one/group Teams
chats, not Teams channels or automatic company-chat mirroring. Linked scheduled
meetings synchronize on the explicit refresh action, ten oldest links per batch.
Recurring meetings and cancellation conflicts require review. Native audio and
recording remain independent; joining Teams does not record a Work Hub meeting.
