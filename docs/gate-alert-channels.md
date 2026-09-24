# Urgent gate alert channels

The notification inbox is canonical. Only events mapped to `alerts` use this fan-out, and each recipient's current active membership and notification destination are authorized again before sending. Push, immediate email and SMS have separate claims and outcomes in `notification_channel_deliveries`. Provider acceptance is recorded as `accepted`, never as proof of delivery; only a signed Twilio delivered callback sets SMS `delivered_at`.

Run `migrate:gate-alert-channels` through the API deployment workflow before starting the updated API. It adds guarded preference columns, notification recovery markers/leases, channel and device delivery audit tables and indexes. No local migration or shared database access is needed for the unit tests.

## Provider activation

Email defaults on in the user preferences, but server delivery remains off until `GATE_ALERT_EMAIL_ENABLED=true` and the existing SendGrid readiness checks pass (configured sender/API key, authenticated domain, sandbox off). It reuses `sendNotificationAlertEmail`. Missing configuration records `skipped/not_configured`; no delivery is claimed.

SMS requires all existing Twilio transactional readiness checks plus:

- A registered, approved Messaging Service (`TWILIO_MESSAGING_SERVICE_SID`).
- Advanced Opt-Out configured in that Messaging Service for STOP/START/HELP, and `TWILIO_ADVANCED_OPT_OUT_ENABLED=true` only after that configuration is verified.
- `TWILIO_AUTH_TOKEN` for verifying Twilio callback signatures. Sending continues to use the existing API key/secret.
- `TWILIO_STATUS_CALLBACK_URL=https://vndrly.ai/api/twilio/gate-alert-status` (the exact public HTTPS URL, without query or fragment).

The sender adds a random attempt identifier to each callback URL. Signature verification covers the complete URL and every form field. Provider status callbacks must come from the configured Twilio account; unknown/stale attempts and repeated or backward state changes do nothing. No staff session is required on this one signed callback endpoint.

## Consent and retries

SMS defaults off. Only an authenticated gate user can enable it for their own current membership's valid saved E.164 phone. Consent is timestamped server-side and bound to the login, membership, vendor-person record and phone. A phone or membership change makes it ineffective. Mobile sends the SMS preference only after the user changes that switch, so saving another preference cannot silently renew SMS consent. Revocation matches both the consent fingerprint and timestamp, preventing a late callback from revoking a newer opt-in.

Only explicit STOP (21610) or invalid/non-mobile destination rejection (21211/21614) clears matching consent. Carrier delivery errors, including 30003 (temporarily unreachable), 30005 and 30006, do not revoke consent. Advanced Opt-Out also blocks delivery at Twilio. Re-enabling the VNDRLY preference does not bypass the provider's STOP suppression; the person must independently use the provider's supported START process. See [Twilio 30003](https://www.twilio.com/docs/api/errors/30003), [21211](https://www.twilio.com/docs/api/errors/21211), and [21614](https://www.twilio.com/docs/api/errors/21614).

Canonical urgent records atomically set `urgent_delivery_pending` before any preference/contact lookup. Each recipient has a five-minute compare-and-set worker lease; failed lookups leave pending work, consume no provider attempts, and cannot suppress other recipients. A crash before scheduling recovers after lease expiry. The marker clears only after terminal scheduling decisions/audits; due definite channel failures remain independently discoverable. This canonical storage also retains urgent office records when the legacy office category is disabled, while list visibility, badge counts and outbound channels respect that category preference.

Canonical urgent types are immediate for both gate and office delivery: enabled channels bypass quiet hours and daily digests, including after recovery. No transient `forceImmediateDelivery` flag is persisted; non-urgent legacy uses of that flag are unchanged and outside this pipeline.

The existing notification worker retries only definite retryable failures, up to three attempts with a one-minute-per-attempt delay. Accepted sends and skipped channels are not replayed. A SendGrid 429 is a definite retryable rejection; timeouts, 408 and server errors remain ambiguous. Ambiguous email/SMS failures are recorded as `unknown`; a process interruption after a claim leaves `sending`. These are deliberately not automatically resent because acceptance may already have occurred. Operations can reconcile them against provider records.

Push additionally claims each destination in `notification_push_deliveries` using a SHA-256 device-token fingerprint. Each actual Expo request targets one device. Accepted, ambiguous and crashed (`sending`) destinations are never replayed when a sibling needs a retry. `MessageRateExceeded`/HTTP 429 retries are bounded; `DeviceNotRegistered` permanently stops that destination and retires only the exact token belonging to the user. Expo acceptance means queued, not proof of device delivery. See [Expo tickets and errors](https://docs.expo.dev/push-notifications/sending-notifications/).

Audit rows contain IDs, channel or destination hash, attempt count/token, consent identity/timestamp, safe error codes and status timestamps, never raw device tokens, phone numbers, email addresses, notification bodies or raw provider payloads.

Reference: [Twilio webhook signature requirements](https://www.twilio.com/docs/usage/webhooks/webhooks-security) and [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).
