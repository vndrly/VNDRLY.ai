import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAlphaVantageStockQuote,
  fetchAlphaVantageWtiCrude,
  isAlphaVantageConfigured,
} from "./alpha-vantage";

const KEY = "test-alpha-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("alpha-vantage client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isAlphaVantageConfigured reflects env", () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    expect(isAlphaVantageConfigured()).toBe(false);
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", KEY);
    expect(isAlphaVantageConfigured()).toBe(true);
  });

  it("fetchAlphaVantageStockQuote parses GLOBAL_QUOTE", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", KEY);
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        "Global Quote": {
          "01. symbol": "XOM",
          "02. open": "110.00",
          "03. high": "112.00",
          "04. low": "109.00",
          "05. price": "111.50",
          "06. volume": "1234567",
          "07. latest trading day": "2026-06-20",
          "08. previous close": "110.00",
          "09. change": "1.50",
          "10. change percent": "1.36%",
        },
      }),
    );

    const quote = await fetchAlphaVantageStockQuote("xom", fetchFn);
    expect(quote.symbol).toBe("XOM");
    expect(quote.price).toBe(111.5);
    expect(quote.latestTradingDay).toBe("2026-06-20");
    expect(quote.delayed).toBe(true);
    const firstUrl = (fetchFn.mock.calls[0] as unknown as [string] | undefined)?.[0];
    expect(firstUrl).toContain("function=GLOBAL_QUOTE");
    expect(firstUrl).toContain("symbol=XOM");
  });

  it("fetchAlphaVantageStockQuote surfaces rate-limit Note", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", KEY);
    const fetchFn = vi.fn(async () =>
      jsonResponse({ Note: "25 requests per day" }),
    );

    await expect(fetchAlphaVantageStockQuote("XOM", fetchFn)).rejects.toThrow(/25 requests/);
  });

  it("fetchAlphaVantageWtiCrude parses latest daily row", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", KEY);
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        name: "Crude Oil Prices WTI",
        interval: "daily",
        unit: "dollars per barrel",
        data: [
          { date: "2026-06-20", value: "78.42" },
          { date: "2026-06-19", value: "77.90" },
        ],
      }),
    );

    const quote = await fetchAlphaVantageWtiCrude("daily", fetchFn);
    expect(quote.commodity).toBe("WTI");
    expect(quote.price).toBe(78.42);
    expect(quote.asOfDate).toBe("2026-06-20");
    const firstUrl = (fetchFn.mock.calls[0] as unknown as [string] | undefined)?.[0];
    expect(firstUrl).toContain("function=WTI");
    expect(firstUrl).toContain("interval=daily");
  });

  it("throws when API key missing", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    await expect(fetchAlphaVantageWtiCrude()).rejects.toThrow(/not configured/);
  });
});
