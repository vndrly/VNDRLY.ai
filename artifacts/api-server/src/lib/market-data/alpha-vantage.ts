const BASE_URL = "https://www.alphavantage.co/query";

export type AlphaVantageFetch = typeof fetch;

export type StockQuoteResult = {
  provider: "alpha_vantage";
  symbol: string;
  price: number;
  change: number | null;
  changePercent: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  latestTradingDay: string | null;
  previousClose: number | null;
  delayed: boolean;
};

export type CrudeOilResult = {
  provider: "alpha_vantage";
  commodity: "WTI";
  unit: "USD per barrel";
  interval: "daily" | "weekly" | "monthly";
  asOfDate: string;
  price: number;
  source: "EIA via Alpha Vantage (FRED)";
};

function apiKey(): string | null {
  const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  return key || null;
}

function rateLimitMessage(body: Record<string, unknown>): string | null {
  for (const field of ["Note", "Information", "Error Message"] as const) {
    const msg = body[field];
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return null;
}

export function isAlphaVantageConfigured(): boolean {
  return apiKey() != null;
}

export async function fetchAlphaVantageStockQuote(
  symbol: string,
  fetchFn: AlphaVantageFetch = fetch,
): Promise<StockQuoteResult> {
  const key = apiKey();
  if (!key) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not configured.");
  }

  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,15}$/.test(normalized)) {
    throw new Error("Invalid stock symbol.");
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("function", "GLOBAL_QUOTE");
  url.searchParams.set("symbol", normalized);
  url.searchParams.set("apikey", key);

  const res = await fetchFn(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "VNDRLY/1.0 (AskV market data)" },
  });
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status}.`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  const limitMsg = rateLimitMessage(body);
  if (limitMsg) throw new Error(limitMsg);

  const quote = body["Global Quote"] as Record<string, string> | undefined;
  if (!quote?.["05. price"]) {
    throw new Error(`No quote returned for ${normalized}.`);
  }

  const parseNum = (raw: string | undefined): number | null => {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const changePercent = quote["10. change percent"]?.replace(/%/g, "").trim() ?? null;

  return {
    provider: "alpha_vantage",
    symbol: quote["01. symbol"] ?? normalized,
    price: Number(quote["05. price"]),
    change: parseNum(quote["09. change"]),
    changePercent: changePercent != null ? `${changePercent}%` : null,
    open: parseNum(quote["02. open"]),
    high: parseNum(quote["03. high"]),
    low: parseNum(quote["04. low"]),
    volume: parseNum(quote["06. volume"]),
    latestTradingDay: quote["07. latest trading day"] ?? null,
    previousClose: parseNum(quote["08. previous close"]),
    delayed: true,
  };
}

export async function fetchAlphaVantageWtiCrude(
  interval: "daily" | "weekly" | "monthly" = "daily",
  fetchFn: AlphaVantageFetch = fetch,
): Promise<CrudeOilResult> {
  const key = apiKey();
  if (!key) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not configured.");
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("function", "WTI");
  url.searchParams.set("interval", interval);
  url.searchParams.set("apikey", key);

  const res = await fetchFn(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "VNDRLY/1.0 (AskV market data)" },
  });
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status}.`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  const limitMsg = rateLimitMessage(body);
  if (limitMsg) throw new Error(limitMsg);

  const rows = body.data as Array<{ date?: string; value?: string }> | undefined;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No WTI crude oil price data returned.");
  }

  const latest = rows[0];
  const price = Number(latest.value);
  if (!latest.date || !Number.isFinite(price)) {
    throw new Error("WTI response missing date or price.");
  }

  return {
    provider: "alpha_vantage",
    commodity: "WTI",
    unit: "USD per barrel",
    interval,
    asOfDate: latest.date,
    price,
    source: "EIA via Alpha Vantage (FRED)",
  };
}
