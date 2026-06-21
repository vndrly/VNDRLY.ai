// AskV read-only market data tools — external stock/commodity quotes.
// Available to all signed-in portal roles (including field employees).

import type { SessionPayload } from "../lib/session";
import { err } from "./data-tools-helpers";
import {
  fetchAlphaVantageStockQuote,
  fetchAlphaVantageWtiCrude,
  isAlphaVantageConfigured,
} from "../lib/market-data/alpha-vantage";
import {
  fetchFinnhubStockQuote,
  isFinnhubConfigured,
} from "../lib/market-data/finnhub";

export const MARKET_DATA_TOOL_NAMES = ["get_stock_quote", "get_crude_oil_price"] as const;

export type MarketDataToolName = (typeof MARKET_DATA_TOOL_NAMES)[number];

export function isMarketDataTool(name: string): name is MarketDataToolName {
  return (MARKET_DATA_TOOL_NAMES as readonly string[]).includes(name);
}

function requireSignedIn(session: SessionPayload): string | null {
  if (!session.userId) return err("Must be signed in.");
  return null;
}

async function getStockQuote(args: Record<string, unknown>, session: SessionPayload): Promise<string> {
  const gate = requireSignedIn(session);
  if (gate) return gate;

  const raw = args.symbol;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return err("symbol is required (e.g. 'XOM' for Exxon Mobil).");
  }

  const errors: string[] = [];

  if (isFinnhubConfigured()) {
    try {
      const quote = await fetchFinnhubStockQuote(raw);
      return JSON.stringify({
        ...quote,
        note: "US equities via Finnhub. Use ticker symbols like XOM, CVX, COP — not company names.",
      });
    } catch (e) {
      errors.push(`Finnhub: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (isAlphaVantageConfigured()) {
    try {
      const quote = await fetchAlphaVantageStockQuote(raw);
      return JSON.stringify({
        ...quote,
        note: "End-of-day US quote via Alpha Vantage (free tier). For intraday prices configure FINNHUB_API_KEY.",
      });
    } catch (e) {
      errors.push(`Alpha Vantage: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!isFinnhubConfigured() && !isAlphaVantageConfigured()) {
    return err(
      "Market data is not configured. Set FINNHUB_API_KEY and/or ALPHA_VANTAGE_API_KEY in the server environment.",
    );
  }

  return err(errors.join(" ") || "Unable to fetch stock quote.");
}

async function getCrudeOilPrice(args: Record<string, unknown>, session: SessionPayload): Promise<string> {
  const gate = requireSignedIn(session);
  if (gate) return gate;

  if (!isAlphaVantageConfigured()) {
    return err(
      "Crude oil prices require ALPHA_VANTAGE_API_KEY (Finnhub does not expose WTI). Add the key to the server environment.",
    );
  }

  const intervalRaw = typeof args.interval === "string" ? args.interval : "daily";
  const interval =
    intervalRaw === "weekly" || intervalRaw === "monthly" ? intervalRaw : "daily";

  try {
    const quote = await fetchAlphaVantageWtiCrude(interval);
    return JSON.stringify({
      ...quote,
      note:
        "WTI (West Texas Intermediate, light sweet crude, Cushing OK) from EIA via Alpha Vantage. Free tier is daily/weekly/monthly — not a live futures tick.",
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function runMarketDataTool(
  name: MarketDataToolName,
  args: Record<string, unknown>,
  session: SessionPayload,
): Promise<string> {
  switch (name) {
    case "get_stock_quote":
      return getStockQuote(args, session);
    case "get_crude_oil_price":
      return getCrudeOilPrice(args, session);
  }
}
