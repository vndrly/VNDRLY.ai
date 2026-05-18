import type { FullConfig } from "@playwright/test";

// Idempotent dev-only safety net: hit POST /api/auth/seed before any spec
// runs so the canonical demo credentials (admin/admin123, exxon/exxon123,
// …) always verify against the dev database. Several browser specs in
// this suite log in with `admin/admin123` directly (see
// bulk-1099-recategorize.spec.ts, crew-map-gap-warning.spec.ts,
// visit-public.spec.ts via the field-employee portal, etc.). If a SQL
// import or a previous test run leaves a drifted bcrypt hash behind,
// every one of those specs silently 401s on login and fails far away
// from the actual root cause. /auth/seed is idempotent and registered
// only when NODE_ENV === "development", which matches what the
// playwright.config.ts webServer entries set when they boot the
// api-server. See Task #739 for the original drift bug.
//
// We intentionally do NOT throw if /auth/seed is unreachable — the suite
// will still surface the real failure at the spec level (e.g. login 401),
// but at least we tried to fix it first. Logging the outcome makes the
// fact that we tried obvious in CI logs.

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:23539";
  const seedURL = `${baseURL.replace(/\/$/, "")}/api/auth/seed`;
  try {
    const res = await fetch(seedURL, { method: "POST" });
    if (!res.ok) {
      // 404 means the dev-only route isn't registered (NODE_ENV !==
      // "development"). That's a config issue, not something to fix
      // here — let the specs surface the real problem.
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e global-setup] POST /api/auth/seed -> ${res.status} ${res.statusText}; demo credentials may not be canonical`,
      );
      return;
    }
    // eslint-disable-next-line no-console
    console.log("[e2e global-setup] POST /api/auth/seed ok — demo credentials reset to canonical values");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[e2e global-setup] POST /api/auth/seed failed: ${(err as Error).message}; demo credentials may not be canonical`,
    );
  }
}
