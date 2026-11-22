# Connected Communications

Web and native iOS use `/api/work-hub/connectors`. This adds real account-specific provider calls; it does not embed provider websites. Only OAuth consent opens the provider's authorization page (system browser on iOS).

## Registration

Set `COMMS_CREDS_KEY` to the same stable 64-hex encryption key on API instances sharing a connection database. Keep it separate from device/local login-session signing keys. When adopting this key for existing grants, re-encrypt their ciphertext using the previous key; do not rotate login credentials or discard grants.

Configure server-side secrets using the existing deployment secret mechanism. Never put client secrets in Vite or Expo public variables.

| Provider | Server variables | Redirect URI to register |
|---|---|---|
| Outlook | OUTLOOK_COMMS_CLIENT_ID, OUTLOOK_COMMS_CLIENT_SECRET (or legacy MICROSOFT_365 pair); optional MICROSOFT_MAIL_TENANT_ID | https://vndrly.ai/api/work-hub/connectors/outlook/callback |
| Teams | MICROSOFT_365_CLIENT_ID, MICROSOFT_365_CLIENT_SECRET, MICROSOFT_365_TENANT_ID | https://vndrly.ai/api/work-hub/connectors/teams/callback |
| Gmail | GOOGLE_MAIL_CLIENT_ID, GOOGLE_MAIL_CLIENT_SECRET | https://vndrly.ai/api/work-hub/connectors/gmail/callback |
| Slack | SLACK_CLIENT_ID, SLACK_CLIENT_SECRET | https://vndrly.ai/api/work-hub/connectors/slack/callback |

PUBLIC_APP_URL determines the callback base by default. OUTLOOK_COMMS_REDIRECT_URI, TEAMS_COMMS_REDIRECT_URI, GMAIL_COMMS_REDIRECT_URI and SLACK_COMMS_REDIRECT_URI can override individual callbacks. Local callbacks must point to the local API receiving consent, not production; register exact matching localhost URLs for development.

Microsoft delegated mail permissions: User.Read, Mail.ReadWrite, Mail.Send, offline_access. Teams additionally requests Chat.Read, ChatMessage.Send, Team.ReadBasic.All, Channel.ReadBasic.All, ChannelMessage.Read.All, ChannelMessage.Send. Teams requires an organizational Microsoft account. A single-tenant registration remains single-tenant; supporting customers outside MidCon requires Microsoft's registration/consent configuration to allow those tenants. Personal Outlook mail accounts require a compatible app registration and common/consumers tenant selection. Existing Teams calendar connection remains separate; connect again in Communications to grant the new channel scopes.

Enable Gmail API and configure Google's consent screen with gmail.modify. Production use may require Google's restricted-scope verification/security assessment; testing mode is limited to registered test users and can have short-lived grants. This is not bypassed by the client.

Slack requests user scopes (not bot identity): channels:read, channels:history, groups:read, groups:history, im:read, im:history, mpim:read, mpim:history, chat:write, users:read. Workspace policies may require admin approval. Only conversations accessible to the authorized user are listed. Respect provider rate limits; a connector does not grant access to other users' private messages.

## Data and behavior

- Each connected account has its own random connection ID and encrypted credentials in the existing Work Hub connector table. No schema migration or new dependency is required.
- Connections are bound to authenticated user, active membership, organization and session version. API reads revalidate the session; account IDs alone do not authorize access.
- OAuth state is unpredictable, expires after ten minutes and is claimed once. Microsoft/Google use PKCE. Refresh rotation is serialized with a PostgreSQL transaction lock.
- Reconnecting the same provider principal retires its previous local grant. Other accounts remain separate. Disconnect removes the stored local tokens; users can also revoke app consent at the provider.
- Mail: folder/label navigation, paged messages, search, plain-text reader, compose/reply/forward, drafts, read/unread, archive/trash and attachments. Maximum outgoing attachments total 2 MB. Existing larger attachments cannot be edited/forwarded through this lightweight composer; the original stays unchanged.
- Incoming HTML is rendered as text, without executing scripts or loading tracking images. This deliberately does not implement a full HTML email editor.
- Teams/Slack: existing chats/channels, paged history, threads and sending as the connected user. This is in-app provider access, not automatic copying into VNDRLY conversations or a cross-provider broadcast bridge.
- Sends/draft writes use operation IDs. Uncertain delivery is not automatically retried; check Sent/provider history before a new attempt. Failed operations can be ambiguous if the provider accepted a request before the network failed.
- Email bodies are fetched on demand, not bulk imported. Open folder/message/chat views poll every 30 seconds. Web polling pauses in the background; native polling pauses when the screen loses focus or the app becomes inactive. Provider writes remain explicit user actions. This is not an always-running background sync of Microsoft files/tasks/calendar. No notification hold is changed.
- Import & Export is now an administrative page at `/admin/import-export`; the native Admin opens the same authenticated page. The legacy Microsoft one-way migration card is removed. Work Hub no longer offers Import & Export or More in its navigation.

## Sources used

- Microsoft Graph mail: https://learn.microsoft.com/graph/api/resources/mail-api-overview?view=graph-rest-1.0
- Microsoft identity examples: https://github.com/Azure-Samples/ms-identity-javascript-nodejs-tutorial
- Google Node samples: https://github.com/googleworkspace/node-samples
- Google server OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail sending: https://developers.google.com/workspace/gmail/api/guides/sending
- Slack OAuth: https://docs.slack.dev/authentication/installing-with-oauth/
- Slack maintained SDK/examples: https://github.com/slackapi/node-slack-sdk

The application follows these documented HTTP contracts using its existing fetch/encrypted storage stack. No external SDK or example project was installed or copied wholesale.

## Verification boundary

Unit tests mock provider responses and do not send real messages. Before calling a provider live-verified, configure its registration, authorize an account, read folders/history, then use an explicitly authorized test recipient/channel to exercise sending and attachment round trips. Test two Outlook accounts and one Gmail account simultaneously, revoke one grant, and verify the others remain intact. Repeat the consent return and mailbox/thread navigation on a physical iPhone. Missing registration/consent is a live-validation blocker, not a successful connection.

## Teams setup deferred by John

Teams tenant/app ownership changes are deferred. Do not change MidCon ownership or Teams registration while completing Gmail, Slack, and mail integration. Outlook can use its own `OUTLOOK_COMMS_CLIENT_ID` / `OUTLOOK_COMMS_CLIENT_SECRET` pair without modifying Teams. A separate Outlook registration defaults to `common`; explicitly set `MICROSOFT_MAIL_TENANT_ID` when restricting it. The app registration must actually support the intended account audience: selecting `common` in code does not convert a single-tenant app. An incomplete separate Outlook pair fails closed rather than mixing secrets with Teams.
