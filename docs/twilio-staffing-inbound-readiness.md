# Staffing SMS reply readiness

The signed `/api/twilio/staffing-alert-reply` route defaults disabled. REST sending uses the existing API key/secret; incoming signature validation separately requires the account's existing `TWILIO_AUTH_TOKEN`. Standard API keys cannot fetch `/Accounts` or `/Keys`; they cannot supply the webhook signature secret. Do not rotate credentials or substitute the API secret.

Run through the existing API deployment's VPS remote block, from `/var/www/vndrly`, with the VPS's private environment:

```sh
sudo -u vndrly env HOME=/home/vndrly node --env-file=/var/www/vndrly/.env.production scripts/provision-twilio-staffing-inbound.mjs
```

This is read-only. JSON contains booleans, counts and blocker codes, with no raw provider payload, phone, credential, or existing webhook URL. Exit 2 means blocked. No customer or synthetic SMS is sent. The current account token is checked with a read-only account request; only account SID/status are used. Any credential fields in that provider response are discarded, never extracted, printed or persisted.

The authorized provisioning form adds `--configure`. It changes only the Messaging Service's `InboundRequestUrl`, `InboundMethod=POST`, and `UseInboundWebhookOnNumber=false`, and verifies readback. Existing service/number inbound routes, fallback hooks or a number's TwiML application block provisioning unless the URLs are empty or exactly this route. Service settings are reread immediately before the write; a concurrent routing change blocks it. Twilio provides no conditional update transaction across its service and number resources. Sender enrollment, number configuration, delivery-status callbacks, opt-out settings and credentials are preserved. Short-code routing requires separate review. Sender inventory is paginated and bounded; incomplete inventory blocks changes.

The service resource does not expose Advanced Opt-Out configuration. The script explicitly reports that limitation and requires the existing `TWILIO_ADVANCED_OPT_OUT_ENABLED=true` attestation documented in `gate-alert-channels.md`. It never enables or rewrites STOP/START/HELP behavior. An explicit false reply flag remains disabled.

Only after the configure command exits 0 may the existing deploy block append missing `TWILIO_STAFFING_INBOUND_URL=https://vndrly.ai/api/twilio/staffing-alert-reply` and `TWILIO_STAFFING_REPLY_ENABLED=true`, preserving explicit settings, then perform its normal API restart. Keep the redacted result as release evidence. After restart an unsigned form POST must return 403; a 503 remains disabled/unconfigured. Do not send a forged signed ACK or any real message for smoke verification. A successful configuration check does not prove carrier delivery or a real inbound reply.

The operational MidCon notification hold remains unchanged. This script has no database access and cannot resume company sends. A missing token, credential failure, existing webhook conflict or unverified opt-out setup remains a documented provider blocker; API deployment can complete with SMS reply handling disabled rather than claim it is live.

References: [Twilio Messaging Service resource](https://www.twilio.com/docs/messaging/api/service-resource), [webhook signatures](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [API key access](https://www.twilio.com/docs/iam/api-keys).
