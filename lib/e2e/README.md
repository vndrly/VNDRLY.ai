# @workspace/e2e

End-to-end browser tests (Playwright) that drive the running web app and
api-server against the dev database.

## Prerequisites

- The `artifacts/api-server: API Server` workflow is running.
- The `artifacts/vndrly: web` workflow is running (defaults to
  `http://localhost:23539`).
- `DATABASE_URL` is set (the same dev database both services use).
- Chromium has been installed for Playwright:

  ```
  pnpm --filter @workspace/e2e run test:install
  ```

## Run

```
pnpm --filter @workspace/e2e run test
```

Override the web base URL with `E2E_BASE_URL` if the web workflow is
exposed on a different host/port (e.g. behind the Replit proxy).

## What is covered

- `tests/visit-public.spec.ts` — public visitor sign-in page
  (`/visit/:siteCode`): seeds a partner, vendor, work type, site, and
  site work assignment; drives the guest sign-in form; mocks geolocation
  to verify both the off-geofence error path and the happy-path check-in
  + check-out flow; cleans up its seed data.
- `tests/bulk-1099-recategorize.spec.ts` — bulk 1099 income-category
  controls: signs in as the demo admin (`admin` / `admin123`), seeds a
  deterministic vendor + draft invoice + paid invoice via the dev-only
  `POST /api/auth/seed-1099-fixture` endpoint, then exercises both the
  multi-select bulk-apply toolbar on `/invoices/:id` and the per-vendor
  "Recategorize draft lines" dropdown on the 1099 dashboard at
  `/reports`.
