import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

test("personal EULA acceptance remains checked after reload", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/personal-agreements?section=eula");
  const checkbox = page.getByRole("checkbox", { name: "I agree", exact: true });

  await expect(checkbox).not.toBeChecked();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/personal-agreements" &&
      response.request().method() === "POST",
  );
  await checkbox.click();
  expect((await saved).ok()).toBe(true);
  await expect(checkbox).toBeChecked();

  await page.reload();
  await expect(checkbox).toBeChecked();
});
