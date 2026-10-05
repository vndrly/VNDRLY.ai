# VNDRLY ChatGPT connection

The approved user-layer integration reuses the live Ask V tool registry and canonical Gate/Work Hub workflows. The original standalone SQLite simulation stays separate. This implementation is not an offline, wake-word, background-location, or Twilio service.

## Account linking

- MCP resource: `https://vndrly.ai/api/assistant-connection/mcp`.
- Authorization issuer: `https://vndrly.ai/api/assistant-connection`.
- Client metadata: only OpenAI's `https://chatgpt.com/oauth/client.json`; no arbitrary URL fetching or registration.
- Exact redirect: `https://chatgpt.com/connector_platform_oauth_redirect`.
- Public client, authorization code + S256 PKCE; codes expire after five minutes and are single-use.
- Access tokens expire after ten minutes. Refresh tokens rotate, have a thirty-day maximum lifetime, and replay revokes the grant.
- Supported scopes: `gate:read`, `work_hub:read`, `gate:write`, `work_hub:write`. Request only the needed scopes.
- Consent requires the signed-in VNDRLY account, exact same-site origin and a short-lived signed, cookie-bound form. It does not collect a password or accept new terms.
- Current account suspension, forced password change, session version, organization membership and managed-site grants are rechecked against the database. Account-context changes require reconnecting.

Only token hashes are stored. Grants live in a dedicated `users.assistant_oauth_grants` JSONB column outside ordinary user projections, so existing user responses cannot accidentally serialize credentials. This deliberately uses raw, parameterized queries for the secret store. Row locks serialize code exchanges, rotations and action claims. Authority resolution uses the same connection to avoid pool exhaustion.

## Tools and real changes

Read tools are filtered through the existing role/tool-pack registry and the connection's scopes. Gate discovery, change-over, shift notes, visitor lookup/history and reports reuse their existing permission checks. Work Hub exposes authorized briefing, calendar, tasks, channels/messages, meetings and other supported read families.

Gate and Work Hub mutation tools prepare a draft and return a secure VNDRLY approval link. `v_prepare_action` is also available for explicit typed preparation. Preparing does not submit the change. `v_action_status` returns the actual saved result, including pending/running/uncertain states.

The approval page requires the matching staff identity and organization, current grant, exact origin, and a signed cookie-bound nonce. It binds the human button action to the stored operation and reuses Ask V's pending-confirmation and persistent-idempotency runtime. Model-supplied approval, operation keys, identity context and GPS/tracking assertions do not establish authority. Canonical domain APIs still enforce role, site assignment, company policy and recipient restrictions.

Visitor entry/exit and paid travel obtain a fresh location from the approval browser. Paid travel sets `locationSharingActive=false`: a single location fix is not continuous tracking. The VNDRLY mobile app must supply background trip tracking. The approval page states this limitation.

Action claims commit before domain execution. Completed results are stored before a separate audit write. Interrupted outcomes remain reserved; matching unresolved actions cannot become fresh mutations after a timeout/restart. Status reads can recover completed results from the canonical persisted Ask V reservation without executing the operation again. Unresolved outcomes require checking the actual record before any different action is taken.

## Deployment and verification

`migrate:assistant-connection` only runs `ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_oauth_grants jsonb`. It performs no reset, seed, delete or credential rotation. API deployment applies it before restarting and provisions only the two exact standard OAuth discovery proxy locations, preserving the existing Nginx site and retaining a backup. The proxy config is validated before reload.

`ASSISTANT_CONNECTION_ENABLED=1` enables the routes. API deployment sets it only if absent; an explicit existing opt-out is preserved. Disabled routes return 503. Scoped bearer tokens never enter the general staff-cookie shim.

Before main promotion, run the five repository verification gates on the exact tree. The isolated concurrency test only runs with the fresh loopback test-database provenance marker and uses its own one-connection pool. Check live health, discovery JSON, unauthenticated MCP challenge, ChatGPT account linking, a permission-scoped read and an explicitly authorized harmless write/result readback. Keep implemented, validated, deployed and live-account-verified status distinct.

No public marketplace submission or App Store release is included in account-connection setup. Native tracking/offline/wake-word/Twilio capabilities remain separate implementation work.
