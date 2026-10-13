# Isolate the Prairie Horizon demo from production

Status: approved by the user's "Do it". Implementation underway; production cleanup remains a separate exact-manifest gate.

## Required outcome

The existing 30-day fictional ecosystem remains usable in VNDRLY web and mobile with its existing credentials. Real companies cannot discover, report on, act on, or receive notifications about its records. Demo identities cannot read or change real records. Apple submission remains on hold.

## Findings

The API currently uses one PostgreSQL pool and one Drizzle database. Demo organizations and accounts are ordinary production tenants. Tenant ticket checks work, but the partner dashboard's vendor count includes the wider production directory. Background jobs use the same database. The read-only inventory also found 17 notifications linked to these demo users, beyond the provisioned baseline.

The current database role reports `CREATEDB` capability. This is not proof that another database is reachable through the configured Supabase endpoint; provisioning and a separate-connection preflight must establish that before any cutover. The inventory is saved privately in `.local/prairie-demo-isolation-inventory.json` and contains counts, not passwords or customer records.

## Selected recommendation: separate database

Keep the same API and app, with a separately configured demo PostgreSQL database and connection pool. Use server-derived request context to choose the pool. Default/background work always uses production. This avoids relying on a growing list of interface filters to contain every current and future query.

Alternatives considered: workspace tags with per-route predicates require auditing every global query and every worker; a separate schema still shares production connections, schema resolution, and administrative boundaries. Neither is the recommended boundary for this demo.

### Routing and authentication

- Configure a distinct `DEMO_DATABASE_URL`. Validate its resolved database identity differs from production; fail closed if it is absent or unavailable.
- Identify the existing twenty demo login names through an exact server-maintained registry. Login credentials are checked in the demo database. Never select a realm from an arbitrary client header, query parameter, organization ID, or unsigned token claim.
- Signed authenticated sessions carry their realm. Membership/context switches remain within that realm. Revoke legacy demo sessions at cutover; keep the demo passwords unchanged.
- Select both Drizzle and direct `pool.query`/transaction connections from the same request context. No shared mutable connection setting and no fallback to production on demo errors.
- Include session guards, uploads, downloads, SSE, Ask V, and any connector access in the audit. Disable a demo entry point until its realm handling is verified. Database notifications and event subscriptions must not cross realms.
- Production jobs, startup backfills, export jobs, analytics, and scheduled integrations use only the production pool. Demo workers are disabled initially; useful simulated history already exists.

### Side effects and storage

Demo requests must not send email/SMS/push, charge or transfer money, synchronize real accounting accounts, file tax returns, invoke external meeting/device provisioning, or enroll real people. Block these operations centrally before provider calls and return an explicit simulated/unsupported result. Keep real integration credentials out of demo configuration. Demo files use a dedicated storage namespace and authorization checks; demo users cannot name production object keys.

### Preserve the existing ecosystem

Create an empty destination schema using the application schema, then import only a manifest of the exact synthetic roots and their dependent records. Roots are the marked partner, three marked vendors, and twenty registered users, validated against the private provisioner report. Follow dependent foreign keys, audit records, notifications, and schedule relationships. Required neutral reference data is explicitly allowlisted. Do not clone production business records or provider secrets.

Preserve IDs, passwords, timestamps, statuses, relationships, and all thirty days of history. Validate counts, foreign keys, hashes, linked records, and real sign-ins in the destination before routing any user there. Preserve a private recovery export of this exact synthetic set.

Only after verified copy and routing may the old synthetic operational rows be removed from production, child first, using a reviewed table/primary-key manifest. The removal must be separately shown with exact counts and narrowly scoped commands before execution. Never use cascading deletion, a reset, a broad delete, or a restore over production. If any real-to-demo reference is discovered, stop that removal and report it.

## Acceptance evidence

1. Parallel real and demo requests, including transactions, cannot borrow the other database connection.
2. Real dashboards, vendor discovery, Hotlist, reports, and worker inputs exclude all Prairie Horizon records.
3. Demo dashboards show exactly its three vendors; all seeded services and history remain available.
4. Direct-ID and foreign-key write attempts across realms fail; forged realm hints fail; demo outage never falls back to production.
5. A demo notification/payment/accounting action cannot reach a real provider; demo and real storage/event streams are separate.
6. Real login, ordinary operations, and health checks pass after deployment. Demo account logins and all existing dataset verification pass against the isolated destination.
7. Production cleanup is reconciled against the preserved manifest with zero real rows removed.

## Next gate

Review this design before changing the shared database-access architecture. The implementation plan follows design approval. Destination reachability is a required preflight, not an assumption. No new paid service is authorized by this design; if existing infrastructure cannot host the separate database, present the concrete hosting choice first.
