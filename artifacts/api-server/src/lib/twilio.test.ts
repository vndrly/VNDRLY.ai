import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isE164Phone, sendTransactionalSms } from "./twilio";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = "test-account-sid";
  process.env.TWILIO_API_KEY = "test-api-key";
  process.env.TWILIO_API_SECRET = "secret";
  process.env.TWILIO_PHONE_NUMBER = "+14055551212";
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ sid: "SM123", status: "queued" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("isE164Phone", () => {
  it("accepts E.164 numbers and rejects local numbers", () => {
    expect(isE164Phone("+14055551212")).toBe(true);
    expect(isE164Phone("4055551212")).toBe(false);
  });
});

describe("sendTransactionalSms", () => {
  it("sends a transactional SMS with the configured Twilio number", async () => {
    const result = await sendTransactionalSms({
      to: "+14055554321",
      body: "VNDRLY test",
    });

    expect(result).toEqual({ sid: "SM123", status: "queued", errorCode: undefined });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const params = init.body as URLSearchParams;
    expect(params.get("To")).toBe("+14055554321");
    expect(params.get("From")).toBe("+14055551212");
    expect(params.get("Body")).toBe("VNDRLY test");
  });

  it("prefers a messaging service when configured", async () => {
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG12345678901234567890123456789012";

    await sendTransactionalSms({
      to: "+14055554321",
      body: "VNDRLY test",
    });

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const params = init.body as URLSearchParams;
    expect(params.get("MessagingServiceSid")).toBe("MG12345678901234567890123456789012");
    expect(params.get("From")).toBeNull();
  });

  it("rejects non-E.164 recipients before calling Twilio", async () => {
    await expect(
      sendTransactionalSms({ to: "4055554321", body: "VNDRLY test" }),
    ).rejects.toThrow("E.164");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves a safe provider rejection code without copying its sensitive message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: 21610, message: "Private phone +14055554321 opted out" }), { status: 400 }));
    const error = await sendTransactionalSms({ to: "+14055554321", body: "VNDRLY alert" }).catch(error => error);
    expect(error.code).toBe("21610");
    expect(error.message).not.toContain("14055554321");
    expect(error.definitelyRejected).toBe(true);
  });
});
