const BASE_URL = "https://finnhub.io/api/v1";

export type FinnhubFetch = typeof fetch;

export type FinnhubQuoteResult = {
  provider: "finnhub";
  symbol: string;
  price: number;
  change: number | null;
  changePercent: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  asOfUnix: number | null;
};

function apiKey(): string | null {
  const key = process.env.FINNHUB_API_KEY?.trim();
  return key || null;
}

export function isFinnhubConfigured(): boolean {
  return apiKey() != null;
}

export async function fetchFinnhubStockQuote(
  symbol: string,
  fetchFn: FinnhubFetch = fetch,
): Promise<FinnhubQuoteResult> {
  const key = apiKey();
  if (!key) {
    throw new Error("FINNHUB_API_KEY is not configured.");
  }

  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,15}$/.test(normalized)) {
    throw new Error("Invalid stock symbol.");
  }

  const url = new URL(`${BASE_URL}/quote`);
  url.searchParams.set("symbol", normalized);
  url.searchParams.set("token", key);

  const res = await fetchFn(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "VNDRLY/1.0 (AskV market data)" },
  });
  if (!res.ok) {
    throw new Error(`Finnhub HTTP ${res.status}.`);
  }

  const body = (await res.json()) as {
    c?: number;
    d?: number;
    dp?: number;
    h?: number;
    l?: number;
    o?: number;
    pc?: number;
    t?: number;
    error?: string;
  };

  if (typeof body.error === "string" && body.error.length > 0) {
    throw new Error(body.error);
  }

  const price = body.c;
  if (price == null || price === 0) {
    throw new Error(`No live quote returned for ${normalized}.`);
  }

  return {
    provider: "finnhub",
    symbol: normalized,
    price,
    change: body.d ?? null,
    changePercent: body.dp != null ? `${body.dp}%` : null,
    open: body.o ?? null,
    high: body.h ?? null,
    low: body.l ?? null,
    previousClose: body.pc ?? null,
    asOfUnix: body.t ?? null,
  };
}
