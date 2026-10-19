# VNDRLY ChatGPT connection

The approved user-layer integration reuses the Ask V tool registry and canonical domain workflows. The original standalone SQLite simulation stays separate. Offline recording, wake-word listening, background-location collection and Twilio delivery require their own supported device/provider integrations.

## Account linking

- MCP resource: `https://vndrly.ai/api/assistant-connection/mcp`.
- Authorization issuer: `https://vndrly.ai/api/assistant-connection`.
- Client metadata: only OpenAI's `https://chatgpt.com/oauth/client.json`; no arbitrary URL fetching or registration.
- Exact redirect: `https://chatgpt.com/connector_platform_oauth_redirect`.
- Public client, authorization code + S256 PKCE; codes expire after five minutes and are single-use.
- Access tokens expire after ten minutes. Refresh tokens rotate, have a thirty-day maximum lifetime, and replay revokes the grant.
- Base scopes: `gate:read`, `work_hub:read`, `gate:write`, `work_hub:write`. Optional read-family scopes: `tickets:read`, `sites:read`, `crew:read`, `finance:read`, `catalog:read`, `safety:read`, `onboarding:read`, `operations:read`. Request only the needed scopes. Existing grants retain their original scopes; adding families requires new consent. The consent page lists the requested record families, including location access for crew reads.
- Consent requires the signed-in VNDRLY account, exact same-site origin and a short-lived signed, cookie-bound form. It does not collect a password or accept new terms.
- Current account suspension, forced password change, session version, organization membership and managed-site grants are rechecked against the database. Account-context changes require reconnecting.

Only token hashes are stored. Grants live in a dedicated `users.assistant_oauth_grants` JSONB column outside ordinary user projections, so existing user responses cannot accidentally serialize credentials. This deliberately uses raw, parameterized queries for the secret store. Row locks serialize code exchanges, rotations and action claims. Authority resolution uses the same connection to avoid pool exhaustion.

## Tools and real changes

Read tools are filtered through the existing role/tool-pack registry and the connection's scopes. Gate discovery, change-over, shift notes, visitor lookup/history and reports reuse their existing permission checks. Work Hub exposes authorized briefing, calendar, tasks, channels/messages, meetings and other supported read families.

The optional read families use an explicit tool allowlist, registry roles and company-admin restrictions. New registry tools are not automatically exposed. Canonical reads retain tenant, site, worker and authority checks. Onboarding reads reject ordinary organizational members; the ChatGPT result exposes progress fields only, not the arbitrary setup payload. Payment lookup and legacy ticket lookup reuse the canonical ticket filter and fail closed without scope. Additional invitation and workforce read families expose permitted enrollment, staffing and ticket-assignment candidates.

Gate resolution and form-preparation helpers return draft fields and matching candidates only. The connection removes their client prefill intent and explicitly reports that no form was populated and no record was submitted. Phone cameras and scanners still require a supported device/handoff. `lookup_open_tickets` is now included in the ticket-read allowlist, with canonical authorization filtering. Unsupported endpoints remain excluded.

Separately consented write families prepare ticket records, crew assignments and acknowledgement, lifecycle/review changes, onboarding fields and completion, staffing coverage, trips, safety response, subscriptions, inventory custody, invitations and notification read state. `finance:write` prepares payment-record creation or reversal under canonical Accounts Payable authority; it does not transfer or refund money. Legal acceptance and credential setup remain on dedicated screens. Scope availability does not prove the connected role may perform an action or that its complete workflow has passed live verification.

Mutation tools prepare a draft with an embedded authenticated action panel and a secure VNDRLY approval link. Component-only submission proof is bound to the current grant and saved action; it is not exposed as conversational content. Location-dependent actions use the device authorization screen. `v_prepare_action` is also available for explicit typed preparation. Preparing does not submit the change. `v_action_status` returns the actual saved result, including pending/running/uncertain states.

`v_open_ticket_entry` prepares an account-bound handoff to the existing photo, parts, labor or mileage screen after reading the authorized ticket. The destination rechecks identity, organization, session generation, grant and ticket access. A returned link does not prove entry, capture or upload; verify the actual saved record afterward. My Workday, Gate Board and Work Calendar are embedded views, with further panels filtered by permitted tools and assignments. The Fleet integration explicitly remains `not_connected` until trusted vehicle/load/tag services exist; existing trip views do not establish fleet telemetry.

Coordinated plans retain dependencies, deadlines, results and resumable checkpoints in Work Hub tasks. Planned-read receipts record observed lookups without marking the business work complete. These controls do not supply an unattended executor or an automatic return trigger. See `docs/chatgpt-workflow-parity.md` for release-specific evidence and remaining gaps.

The pending Gate batch adds `v_open_gate_handoff`: resolve the authorized station first, then request its account-bound Change Over link. The destination rechecks the active grant and station permission and selects the site's canonical ID. Incoming-worker authentication and acceptance remain on that device screen; returning a link never proves transfer or duty completion. Read the saved station state afterward. This batch also normalizes spoken plate-state names in visitor drafts and checks normalized operational roles instead of relying on legacy role labels. These changes require deployment and live verification before they are considered available.

The approval page requires the matching staff identity and organization, current grant, exact origin, and a signed cookie-bound nonce. It binds the human button action to the stored operation and reuses Ask V's pending-confirmation and persistent-idempotency runtime. Model-supplied approval, operation keys, identity context and GPS/tracking assertions do not establish authority. Canonical domain APIs still enforce role, site assignment, company policy and recipient restrictions.

Visitor entry/exit and paid travel obtain a fresh location from the approval browser. Paid travel sets `locationSharingActive=false`: a single location fix is not continuous tracking. The VNDRLY mobile app must supply background trip tracking. The approval page states this limitation.

Action claims commit before domain execution. Completed results are stored before a separate audit write. Interrupted outcomes remain reserved; matching unresolved actions cannot become fresh mutations after a timeout/restart. Status reads can recover completed results from the canonical persisted Ask V reservation without executing the operation again. Unresolved outcomes require checking the actual record before any different action is taken.

## Deployment and verification

### Service Marketplace tools

The same installed VNDRLY connection now supports `marketplace:read` and separately consented `marketplace:write`. Existing grants keep their original scopes. Refresh the existing connection's tools and request additional consent for these scopes; do not replace linked accounts, revoke unrelated grants, or create a second catalog entry. The MCP resource URL and workspace resource URI are unchanged.

Reads include `search_marketplace_services`, `query_marketplace_demand`, `query_marketplace_capabilities`, `compare_marketplace_vendors`, `explain_marketplace_match`, `query_marketplace_job_offers`, and `prepare_marketplace_capability`. Vendor demand comes from all matching partner catalogs through the approved public projection: state-level coverage, approximate counts and only the caller's own offers/eligibility. Comparisons require authorized partner work-type/site IDs. Search uses saved mappings; its optional wording filter applies within the returned page. Capability preview is provisional and saves nothing. Mapping explanations come from stored records. Field employees cannot use office marketplace tools.

Writes include `confirm_marketplace_capability`, `confirm_marketplace_service_area`, `confirm_marketplace_rate`, `confirm_marketplace_job_offer`, and `confirm_marketplace_job_offer_action`. The last supports partner send/withdraw and vendor review/accept/decline, with the exact saved offer version. Each tool prepares the existing secure approval flow. The server supplies authorization and replay identity; coordinates, confidence and compliance assertions from the model are discarded. The canonical marketplace API performs authorization and shared domain-service execution; no assistant SQL or eligibility implementation is added. Each completed write reads the canonical resource. Acceptance verifies the saved `createdTicketId` against the acceptance result and returns `ticketId`. Failed/lost readback is an uncertain outcome, never a success claim or automatic fresh write.

`v_show_workspace` accepts `view: "marketplace"` in the existing work desk. Vendors see matching demand; partners supply `workTypeId` and `siteId` for comparisons. Administrators also select the company. This read-only view shares the connection's role and scope checks. AskV's `marketplace` tool pack exposes the same actions on web/native; the existing `catalog` pack stays read-only.

Release verification (not performed by local implementation tests):

1. Update the existing installed VNDRLY package/catalog entry and refresh definitions after API deployment. Preserve its identity, linked account and existing grants; consent separately to new marketplace scopes.
2. With an authorized vendor, call `query_marketplace_demand` and inspect two matching partner projections. Confirm there are no competitors, other vendors' rates, exact site coordinates, budgets or private partner notes. With an authorized partner, compare only its saved work type and site. Verify field-employee denial and no write access from a read-only grant.
3. Prepare one explicitly authorized synthetic capability or inert draft using the exact harmless values agreed for the release test. Confirm that preparation reports pending without claiming persistence. Approve on VNDRLY; use `v_action_status` and the matching read tool to verify the canonical ID and saved values. Retry the same prepared action and verify one result. Do not send or accept an operational offer as the harmless test.
4. Record installed package version, real scoped-read evidence, synthetic action/reference/readback and cleanup disposition. Track installed, submitted, approved and publicly available statuses separately; pending OpenAI review is not public availability.

Focused local checks: `pnpm --filter @workspace/api-spec run codegen`, API marketplace/connection/confirmation tests, and `pnpm --filter @workspace/api-server exec vitest run --config vitest.eval.config.ts src/assistant/__evals__/marketplace-tool-use.eval.ts`. The marketplace tool-use eval is deterministic and makes no live model, account or database calls. The repository has no root `generate` script.

`migrate:assistant-connection` only runs `ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_oauth_grants jsonb`. It performs no reset, seed, delete or credential rotation. API deployment applies it before restarting and provisions only the two exact standard OAuth discovery proxy locations, preserving the existing Nginx site and retaining a backup. The proxy config is validated before reload.

`ASSISTANT_CONNECTION_ENABLED=1` enables the routes. API deployment sets it only if absent; an explicit existing opt-out is preserved. Disabled routes return 503. Scoped bearer tokens never enter the general staff-cookie shim.

Before main promotion, run the five repository verification gates on the exact tree. The isolated concurrency test only runs with the fresh loopback test-database provenance marker and uses its own one-connection pool. Check live health, discovery JSON, unauthenticated MCP challenge, ChatGPT account linking, a permission-scoped read and an explicitly authorized harmless write/result readback. Keep implemented, validated, deployed and live-account-verified status distinct.

No public marketplace submission or App Store release is included in account-connection setup. Native tracking/offline/wake-word/Twilio capabilities remain separate implementation work.
## Device sign-out and ChatGPT authorization

Ordinary Sign Out revokes only the signed-out device's exact login token. Each
new login has a unique signed identity. A private, additive database column
retains only token fingerprints until expiry, so revocation survives API restarts
without exposing tokens through user records. Browser consent and approval
pages reject signed-out device tokens as well.

ChatGPT's separately consented OAuth grant survives ordinary device sign-out.
Password changes, account suspension, authority changes, explicit disconnection
and `POST /api/auth/logout-all` continue to revoke the affected authorization.
The staff guard fails closed if durable revocation cannot be checked. None of
these sign-out actions end a staff shift.

An authorization already invalidated by the former account-wide logout behavior
needs one fresh connection to the same VNDRLY account and chosen scopes. Existing
revoked grants are never restored or silently upgraded.
