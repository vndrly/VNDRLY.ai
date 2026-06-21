import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFinnhubStockQuote, isFinnhubConfigured } from "./finnhub";

const KEY = "test-finnhub-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("finnhub client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isFinnhubConfigured reflects env", () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    expect(isFinnhubConfigured()).toBe(false);
    vi.stubEnv("FINNHUB_API_KEY", KEY);
    expect(isFinnhubConfigured()).toBe(true);
  });

  it("fetchFinnhubStockQuote parses quote object", async () => {
    vi.stubEnv("FINNHUB_API_KEY", KEY);
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        c: 112.34,
        d: 1.2,
        dp: 1.08,
        h: 113,
        l: 110.5,
        o: 111,
        pc: 111.14,
        t: 1750464000,
      }),
    );

    const quote = await fetchFinnhubStockQuote("XOM", fetchFn);
    expect(quote.provider).toBe("finnhub");
    expect(quote.symbol).toBe("XOM");
    expect(quote.price).toBe(112.34);
    expect(quote.changePercent).toBe("1.08%");
    const firstUrl = (fetchFn.mock.calls[0] as unknown as [string] | undefined)?.[0];
    expect(firstUrl).toContain("/quote");
    expect(firstUrl).toContain("symbol=XOM");
  });

  it("throws when quote price is zero", async () => {
    vi.stubEnv("FINNHUB_API_KEY", KEY);
    const fetchFn = vi.fn(async () => jsonResponse({ c: 0 }));
    await expect(fetchFinnhubStockQuote("INVALID", fetchFn)).rejects.toThrow(/No live quote/);
  });
});
