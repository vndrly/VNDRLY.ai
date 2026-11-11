import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import { createUser, createUserOrgMembership, createVendor, setActiveMembership, createPartner, createSiteLocation, createWorkType, createSiteWorkAssignment } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

test("Ask V opens Gate Map and Gate Dashboard from real server navigation intents", async ({ page }, testInfo) => {
  const pool = createPool();
  const stamp = makeStamp();
  const username = `navigation-${stamp}@example.invalid`;
  const password = "NavigationFixtureOnly-2026";
  try {
    await pool.query(await readFile(new URL("../../db/drizzle/gate_change_over.sql", import.meta.url), "utf8"));
    const vendor = await createVendor(pool, { name: `Example Gate Navigation ${stamp}`, contactName: "Casey Example", contactEmail: username });
    await pool.query("UPDATE vendors SET operations_categories=ARRAY['gate']::text[] WHERE id=$1", [vendor.id]);
    const user = await createUser(pool, { username, email: username, passwordHash: hashPassword(password), role: "vendor", displayName: "Casey Example" });
    const membership = await createUserOrgMembership(pool, { userId: user.id, vendorId: vendor.id, orgType: "vendor", role: "admin" });
    await setActiveMembership(pool, { userId: user.id, membershipId: membership.id });
    const partner = await createPartner(pool, { name: `Warwick Example Energy ${stamp}`, contactName: "Fixture", contactEmail: username });
    const site = await createSiteLocation(pool, { partnerId: partner.id, name: "San Roman Completions", address: "Test fixture", latitude: 30, longitude: -100, siteCode: stamp, siteRadiusMeters: 500 });
    const work = await createWorkType(pool, { name: `Navigation gate ${stamp}`, category: "gate" });
    await createSiteWorkAssignment(pool, { siteLocationId: site.id, workTypeId: work.id, vendorId: vendor.id, isGateContractor: true });
    const station = (await pool.query("UPDATE gate_stations SET name=$2 WHERE site_id=$1 AND name='Main gate' RETURNING id", [site.id, "Warwick San Roman Completions 2"])).rows[0];
    await pool.query("INSERT INTO gate_stations(site_id,name,active) VALUES($1,$2,false)", [site.id, "Warwick San Roman Completions 1"]);
    await loginAsVendor(page, { username, password });
    // Only the AI's response is controlled. Navigation comes from the real
    // authenticated tool endpoint and executes through the actual Ask V UI.
    await page.route("**/api/assistant/conversations/*/messages", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const question = route.request().postDataJSON().message;
      const screen = question.includes("Map") ? "gate-map" : "gate-dashboard";
      const query = question.includes("Romen") ? "San Romen completion two" : question.includes("Warwick") ? "Warwick San Roman Completions 2" : question.includes("San Roman") ? "San Roman" : undefined;
      const tool = await page.request.post("/api/assistant/realtime/tool-call", {
        data: { name: "open_screen", arguments: { screen, ...(query ? { query } : {}) }, sessionId: `navigation-${stamp}`, callId: crypto.randomUUID(), clientSurface: "web" },
      });
      expect(tool.ok()).toBe(true);
      const result = await tool.json();
      if (!result.ok) {
        await route.fulfill({ contentType: "text/event-stream", body: `event: done\ndata: ${JSON.stringify({ content: JSON.stringify(result) })}\n\n` });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        return;
      }
      const output = JSON.parse(result.output);
      await route.fulfill({ contentType: "text/event-stream", body: `event: client_intent\ndata: ${JSON.stringify({ intent: output.intent })}\n\nevent: done\ndata: {"content":"Opened."}\n\n` });
      expect(output.ok, JSON.stringify(output)).toBe(true);
    });
    for (const [question, destination, heading] of [["Open Gate Map", "/gate/map", "Gate Map"], ["Open Gate Dashboard", "/gate/change-over", "Dashboard"], ["Open San Roman", "/gate/change-over", "Dashboard"], ["Open Warwick San Roman Completions 2", "/gate/change-over", "Dashboard"], ["Open San Romen completion two on the Map", "/gate/map", "Gate Map"]]) {
      await page.goto("/work-hub/askv");
      await page.getByTestId("assistant-input").fill(question);
      await page.getByTestId("assistant-send").click();
      await expect(page).toHaveURL(new RegExp(`${destination}(\\?|$)`));
      await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
      if (question.includes("Roman") || question.includes("Romen")) {
        expect(new URL(page.url()).searchParams.get("stationId")).toBe(station.id);
        await expect(page.getByRole("combobox", { name: "Site | Gate", exact: true })).toHaveValue(station.id);
      }
      await page.screenshot({ path: testInfo.outputPath(`${question.toLowerCase().replaceAll(" ", "-")}.png`) });
    }
  } finally {
    await pool.end();
  }
});
