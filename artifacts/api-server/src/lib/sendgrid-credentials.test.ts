import { afterEach, describe, expect, it, vi } from "vitest";

describe("sendgrid getUncachableSendGridClient", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses SENDGRID_API_KEY from env when set (VPS path)", async () => {
    process.env.SENDGRID_API_KEY = "SG.test-key";
    process.env.SENDGRID_FROM_EMAIL = "noreply@vndrly.ai";
    delete process.env.REPL_IDENTITY;
    delete process.env.WEB_REPL_RENEWAL;
    delete process.env.REPLIT_CONNECTORS_HOSTNAME;

    const setApiKey = vi.fn();
    vi.doMock("@sendgrid/mail", () => ({
      default: { setApiKey },
    }));

    const { getUncachableSendGridClient } = await import("./sendgrid");
    const client = await getUncachableSendGridClient();
    expect(setApiKey).toHaveBeenCalledWith("SG.test-key");
    expect(client.fromEmail).toBe("noreply@vndrly.ai");
  });

  it("falls back to OPS_ALERT_EMAIL when SENDGRID_FROM_EMAIL is unset", async () => {
    process.env.SENDGRID_API_KEY = "SG.test-key";
    process.env.OPS_ALERT_EMAIL = "ops@vndrly.ai";
    delete process.env.SENDGRID_FROM_EMAIL;

    const setApiKey = vi.fn();
    vi.doMock("@sendgrid/mail", () => ({
      default: { setApiKey },
    }));

    const { getUncachableSendGridClient } = await import("./sendgrid");
    const client = await getUncachableSendGridClient();
    expect(client.fromEmail).toBe("ops@vndrly.ai");
  });
});
