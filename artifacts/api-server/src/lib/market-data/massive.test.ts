import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMassiveStockQuote, isMassiveConfigured } from "./massive";

describe("Massive stock quotes", () => {
  afterEach(() => {
    delete process.env.MASSIVE_API_KEY;
    delete process.env.MASSIVE_API_KEY_FILE;
  });

  it("parses the delayed snapshot used by AskV", async () => {
    process.env.MASSIVE_API_KEY = "test-key";
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      ticker: {
        ticker: "XOM",
        min: { c: 161.35, t: 1_790_719_200_000 },
        day: { c: 161.10 },
        prevDay: { c: 162.49 },
      },
    }), { status: 200 })) as typeof fetch;

    await expect(fetchMassiveStockQuote("xom", fetchFn)).resolves.toMatchObject({
      provider: "massive",
      symbol: "XOM",
      price: 161.35,
      previousClose: 162.49,
      delayed: true,
      asOfUnix: 1_790_719_200,
    });
    expect(isMassiveConfigured()).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/tickers/XOM"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }),
    );
  });

  it("rejects invalid symbols before requesting data", async () => {
    process.env.MASSIVE_API_KEY = "test-key";
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(fetchMassiveStockQuote("not a ticker", fetchFn)).rejects.toThrow(/invalid stock symbol/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
