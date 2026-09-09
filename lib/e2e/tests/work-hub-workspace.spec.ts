import { test, expect } from "@playwright/test";
import type pg from "pg";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import {
  createVendor,
  createUser,
  createUserOrgMembership,
  setActiveMembership,
} from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

// Uses only the wrapper-owned isolated database and fictional rows.
// Every write crosses the actual UI/API boundary; no production route mocks.
test.describe("Work Hub workspace persisted flow", () => {
  let pool: pg.Pool, username: string, vendorId: number;
  const password = "WorkHubFixtureOnly-2026";
  const stamp = makeStamp();
  test.beforeAll(async () => {
    pool = createPool();
    const vendor = await createVendor(pool, {
      name: `Example Work Hub ${stamp}`,
      contactName: "Casey Example",
      contactEmail: `hub-${stamp}@example.invalid`,
    });
    vendorId = vendor.id;
    username = `hub-admin-${stamp}@example.invalid`;
    const user = await createUser(pool, {
      username,
      email: username,
      passwordHash: hashPassword(password),
      role: "vendor",
      displayName: "Casey Example",
    });
    const membership = await createUserOrgMembership(pool, {
      userId: user.id,
      orgType: "vendor",
      vendorId,
      role: "admin",
    });
    await setActiveMembership(pool, {
      userId: user.id,
      membershipId: membership.id,
    });
    await pool.query(
      "INSERT INTO platform_settings (id, work_hub_enabled) VALUES (1,true) ON CONFLICT (id) DO UPDATE SET work_hub_enabled=true",
    );
  });
  test.afterAll(async () => {
    await pool?.end();
  });
  test("creates a Crew conversation, scheduling page and confirmed CSV task, then opens files and notes", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await loginAsVendor(page, { username, password });
    await page.goto("/work-hub/channels");
    await expect(page.getByTestId("nav-calendar")).toBeVisible();
    await page.getByText("Manage Crews & channels", { exact: true }).click();
    await page.getByLabel("Crew or channel name").fill(`Review Crew ${stamp}`);
    await page
      .getByRole("button", { name: "Create Crew", exact: true })
      .click();
    await expect(
      page
        .getByLabel("Crew")
        .locator("option", { hasText: `Review Crew ${stamp}` }),
    ).toHaveCount(1);
    await page
      .getByLabel("Crew", { exact: true })
      .selectOption({ label: `Review Crew ${stamp}` });
    await page.getByLabel("Crew or channel name").fill(`Handover ${stamp}`);
    await page
      .getByRole("button", { name: "Add channel", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Conversations" })
      .getByRole("button")
      .filter({ hasText: `Handover ${stamp}` })
      .first()
      .click();
    const message = `Synthetic handover message ${stamp}`;
    await page.getByLabel("Message", { exact: true }).fill(message);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByRole("article").getByText(message, { exact: true })).toBeVisible();
    await page.reload();
    await page
      .getByRole("navigation", { name: "Conversations" })
      .getByRole("button")
      .filter({ hasText: `Handover ${stamp}` })
      .first()
      .click();
    await expect(page.getByRole("article").getByText(message, { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("work-hub-conversation.png"),
      animations: "disabled",
      timeout: 120000,
    });

    await page.goto("/work-hub/meetings");
    await page
      .getByRole("button", { name: "Create meeting type", exact: true })
      .click();
    await page
      .getByLabel("Meeting title", { exact: true })
      .fill(`Site review ${stamp}`);
    await page
      .getByLabel("Scheduling page", { exact: true })
      .selectOption("shared");
    await page
      .locator("form")
      .filter({ has: page.getByLabel("Meeting title", { exact: true }) })
      .getByRole("button", { name: "Create meeting type", exact: true })
      .click();
    await expect(
      page
        .getByRole("heading", { name: `Site review ${stamp}`, exact: true })
        .last(),
    ).toBeVisible();
    const from = new Date(Date.now() + 30 * 86400000),
      until = new Date(from.getTime() + 3600000);
    await page
      .getByLabel("Available from", { exact: true })
      .fill(from.toISOString().slice(0, 16));
    await page
      .getByLabel("Available until", { exact: true })
      .fill(until.toISOString().slice(0, 16));
    await page.getByRole("button", { name: "Add window", exact: true }).click();
    const availabilitySaved = page.waitForResponse(response => response.url().endsWith("/availability") && response.request().method() === "PUT" && response.ok());
    await page
      .getByRole("button", { name: "Save availability", exact: true })
      .click();
    await availabilitySaved;

    const typesResponse = await page.request.get(
      "/api/work-hub/scheduling/types",
    );
    expect(typesResponse.ok()).toBeTruthy();
    const type = (await typesResponse.json()).find(
      (row: { title: string }) => row.title === `Site review ${stamp}`,
    );
    expect(type).toBeTruthy();
    const availability = await page.request.get(
      `/api/work-hub/scheduling/types/${type.id}/availability`,
    );
    expect((await availability.json()).slots.length).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath("work-hub-scheduling.png"),
      animations: "disabled",
      timeout: 120000,
    });

    await page.goto("/work-hub/settings");
    await page
      .getByPlaceholder("Example: Microsoft Operations export")
      .fill(`Fixture source ${stamp}`);
    await page
      .getByLabel("CSV import file", { exact: true })
      .setInputFiles({
        name: "work.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `ID,Title,Body\nfixture-${stamp},Imported review ${stamp},Synthetic work only`,
        ),
      });
    await page
      .getByLabel("External ID column", { exact: true })
      .selectOption("0");
    await page.getByLabel("Title column", { exact: true }).selectOption("1");
    await page.getByLabel("Body column", { exact: true }).selectOption("2");
    await page
      .getByRole("button", { name: "Validate and stage preview", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Review import into VNDRLY",
        exact: true,
      }),
    ).toBeVisible();
    const before = await pool.query(
      "SELECT id FROM work_hub_tasks WHERE owner_org_type='vendor' AND owner_org_id=$1 AND title=$2",
      [vendorId, `Imported review ${stamp}`],
    );
    expect(before.rowCount).toBe(0);
    await page
      .getByRole("button", {
        name: "Confirm and import ready rows",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Import complete: 1 created/)).toBeVisible();
    const after = await pool.query(
      "SELECT id FROM work_hub_tasks WHERE owner_org_type='vendor' AND owner_org_id=$1 AND title=$2",
      [vendorId, `Imported review ${stamp}`],
    );
    expect(after.rowCount).toBe(1);
    await page.screenshot({
      path: testInfo.outputPath("work-hub-import.png"),
      animations: "disabled",
      timeout: 120000,
    });

    await page.goto("/work-hub/files");
    await expect(
      page.getByRole("tab", { name: "File library", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Native notes", exact: true }).click();
    await page
      .getByLabel("Note title", { exact: true })
      .fill(`Working note ${stamp}`);
    await page
      .getByLabel("Note text", { exact: true })
      .fill("Synthetic native note survives the new file library.");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `Working note ${stamp}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Existing uploads", exact: true })
      .click();
    await expect(
      page.getByText(
        "Files uploaded before the new library remain available with their original access permissions.",
      ),
    ).toBeVisible();
    await page.getByTestId("nav-calendar").click();
    await expect(page.getByTestId("work-hub-calendar-layout")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/work-hub/channels");
    await page.screenshot({
      path: testInfo.outputPath("work-hub-phone.png"),
      animations: "disabled",
      timeout: 120000,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
});
