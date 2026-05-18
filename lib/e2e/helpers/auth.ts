import { expect, type Page } from "@playwright/test";

// Shared login helpers for every Playwright spec under lib/e2e/tests/.
//
// Every spec used to carry its own copy of these helpers and they had
// already drifted (Task #752): some used the reliable
// "wait for the username input to disappear" pattern, others waited on
// post-login layout markers that have repeatedly broken when the SPA's
// wouter routing or the login form changed. Centralising them here means
// the next time the login form changes we fix it in exactly one place.
//
// All helpers use the same wait strategy:
//   - The login form is mounted only on /login. Once the username input
//     is gone we know the SPA has navigated to the post-login app shell.
//   - waitForURL is unreliable here because wouter uses an in-memory
//     location that does not always update window.location synchronously
//     (in particular vendor logins do navigate("/", { replace: true })).

// Canonical seed credentials reset by the dev-only POST /api/auth/seed
// endpoint (see lib/e2e/global-setup.ts).
export const SEED_ADMIN_USERNAME = "admin";
export const SEED_ADMIN_PASSWORD = "admin123";

export interface LoginOptions {
  username: string;
  password: string;
}

export async function login(
  page: Page,
  { username, password }: LoginOptions,
): Promise<void> {
  await page.goto("/login");
  const usernameInput = page.locator('[data-testid="input-username"]');
  await usernameInput.fill(username);
  await page.locator('[data-testid="input-password"]').fill(password);
  await page.locator('[data-testid="button-login"]').click();
  await expect(usernameInput).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Log in with the canonical seed admin (admin/admin123) unless explicit
 * credentials are provided. The org-members-flow spec provisions its own
 * per-run system-admin login (so it doesn't have to mutate the shared
 * demo `admin` row) and passes those credentials in.
 */
export async function loginAsAdmin(
  page: Page,
  credentials: LoginOptions = {
    username: SEED_ADMIN_USERNAME,
    password: SEED_ADMIN_PASSWORD,
  },
): Promise<void> {
  await login(page, credentials);
}

/**
 * Log in as a vendor user. Vendor specs always provision their own
 * vendor login per run (unique username + a known password), so callers
 * must supply both fields.
 */
export async function loginAsVendor(
  page: Page,
  credentials: LoginOptions,
): Promise<void> {
  await login(page, credentials);
}
