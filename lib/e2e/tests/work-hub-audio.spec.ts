import { test, expect, chromium, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createPool, hashPassword, makeStamp } from "../helpers/db";
import { createVendor, createUser, createUserOrgMembership, setActiveMembership } from "../helpers/fixtures";
import { loginAsVendor } from "../helpers/auth";

// Real local signaling and Chromium WebRTC; only microphone hardware is synthetic.
async function packets(page: Page) {
  return page.evaluate(async () => {
    const proof = (window as any).__audioProof;
    const result = { inbound: 0, outbound: 0, connected: 0, recorders: proof.recorders };
    for (const peer of proof.peers as RTCPeerConnection[]) {
      if (peer.connectionState === "connected") result.connected++;
      (await peer.getStats()).forEach((row: any) => {
        if (row.kind !== "audio") return;
        if (row.type === "inbound-rtp") result.inbound += row.packetsReceived ?? 0;
        if (row.type === "outbound-rtp") result.outbound += row.packetsSent ?? 0;
      });
    }
    return result;
  });
}

test("two invited users exchange real internal audio while recording stays off", async ({ baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const pool = createPool();
  const stamp = makeStamp();
  const password = "AudioFixtureOnly-2026";
  const browser = await chromium.launch({
    ...testInfo.project.use.launchOptions,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const vendor = await createVendor(pool, { name: `Example Audio ${stamp}`, contactName: "Audio Example", contactEmail: `audio-${stamp}@example.invalid` });
    const users = [];
    for (const label of ["Caller", "Recipient"]) {
      const username = `audio-${label.toLowerCase()}-${stamp}@example.invalid`;
      const user = await createUser(pool, { username, email: username, passwordHash: hashPassword(password), role: "vendor", displayName: `Example ${label} ${stamp}` });
      const membership = await createUserOrgMembership(pool, { userId: user.id, orgType: "vendor", vendorId: vendor.id, role: "admin" });
      await setActiveMembership(pool, { userId: user.id, membershipId: membership.id });
      users.push({ ...user, username, label });
    }
    await pool.query("INSERT INTO platform_settings(id,work_hub_enabled) VALUES(1,true) ON CONFLICT(id) DO UPDATE SET work_hub_enabled=true");
    const contexts = await Promise.all(users.map(() => browser.newContext({ baseURL, permissions: ["microphone"] })));
    for (const context of contexts) await context.addInitScript(() => {
      const proof = { peers: [] as RTCPeerConnection[], recorders: 0 };
      (window as any).__audioProof = proof;
      const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer {
        constructor(config?: RTCConfiguration) { super(config); proof.peers.push(this); }
      };
      const Recorder = window.MediaRecorder;
      window.MediaRecorder = class extends Recorder {
        constructor(stream: MediaStream, options?: MediaRecorderOptions) { super(stream, options); proof.recorders++; }
      };
    });
    const pages = await Promise.all(contexts.map(c => c.newPage()));
    await Promise.all(pages.map((page, index) => loginAsVendor(page, { username: users[index].username, password })));
    const response = await contexts[0].request.post("/api/work-hub/calls", { data: { recipientUserId: users[1].id, operationId: randomUUID() } });
    expect(response.ok()).toBeTruthy();
    const call = await response.json();
    expect(call.status).toBe("ringing");
    for (const context of contexts) {
      const denied = await context.request.post(`/api/work-hub/meetings/${call.occurrenceId}/join`, { data: {} });
      expect(denied.status()).toBe(404); // Uninvited occurrences are deliberately hidden.
    }
    await Promise.all(pages.map(page => page.goto("/work-hub/calls")));
    await pages[1].getByRole("button", { name: "Accept", exact: true }).click();
    await pages[0].getByRole("button").filter({ hasText: `Example Recipient ${stamp}` }).last().click();
    for (const page of pages) {
      await page.getByRole("button", { name: "Join audio", exact: true }).click();
      await page.getByRole("button", { name: "Unmute", exact: true }).click();
    }
    for (const page of pages) await expect.poll(async () => {
      const stats = await packets(page);
      return stats.connected > 0 && stats.inbound > 10 && stats.outbound > 10;
    }, { timeout: 35_000, message: "Both real peers must receive and send RTP audio" }).toBe(true);
    const stats = await Promise.all(pages.map(packets));
    writeFileSync(testInfo.outputPath("real-audio-packets.json"), JSON.stringify(stats, null, 2));
    for (const [index, page] of pages.entries()) {
      expect(stats[index].recorders).toBe(0);
      await expect(page.getByText("Recording and transcription are off.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start recording", exact: true })).toHaveCount(0);
      const denied = await contexts[index].request.post(`/api/work-hub/meetings/${call.occurrenceId}/recording`, { data: { enabled: true } });
      expect(denied.ok()).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`audio-${index ? "recipient" : "caller"}.png`) });
    }
    await testInfo.attach("real-audio-packets", { body: JSON.stringify(stats, null, 2), contentType: "application/json" });
    for (const page of pages) await page.getByRole("button", { name: "Leave", exact: true }).click();
    const ended = await contexts[0].request.post(`/api/work-hub/calls/${call.id}/respond`, { data: { action: "end" } });
    expect(ended.ok()).toBeTruthy();
  } finally {
    await browser.close();
    await pool.end();
  }
});
