import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

// The former office Crew Map is now Mapping. Legacy bookmarks must reach
// the shared map rather than mount the retired office SSE surface.
test("Legacy Crew Map opens Mapping and preserves bookmark context", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/crew-map?view=staff#coverage");
  await expect(page).toHaveURL(/\/mapping\?view=staff#coverage$/);
  await expect(page.getByTestId("gate-locations-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mapping", exact: true })).toBeVisible();
});

