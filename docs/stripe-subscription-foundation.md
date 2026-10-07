# VNDRLY organization subscription foundation

This is VNDRLY's own SaaS subscription billing. It is separate from field-ticket
invoices, vendor/partner invoice settings, payroll, payments and marketplace transfers.
Prices remain undecided. The catalog contains configured recurring Stripe Price IDs;
the application does not invent amounts or create products/prices.

## Server configuration

- `VNDRLY_STRIPE_BILLING_ENABLED=1`: explicit activation after setup and validation.
- `VNDRLY_STRIPE_MODE=test` or `live`: keep environments and customer records separate.
- `VNDRLY_STRIPE_SECRET_KEY`: server-only matching-mode restricted key where possible.
- `VNDRLY_STRIPE_WEBHOOK_SECRET`: endpoint-specific signing secret, server only.
- `VNDRLY_STRIPE_PLANS_JSON`: JSON array of `{key,label,priceId}` with unique keys and
  Price IDs. An empty array keeps Checkout disabled. No amounts are stored here.
- `VNDRLY_BILLING_ORIGIN`: trusted HTTPS application origin; defaults to VNDRLY's
  canonical origin. Client-provided URLs and Stripe customer IDs are rejected.

Keep all actual values in the secret manager/environment. The supplied human-formatted
key document is not a dotenv configuration and must not be copied into the repository.
Webhook secret and recurring prices still require configuration. Nothing here activates
Stripe or creates a live customer, charge, product, price or subscription during setup.

## Integration hooks (owned by release coordinator)

The coordinator has staged these server hooks in a separate reviewed batch. They
are not part of the thirteen-file foundation snapshot and are not deployed or
activated by preparing this source. The web return/readiness page is being wired
separately; native billing actions are not yet exposed.

1. Register/run `scripts/migrate-stripe-billing.ts` during guarded API deployment.
   It only adds `stripe_billing_state jsonb` columns to vendors and partners with
   `ADD COLUMN IF NOT EXISTS`. These private fields are deliberately excluded from
   normal Drizzle organization projections; no schema-index export is necessary.
2. In `src/app.ts`, import `organizationSubscriptionWebhook` and mount
   `app.use('/api/organization-subscription/webhook', organizationSubscriptionWebhook)`
   immediately **before** the global `express.json`. Do not add a broad anonymous
   API/session allowlist. This exact endpoint verifies Stripe's signature over raw bytes.
3. In `src/routes/index.ts`, mount `organizationSubscriptionRouter` at
   `/organization-subscription` inside existing authenticated routes.
4. In `src/index.ts`, create/start `createCanonicalBillingReconciler` after database
   readiness, and await its `stop()` during shutdown. Its error callback must emit
   only a constant safe message, never payloads, keys, signatures or hosted-session URLs.
5. First-party web/iOS billing surfaces should use the current tenant-admin GET
   `/api/organization-subscription`, and explicit POST `/checkout` or `/portal` actions.
   Display configured labels and Stripe-hosted price information; do not fabricate
   prices. Checkout/portal actions require a fresh operation UUID and same-origin
   cookie authorization. A native client requires a separately reviewed authenticated
   native origin policy before enabling these actions (no arbitrary Origin bypass).
   Hosted flows return to `/organization-subscription`; that page still needs wiring.

## Durable behavior and limits

Every read/write revalidates the actual current session, membership and tenant admin
authority. Platform admins do not gain cross-tenant billing controls. Customer binding
and receipts live in private, row-locked organization state. An advisory transaction
lock prevents cross-table customer reuse. This intentionally serializes foundation
billing writes; higher-volume storage can be redesigned with explicit review.
Initiating user, membership and session version are recorded from authenticated
context, never caller fields. Exact authorized organization replays retain the
original initiator. Authority inside the lock uses that transaction's connection.

Checkout intent is persisted before calling Stripe. Exact same-UUID retries reuse the
same parameters. Uncertain operations older than 23 hours stop for operator review,
preventing blind retries beyond Stripe's idempotency-key retention window. A signed
paid Checkout webhook can recover a dropped creation response only from a matching
durable intent plus freshly retrieved Checkout/customer/tenant/price/subscription.
The browser return URL never fulfills a subscription.
An open or unresolved earlier Checkout prevents competing subscriptions. A saved
expired session allows a fresh explicit request. Definitive pre-creation price
refusals and a subscription becoming active before creation retain audit provenance
without poisoning future requests; other unknown
outcomes retain their exact intent. Recovered receipts may have no reusable URL.

Signed events are committed to a durable inbox before HTTP acknowledgement. The
bounded worker retries failed reconciliation after restart. Current subscription
retrieval prevents old event payloads from overwriting state with stale snapshots;
processing receipts commit atomically with state. Concurrent workers serialize via
the durable owner lock. Failed fetch/commit does not mark an event processed.
Failed events retain a persisted next-attempt time with bounded exponential backoff.
Due events are selected across tenants before the batch limit, so a failing cohort
cannot permanently block later events. Poison events remain recorded for review.

Status is recorded billing state, not an implemented product-entitlement gate.
`accessEnforcementImplemented:false` is explicit. Unknown/removed prices have no
recognized plan. Existing application access is unchanged. No automatic tax, invoice
delivery, payment transfer, iOS purchase-policy compliance or external delivery claim
is made. Actual sandbox and platform/device acceptance remains a separate gate.

## Official references

- [Hosted subscription Checkout](https://docs.stripe.com/billing/subscriptions/build-subscriptions.md?payment-ui=checkout&ui=stripe-hosted)
- [Signed webhooks, raw bodies, duplicates and ordering](https://docs.stripe.com/webhooks)
- [Customer portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Restricted server API keys](https://docs.stripe.com/keys)

The existing Stripe Node SDK 22.1.0 is retained, with its SDK-pinned API version
2026-04-22.dahlia. A coordinated SDK/API-version upgrade is a separate dependency
decision; this foundation adds no dependency.
