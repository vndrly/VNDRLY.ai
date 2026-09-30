import fs from "node:fs";
import { parseEnv } from "node:util";

const BASE_URL = "https://api.massive.com";

export type MassiveFetch = typeof fetch;

export type MassiveStockQuoteResult = {
  provider: "massive";
  symbol: string;
  price: number;
  change: number;
  changePercent: string;
  previousClose: number;
  asOfUnix: number | null;
  delayed: true;
};

function apiKey(): string | null {
  const direct = process.env.MASSIVE_API_KEY?.trim();
  if (direct) return direct;
  const file = process.env.MASSIVE_API_KEY_FILE?.trim();
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    const values = parseEnv(raw);
    return Object.entries(values).find(([name]) => /massive|polygon|api.?key/i.test(name))?.[1]?.trim()
      || (/^[A-Za-z0-9_-]+$/.test(raw) ? raw : null);
  } catch {
    return null;
  }
}

export function isMassiveConfigured(): boolean {
  return apiKey() != null;
}

export async function fetchMassiveStockQuote(
  symbol: string,
  fetchFn: MassiveFetch = fetch,
): Promise<MassiveStockQuoteResult> {
  const key = apiKey();
  if (!key) throw new Error("MASSIVE_API_KEY is not configured.");
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,15}$/.test(normalized)) throw new Error("Invalid stock symbol.");

  const response = await fetchFn(`${BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(normalized)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}`, "User-Agent": "VNDRLY/1.0 (AskV market data)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Massive HTTP ${response.status}.`);
  const body = await response.json() as {
    ticker?: { ticker?: string; min?: { c?: number; t?: number }; day?: { c?: number }; prevDay?: { c?: number } };
  };
  const snapshot = body.ticker;
  const price = snapshot?.min?.c ?? snapshot?.day?.c;
  const previousClose = snapshot?.prevDay?.c;
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || (previousClose ?? 0) <= 0) {
    throw new Error(`No delayed quote returned for ${normalized}.`);
  }
  const change = price! - previousClose!;
  return {
    provider: "massive",
    symbol: snapshot?.ticker ?? normalized,
    price: price!,
    change,
    changePercent: `${(change / previousClose! * 100).toFixed(2)}%`,
    previousClose: previousClose!,
    asOfUnix: Number.isFinite(snapshot?.min?.t) ? Math.floor(snapshot!.min!.t! / 1000) : null,
    delayed: true,
  };
}
