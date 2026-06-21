import { afterEach, describe, expect, it, vi } from "vitest";
import { runDataTool } from "./data-tools";
import { MARKET_DATA_TOOL_NAMES } from "./data-tools-market";

vi.mock("../lib/market-data/finnhub", () => ({
  isFinnhubConfigured: vi.fn(() => false),
  fetchFinnhubStockQuote: vi.fn(),
}));

vi.mock("../lib/market-data/alpha-vantage", () => ({
  isAlphaVantageConfigured: vi.fn(() => false),
  fetchAlphaVantageStockQuote: vi.fn(),
  fetchAlphaVantageWtiCrude: vi.fn(),
}));

import {
  fetchAlphaVantageStockQuote,
  fetchAlphaVantageWtiCrude,
  isAlphaVantageConfigured,
} from "../lib/market-data/alpha-vantage";
import { fetchFinnhubStockQuote, isFinnhubConfigured } from "../lib/market-data/finnhub";

const session = { role: "vendor", vendorId: 1, userId: 1 } as never;

describe("MARKET_DATA_TOOL_NAMES", () => {
  it("registers two market tools", () => {
    expect(MARKET_DATA_TOOL_NAMES).toEqual(["get_stock_quote", "get_crude_oil_price"]);
  });
});

describe("runDataTool — market data", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("get_stock_quote requires symbol", async () => {
    const out = JSON.parse(await runDataTool("get_stock_quote", {}, session));
    expect(out.error).toMatch(/symbol/i);
  });

  it("get_stock_quote errors when no providers configured", async () => {
    vi.mocked(isFinnhubConfigured).mockReturnValue(false);
    vi.mocked(isAlphaVantageConfigured).mockReturnValue(false);
    const out = JSON.parse(await runDataTool("get_stock_quote", { symbol: "XOM" }, session));
    expect(out.error).toMatch(/not configured/i);
  });

  it("get_stock_quote prefers Finnhub when configured", async () => {
    vi.mocked(isFinnhubConfigured).mockReturnValue(true);
    vi.mocked(fetchFinnhubStockQuote).mockResolvedValue({
      provider: "finnhub",
      symbol: "XOM",
      price: 100,
      change: 1,
      changePercent: "1%",
      open: 99,
      high: 101,
      low: 98,
      previousClose: 99,
      asOfUnix: 1,
    });

    const out = JSON.parse(await runDataTool("get_stock_quote", { symbol: "XOM" }, session));
    expect(out.provider).toBe("finnhub");
    expect(out.price).toBe(100);
    expect(fetchFinnhubStockQuote).toHaveBeenCalledWith("XOM");
    expect(fetchAlphaVantageStockQuote).not.toHaveBeenCalled();
  });

  it("get_stock_quote falls back to Alpha Vantage", async () => {
    vi.mocked(isFinnhubConfigured).mockReturnValue(true);
    vi.mocked(isAlphaVantageConfigured).mockReturnValue(true);
    vi.mocked(fetchFinnhubStockQuote).mockRejectedValue(new Error("Finnhub down"));
    vi.mocked(fetchAlphaVantageStockQuote).mockResolvedValue({
      provider: "alpha_vantage",
      symbol: "XOM",
      price: 99,
      change: null,
      changePercent: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      latestTradingDay: "2026-06-20",
      previousClose: null,
      delayed: true,
    });

    const out = JSON.parse(await runDataTool("get_stock_quote", { symbol: "XOM" }, session));
    expect(out.provider).toBe("alpha_vantage");
    expect(fetchAlphaVantageStockQuote).toHaveBeenCalledWith("XOM");
  });

  it("get_crude_oil_price requires Alpha Vantage", async () => {
    vi.mocked(isAlphaVantageConfigured).mockReturnValue(false);
    const out = JSON.parse(await runDataTool("get_crude_oil_price", {}, session));
    expect(out.error).toMatch(/ALPHA_VANTAGE_API_KEY/i);
  });

  it("get_crude_oil_price returns WTI snapshot", async () => {
    vi.mocked(isAlphaVantageConfigured).mockReturnValue(true);
    vi.mocked(fetchAlphaVantageWtiCrude).mockResolvedValue({
      provider: "alpha_vantage",
      commodity: "WTI",
      unit: "USD per barrel",
      interval: "daily",
      asOfDate: "2026-06-20",
      price: 78.42,
      source: "EIA via Alpha Vantage (FRED)",
    });

    const out = JSON.parse(await runDataTool("get_crude_oil_price", { interval: "daily" }, session));
    expect(out.commodity).toBe("WTI");
    expect(out.price).toBe(78.42);
  });

  it("allows field employees", async () => {
    vi.mocked(isAlphaVantageConfigured).mockReturnValue(true);
    vi.mocked(fetchAlphaVantageWtiCrude).mockResolvedValue({
      provider: "alpha_vantage",
      commodity: "WTI",
      unit: "USD per barrel",
      interval: "daily",
      asOfDate: "2026-06-20",
      price: 78,
      source: "EIA via Alpha Vantage (FRED)",
    });

    const out = JSON.parse(
      await runDataTool(
        "get_crude_oil_price",
        {},
        { role: "field_employee", userId: 1, vendorPeopleId: 1 } as never,
      ),
    );
    expect(out.price).toBe(78);
  });
});
