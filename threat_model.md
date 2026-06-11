# Threat Model

## Project Overview

VNDRLY is a field operations management platform for partners, vendors, field employees, visitors, and system admins. The production application is a pnpm monorepo with an Express 5 API (`artifacts/api-server`), a React/Vite web app (`artifacts/vndrly`), and an Expo mobile app (`artifacts/vndrly-mobile`). PostgreSQL stores operational, financial, and personnel data. Authentication is a custom signed-session scheme carried in cookies for web clients and Bearer tokens for mobile clients.

Production scope for this scan is the API server plus the primary web and mobile clients. `artifacts/mockup-sandbox` is development-only and should be ignored unless separate evidence shows production reachability. TLS for external traffic is provided by the platform. In production, `NODE_ENV` is assumed to be `production`.

## Assets

- **User accounts and sessions** -- session tokens, password hashes, active membership context, guest sessions, and OAuth/accounting connection state. Compromise enables impersonation or cross-tenant access.
- **Operational field data** -- tickets, GPS logs, site visits, field employee profiles, notes, certifications, and site assignments. This includes sensitive location and workforce data.
- **Multi-tenant business data** -- partner, vendor, invoice, hotlist, analytics, and 1099/reporting data. Cross-tenant disclosure or tampering would impact customers directly.
- **Uploaded files and profile photos** -- private object-storage content, profile photos, logos, and any future uploads stored under the object-storage bucket.
- **Third-party integration secrets** -- QuickBooks/OpenAccountant tokens, object-storage credentials, and database/session secrets.

## Trust Boundaries

- **Browser/mobile client → API** -- all client input is untrusted. The API must authenticate and authorize every state-changing or data-returning endpoint server-side.
- **API → PostgreSQL** -- route handlers translate user requests into database reads and writes. Broken authorization here becomes direct cross-tenant data access or tampering.
- **API → object storage** -- uploaded files and object fetches cross a boundary where private/public visibility and per-object ACLs must be enforced server-side.
- **API → external services** -- QuickBooks, OpenAccountant, Expo push, and weather APIs all receive data or credentials from trusted server code.
- **Public / guest / authenticated / admin roles** -- the app has meaningful privilege separation between unauthenticated visitors, guest check-in users, field employees, vendor users, partner users, and system admins.
- **Vendor / partner tenant boundary** -- authenticated users must only access the organizations and records tied to their active membership or role.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*.ts`, `artifacts/vndrly/src/main.tsx`, `artifacts/vndrly-mobile/app/_layout.tsx`
- **Highest-risk areas:** custom session parsing in `src/lib/session.ts`, `src/routes/auth.ts`, and route-local copies; membership-to-session role derivation in `src/routes/auth.ts`; route files with broad data access such as `src/routes/{tickets,siteLocations,fieldEmployees,partners,vendors,analytics,storage,invoices,dashboard,workTypes}.ts`; storage/object ACL code in `src/routes/storage.ts` and `src/lib/object{Storage,Acl}.ts`; accounting connection/token code in `src/routes/accountingConnections.ts` and `src/lib/accounting/*.ts`; client components that render server-provided URLs directly into links
- **Public/guest surfaces:** `/api/auth/*` login/reset flows, guest visit endpoints, `/api/storage/*`, `/api/visits/public-sites`, `/api/visits/site-context/:siteCode`, health/password-reset endpoints, unauthenticated dashboard/work-type read routes, and any portal/site-code based ticket flow
- **Usually dev-only:** `artifacts/mockup-sandbox`, test files, seed scripts, one-off migration utilities unless production reachability is demonstrated

## Threat Categories

### Spoofing

The application uses a custom HMAC-signed session format instead of a framework session store. Every protected route must verify the session with the production secret, reject forged or stale guest/staff contexts, and avoid insecure fallback secrets in production. OAuth callbacks and other cross-site flows must remain bound to the initiating user and tenant.

### Tampering

Users can create and update tickets, field employee records, comments, invoices, locations, and accounting settings. The server must derive authorization from the authenticated session rather than trusting client-supplied IDs or frontend-only restrictions. All writes that affect tenant-owned data must be scoped to the caller’s organization and role.

### Information Disclosure

The API handles sensitive workforce, location, and financial data. Responses must be filtered by tenant and role, and private object-storage paths must not be directly retrievable without an authorization check. Analytics, ratings, and other business-intelligence endpoints must not be publicly enumerable by tenant ID.

### Denial of Service

Public and guest-accessible endpoints should not allow cheap abuse that forces expensive work, large uploads, or repeated third-party requests without meaningful limits. Background workers and notification/reporting endpoints should avoid attacker-controlled fan-out or unbounded processing.

### Elevation of Privilege

The main risk in this codebase is broken server-side access control across multiple roles and tenants. Admin-only, vendor-only, partner-only, and field-only operations must be enforced by the API even if the web/mobile client hides them. Private storage, cross-tenant record lookups, and sensitive configuration endpoints must not be reachable by lower-privilege users or unauthenticated callers.
