import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadOaOAuthConfig,
  oaAuthorizationUrl,
  oaExchangeCodeForTokens,
  oaRefreshAccessToken,
  pushBundleToOa,
  reconcileOaInvoices,
  updateOaInvoice,
  validateOaBaseUrl,
} from "./oa";
import { inMemoryPushedInvoiceStore } from "./pushedInvoices";

const TEST_HOST = "https://api.openaccountant.com/v1";

describe("validateOaBaseUrl", () => {
  const ALLOWLIST_KEY = "OPENACCOUNTANT_HOST_ALLOWLIST";
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[ALLOWLIST_KEY];
    delete process.env[ALLOWLIST_KEY]; // use the default allowlist
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[ALLOWLIST_KEY];
    else process.env[ALLOWLIST_KEY] = prev;
  });

  it("accepts the default OA hosts and trims trailing slash", () => {
    expect(validateOaBaseUrl("https://api.openaccountant.com/v1/")).toBe(
      "https://api.openaccountant.com/v1",
    );
    expect(validateOaBaseUrl("https://eu.openaccountant.com/v2")).toBe(
      "https://eu.openaccountant.com/v2",
    );
  });

  it("rejects http://", () => {
    expect(() =>
      validateOaBaseUrl("http://api.openaccountant.com/v1"),
    ).toThrow(/https/);
  });

  it("rejects localhost and *.localhost", () => {
    expect(() => validateOaBaseUrl("https://localhost/v1")).toThrow(
      /localhost/,
    );
    expect(() =>
      validateOaBaseUrl("https://api.localhost/v1"),
    ).toThrow(/localhost/);
  });

  it("rejects private IPv4 literals", () => {
    expect(() => validateOaBaseUrl("https://10.0.0.1/v1")).toThrow(
      /private IP/,
    );
    expect(() => validateOaBaseUrl("https://192.168.1.5/v1")).toThrow(
      /private IP/,
    );
    expect(() => validateOaBaseUrl("https://127.0.0.1/v1")).toThrow(
      /private IP/,
    );
    expect(() => validateOaBaseUrl("https://169.254.169.254/")).toThrow(
      /private IP/,
    );
    expect(() => validateOaBaseUrl("https://172.16.5.5/v1")).toThrow(
      /private IP/,
    );
  });

  it("rejects all IP literals (including public)", () => {
    expect(() => validateOaBaseUrl("https://8.8.8.8/v1")).toThrow(
      /IP address/,
    );
    expect(() => validateOaBaseUrl("https://[::1]/v1")).toThrow(/private/);
  });

  it("rejects URLs with userinfo", () => {
    expect(() =>
      validateOaBaseUrl("https://user:pass@api.openaccountant.com/v1"),
    ).toThrow(/credentials/);
  });

  it("rejects hosts outside the allowlist", () => {
    expect(() => validateOaBaseUrl("https://evil.example.com/v1")).toThrow(
      /allowlist/,
    );
    // Suffix-confusion: only true subdomains of allowlisted hosts pass.
    expect(() =>
      validateOaBaseUrl("https://openaccountant.com.evil.test/v1"),
    ).toThrow(/allowlist/);
  });

  it("honors OPENACCOUNTANT_HOST_ALLOWLIST overrides", async () => {
    process.env[ALLOWLIST_KEY] = "sandbox.example.test";
    // Re-import to pick up the new env var.
    vi.resetModules();
    const { validateOaBaseUrl: v2 } = await import("./oa");
    expect(v2("https://sandbox.example.test/v1")).toBe(
      "https://sandbox.example.test/v1",
    );
    expect(() => v2("https://api.openaccountant.com/v1")).toThrow(/allowlist/);
  });

  it("rejects garbage input", () => {
    expect(() => validateOaBaseUrl("not a url")).toThrow();
  });
});

// Build a fake fetch that routes lookup GETs and create POSTs.
function buildFakeOaFetch(opts: {
  existingCustomers?: Record<string, string>;
  existingVendors?: Record<string, string>;
  postFails?: boolean;
} = {}) {
  const calls: { url: string; method: string; body: string }[] = [];
  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: String(init?.body ?? "") });
      if (method === "GET" && url.includes("/customers")) {
        const u = new URL(url);
        const name = u.searchParams.get("customer_name") ?? "";
        const id = opts.existingCustomers?.[name];
        return new Response(
          JSON.stringify({
            items: id ? [{ id, customer_name: name }] : [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (method === "GET" && url.includes("/vendors")) {
        const u = new URL(url);
        const name = u.searchParams.get("vendor_name") ?? "";
        const id = opts.existingVendors?.[name];
        return new Response(
          JSON.stringify({
            items: id ? [{ id, vendor_name: name }] : [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (method === "POST" && opts.postFails) {
        return new Response("nope", { status: 500 });
      }
      if (method === "POST") {
        return new Response(JSON.stringify({ id: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  );
  return { fetchImpl, calls };
}

const SAMPLE_BUNDLE = {
  invoices: [
    {
      invoiceNumber: "INV-2",
      invoiceDate: new Date("2026-03-01T00:00:00Z"),
      dueDate: null,
      total: "50.00",
      subtotal: "50.00",
      taxTotal: "0.00",
      memo: null,
      partnerName: "Acme",
      vendorName: "Sub",
    },
  ],
  lines: [
    {
      invoiceNumber: "INV-2",
      description: "Service",
      amount: "50.00",
      taxAmount: "0.00",
      lineType: "Labor",
    },
  ],
  partners: [{ name: "Acme", email: null, address: null }],
  vendors: [
    { name: "Sub", email: null, address: null, federalTaxId: null },
  ],
};

describe("pushBundleToOa", () => {
  it("looks up first then POSTs each entity, returning counts", async () => {
    const { fetchImpl, calls } = buildFakeOaFetch();
    const result = await pushBundleToOa(SAMPLE_BUNDLE, {
      apiKey: "K123",
      baseUrl: TEST_HOST,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.customersCreated).toBe(1);
    expect(result.vendorsCreated).toBe(1);
    expect(result.invoicesCreated).toBe(1);
    expect(result.customersAlreadyExisted).toBe(0);
    expect(result.vendorsAlreadyExisted).toBe(0);
    expect(result.invoicesAlreadyUpToDate).toBe(0);
    // The reconciler reads `invoicesPushed` to decide which invoices to
    // verify; an invoice that successfully POSTed must show up here.
    expect(result.invoicesPushed).toEqual(["INV-2"]);

    // Order: GET customer, POST customer, GET vendor, POST vendor, POST invoice.
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      `GET /v1/customers`,
      `POST /v1/customers`,
      `GET /v1/vendors`,
      `POST /v1/vendors`,
      `POST /v1/invoices`,
    ]);
    const inv = JSON.parse(calls[4].body);
    expect(inv.invoice_number).toBe("INV-2");
    expect(inv.invoice_date).toBe("2026-03-01");
    expect(inv.lines[0].amount).toBe(50);
  });

  it("includes the 1099 income_category key/label on each pushed line so the live OA payload matches the OA CSV exporter", async () => {
    const { fetchImpl, calls } = buildFakeOaFetch();
    await pushBundleToOa(
      {
        invoices: [
          {
            invoiceNumber: "INV-1099",
            invoiceDate: new Date("2026-04-01T00:00:00Z"),
            dueDate: null,
            total: "300.00",
            subtotal: "300.00",
            taxTotal: "0.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
        ],
        lines: [
          {
            invoiceNumber: "INV-1099",
            description: "Excavator rental",
            amount: "200.00",
            taxAmount: "0.00",
            lineType: "Rental",
            incomeCategory: "misc_rents",
          },
          {
            invoiceNumber: "INV-1099",
            description: "Misc fee",
            amount: "100.00",
            taxAmount: "0.00",
            lineType: "Fee",
            // "none" must serialize as nulls so the OA UI shows
            // "Not reportable" rather than mislabelling the line.
            incomeCategory: "none",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [],
      },
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    const invCall = calls.find(
      (c) => c.method === "POST" && c.url.includes("/invoices"),
    );
    expect(invCall).toBeDefined();
    const body = JSON.parse(invCall!.body);
    expect(body.lines[0].income_category).toBe("misc_rents");
    expect(body.lines[0].income_category_label).toBe(
      "Rent – 1099-MISC Box 1",
    );
    expect(body.lines[1].income_category).toBeNull();
    expect(body.lines[1].income_category_label).toBeNull();
  });

  it("income_category round-trips: a fixture OA tenant that stores POST bodies returns the same income_category on a subsequent GET", async () => {
    // Simulates a real OA tenant by recording the POSTed invoice body
    // and serving it back on /invoices?invoice_numbers=. The test
    // proves that the structured 1099 keys we send on the way in are
    // the same ones a later read sees — i.e. OA didn't silently strip
    // them. This is the contract `pushBundleToOa` relies on so the
    // post-push reconciler (and OA's own Vendor 1099 report) see the
    // same totals as VNDRLY.
    const stored = new Map<
      string,
      {
        invoice_number: string;
        total: number;
        tax_total: number;
        lines: Array<{
          description: string;
          income_category: string | null;
          income_category_label: string | null;
        }>;
      }
    >();
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.includes("/customers")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (method === "GET" && url.includes("/vendors")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (method === "POST" && url.endsWith("/invoices")) {
          const body = JSON.parse(String(init?.body ?? "")) as {
            invoice_number: string;
            total: number;
            tax_total: number;
            lines: Array<{
              description: string;
              income_category: string | null;
              income_category_label: string | null;
            }>;
          };
          stored.set(body.invoice_number, body);
          return new Response(
            JSON.stringify({ id: `oa-${body.invoice_number}` }),
            { status: 200 },
          );
        }
        if (method === "POST") {
          return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
        }
        if (method === "GET" && url.includes("/invoices?")) {
          const u = new URL(url);
          const requested = (u.searchParams.get("invoice_numbers") ?? "")
            .split(",")
            .filter(Boolean);
          const invoices = requested
            .map((n) => stored.get(n))
            .filter((v): v is NonNullable<typeof v> => v !== undefined);
          return new Response(JSON.stringify({ invoices }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    );

    const r = await pushBundleToOa(
      {
        invoices: [
          {
            invoiceNumber: "INV-RT",
            invoiceDate: new Date("2026-04-01T00:00:00Z"),
            dueDate: null,
            total: "200.00",
            subtotal: "200.00",
            taxTotal: "0.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
        ],
        lines: [
          {
            invoiceNumber: "INV-RT",
            description: "Excavator rental",
            amount: "200.00",
            taxAmount: "0.00",
            lineType: "Rental",
            incomeCategory: "misc_rents",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [
          { name: "Sub", email: null, address: null, federalTaxId: null },
        ],
      },
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(r.invoicesCreated).toBe(1);
    expect(r.warnings).toEqual([]);

    // Read it back the way the reconciler would, using the same fake
    // fetch that backs the simulated tenant.
    const res = await fetchImpl(
      `${TEST_HOST}/invoices?invoice_numbers=INV-RT`,
      { method: "GET" },
    );
    const json = (await res.json()) as {
      invoices: Array<{
        lines: Array<{
          income_category: string | null;
          income_category_label: string | null;
        }>;
      }>;
    };
    expect(json.invoices).toHaveLength(1);
    expect(json.invoices[0].lines[0].income_category).toBe("misc_rents");
    expect(json.invoices[0].lines[0].income_category_label).toBe(
      "Rent – 1099-MISC Box 1",
    );
  });

  it("falls back to a [1099: <label>] description tag when OA rejects the income_category fields, and surfaces a single warning", async () => {
    // Models an OA tenant that hasn't enabled the structured 1099 keys
    // yet — the API replies 400 with an error message naming the
    // unknown field. The push must succeed (no row dropped), the
    // retry payload must use the QBO-style description suffix, and
    // exactly one operator-facing warning should be raised so the
    // operator knows 1099 totals will need manual entry.
    const calls: { url: string; method: string; body: string }[] = [];
    let invoicePostCount = 0;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        const body = String(init?.body ?? "");
        calls.push({ url, method, body });
        if (method === "GET" && url.includes("/customers")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (method === "GET" && url.includes("/vendors")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (method === "POST" && url.endsWith("/invoices")) {
          invoicePostCount += 1;
          const parsed = JSON.parse(body) as {
            lines: Array<{ income_category?: string | null }>;
          };
          if (parsed.lines.some((l) => "income_category" in l)) {
            return new Response(
              JSON.stringify({
                error: "Unknown field 'income_category' in line item",
              }),
              { status: 400 },
            );
          }
          return new Response(JSON.stringify({ id: "oa-1" }), { status: 200 });
        }
        if (method === "POST") {
          return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    );
    const r = await pushBundleToOa(
      {
        invoices: [
          {
            invoiceNumber: "INV-FB-1",
            invoiceDate: new Date("2026-04-01T00:00:00Z"),
            dueDate: null,
            total: "100.00",
            subtotal: "100.00",
            taxTotal: "0.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
          {
            invoiceNumber: "INV-FB-2",
            invoiceDate: new Date("2026-04-02T00:00:00Z"),
            dueDate: null,
            total: "50.00",
            subtotal: "50.00",
            taxTotal: "0.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
        ],
        lines: [
          {
            invoiceNumber: "INV-FB-1",
            description: "Excavator rental",
            amount: "100.00",
            taxAmount: "0.00",
            lineType: "Rental",
            incomeCategory: "misc_rents",
          },
          {
            invoiceNumber: "INV-FB-2",
            description: "Attorney fee",
            amount: "50.00",
            taxAmount: "0.00",
            lineType: "Service",
            incomeCategory: "misc_attorney",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [
          { name: "Sub", email: null, address: null, federalTaxId: null },
        ],
      },
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(r.invoicesCreated).toBe(2);
    // Three POST /invoices: 1) rejected with cat keys, 2) retry without,
    // 3) the second invoice goes straight in without cat keys (sticky
    // capability flag).
    expect(invoicePostCount).toBe(3);
    const invCalls = calls.filter(
      (c) => c.method === "POST" && c.url.endsWith("/invoices"),
    );
    const retryBody = JSON.parse(invCalls[1].body) as {
      lines: Array<{ description: string; income_category?: unknown }>;
    };
    expect(retryBody.lines[0]).not.toHaveProperty("income_category");
    expect(retryBody.lines[0].description).toBe(
      "Excavator rental [1099: Rent – 1099-MISC Box 1]",
    );
    const secondBody = JSON.parse(invCalls[2].body) as {
      lines: Array<{ description: string; income_category?: unknown }>;
    };
    expect(secondBody.lines[0]).not.toHaveProperty("income_category");
    expect(secondBody.lines[0].description).toBe(
      "Attorney fee [1099: Attorney fees – 1099-MISC Box 10]",
    );
    // Exactly one operator-facing warning, namespaced so it doesn't
    // collide with per-invoice warnings.
    const fallbackWarnings = r.warnings.filter(
      (w) => w.identifier === "(1099 categories)",
    );
    expect(fallbackWarnings).toHaveLength(1);
    expect(fallbackWarnings[0].message).toMatch(/falling back/);
  });

  it("reuses existing OA customers/vendors instead of POSTing duplicates", async () => {
    const { fetchImpl, calls } = buildFakeOaFetch({
      existingCustomers: { Acme: "cust-1" },
      existingVendors: { Sub: "vend-1" },
    });
    const result = await pushBundleToOa(SAMPLE_BUNDLE, {
      apiKey: "K",
      baseUrl: TEST_HOST,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.customersAlreadyExisted).toBe(1);
    expect(result.customersCreated).toBe(0);
    expect(result.vendorsAlreadyExisted).toBe(1);
    expect(result.vendorsCreated).toBe(0);
    expect(result.invoicesCreated).toBe(1);
    // No customer/vendor POSTs.
    expect(
      calls.some((c) => c.method === "POST" && c.url.includes("/customers")),
    ).toBe(false);
    expect(
      calls.some((c) => c.method === "POST" && c.url.includes("/vendors")),
    ).toBe(false);
  });

  it("skips invoices already recorded in the pushed-invoice store", async () => {
    const { fetchImpl, calls } = buildFakeOaFetch({
      existingCustomers: { Acme: "cust-1" },
      existingVendors: { Sub: "vend-1" },
    });
    const store = inMemoryPushedInvoiceStore(["INV-2"]);
    const result = await pushBundleToOa(SAMPLE_BUNDLE, {
      apiKey: "K",
      baseUrl: TEST_HOST,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pushedInvoiceStore: store,
    });
    expect(result.invoicesCreated).toBe(0);
    expect(result.invoicesAlreadyUpToDate).toBe(1);
    expect(
      calls.some((c) => c.method === "POST" && c.url.includes("/invoices")),
    ).toBe(false);
  });

  it("records invoices in the store after a successful POST", async () => {
    const { fetchImpl } = buildFakeOaFetch();
    const store = inMemoryPushedInvoiceStore();
    await pushBundleToOa(SAMPLE_BUNDLE, {
      apiKey: "K",
      baseUrl: TEST_HOST,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pushedInvoiceStore: store,
    });
    expect(store.has("INV-2")).toBe(true);
  });

  it("collects warnings on POST HTTP errors instead of throwing", async () => {
    const { fetchImpl } = buildFakeOaFetch({ postFails: true });
    const r = await pushBundleToOa(
      {
        invoices: [],
        lines: [],
        partners: [{ name: "X", email: null, address: null }],
        vendors: [],
      },
      {
        apiKey: "k",
        baseUrl: TEST_HOST,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(r.customersCreated).toBe(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].kind).toBe("customer");
    expect(r.warnings[0].identifier).toBe("X");
    expect(r.warnings[0].message).toContain("OpenAccountant API 500");
  });

  it("refuses to push to a disallowed base URL (defense in depth)", async () => {
    const fakeFetch = vi.fn(async () => new Response("ok"));
    await expect(
      pushBundleToOa(
        { invoices: [], lines: [], partners: [], vendors: [] },
        {
          apiKey: "k",
          baseUrl: "http://localhost:8080/v1",
          fetchImpl: fakeFetch as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow(/OA base URL/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

// ── OAuth helpers ───────────────────────────────────────────────

const OAUTH_ENV_KEYS = [
  "OPENACCOUNTANT_CLIENT_ID",
  "OPENACCOUNTANT_CLIENT_SECRET",
  "OPENACCOUNTANT_REDIRECT_URI",
  "OPENACCOUNTANT_OAUTH_BASE_URL",
  "OPENACCOUNTANT_OAUTH_SCOPE",
] as const;

function setOaOAuthEnv(overrides?: Partial<Record<(typeof OAUTH_ENV_KEYS)[number], string>>) {
  process.env.OPENACCOUNTANT_CLIENT_ID = "oa-client-id";
  process.env.OPENACCOUNTANT_CLIENT_SECRET = "oa-client-secret";
  process.env.OPENACCOUNTANT_REDIRECT_URI =
    "https://example.test/api/accounting/oa/callback";
  delete process.env.OPENACCOUNTANT_OAUTH_BASE_URL;
  delete process.env.OPENACCOUNTANT_OAUTH_SCOPE;
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      process.env[k] = v;
    }
  }
}

describe("loadOaOAuthConfig + oaAuthorizationUrl", () => {
  const previous: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of OAUTH_ENV_KEYS) previous[k] = process.env[k];
    setOaOAuthEnv();
  });
  afterEach(() => {
    for (const k of OAUTH_ENV_KEYS) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k]!;
    }
  });

  it("defaults the base URL and scope", () => {
    const cfg = loadOaOAuthConfig();
    expect(cfg.authBaseUrl).toBe("https://accounts.openaccountant.com");
    expect(cfg.scope).toBe("accounting.write");
  });

  it("trims trailing slashes on a custom base URL", () => {
    setOaOAuthEnv({
      OPENACCOUNTANT_OAUTH_BASE_URL: "https://accounts.eu.openaccountant.com//",
    });
    expect(loadOaOAuthConfig().authBaseUrl).toBe(
      "https://accounts.eu.openaccountant.com",
    );
  });

  it("includes scope, redirect_uri, and state in the authorize URL", () => {
    const url = new URL(oaAuthorizationUrl("abc.123"));
    expect(url.host).toBe("accounts.openaccountant.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("oa-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://example.test/api/accounting/oa/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("accounting.write");
    expect(url.searchParams.get("state")).toBe("abc.123");
  });

  it("throws when not configured", () => {
    delete process.env.OPENACCOUNTANT_CLIENT_ID;
    expect(() => oaAuthorizationUrl("x")).toThrow(/not configured/);
  });
});

describe("oaExchangeCodeForTokens + oaRefreshAccessToken", () => {
  const previous: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of OAUTH_ENV_KEYS) previous[k] = process.env[k];
    setOaOAuthEnv();
  });
  afterEach(() => {
    for (const k of OAUTH_ENV_KEYS) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k]!;
    }
  });

  it("posts the authorization-code grant with HTTP Basic auth", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fakeFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: typeof input === "string" ? input : input.toString(),
          init,
        });
        return new Response(
          JSON.stringify({
            access_token: "acc-1",
            refresh_token: "ref-1",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "accounting.write",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const tokens = await oaExchangeCodeForTokens(
      "the-code",
      fakeFetch as unknown as typeof fetch,
    );
    expect(tokens).toEqual({
      accessToken: "acc-1",
      refreshToken: "ref-1",
      expiresInSec: 3600,
      tokenType: "Bearer",
      scope: "accounting.write",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://accounts.openaccountant.com/oauth/token",
    );
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers["Authorization"]).toBe(
      "Basic " +
        Buffer.from("oa-client-id:oa-client-secret").toString("base64"),
    );
    expect(headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(String(calls[0].init?.body ?? ""));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("redirect_uri")).toBe(
      "https://example.test/api/accounting/oa/callback",
    );
  });

  it("uses the refresh_token grant when refreshing", async () => {
    const fakeFetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const form = new URLSearchParams(String(init?.body ?? ""));
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("refresh_token")).toBe("ref-old");
        return new Response(
          JSON.stringify({
            access_token: "acc-2",
            // OA may omit refresh_token if it isn't rotating it.
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const tokens = await oaRefreshAccessToken(
      "ref-old",
      fakeFetch as unknown as typeof fetch,
    );
    expect(tokens.accessToken).toBe("acc-2");
    expect(tokens.refreshToken).toBeNull();
  });

  it("surfaces non-200 token endpoint responses", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response("invalid_grant", { status: 400 }),
    );
    await expect(
      oaExchangeCodeForTokens("bad", fakeFetch as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 400/);
  });
});

describe("reconcileOaInvoices", () => {
  /** Build a fake fetch that returns the supplied invoices, filtered by
   *  the `invoice_numbers` query param so batched queries return only
   *  the matching subset (mirrors how OA actually behaves). */
  function makeQueryFetch(invoices: Array<{
    invoice_number: string;
    total: number;
    tax_total: number;
  }>) {
    const calls: { url: string }[] = [];
    const fn = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url });
      const parsed = new URL(url);
      const requested = (parsed.searchParams.get("invoice_numbers") ?? "")
        .split(",")
        .filter(Boolean);
      const matching = invoices.filter((i) =>
        requested.includes(i.invoice_number),
      );
      return new Response(JSON.stringify({ invoices: matching }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    return { fn, calls };
  }

  it("returns no warnings when OA totals + tax match exactly", async () => {
    const { fn, calls } = makeQueryFetch([
      { invoice_number: "INV-1", total: 150, tax_total: 10 },
      { invoice_number: "INV-2", total: 220, tax_total: 20 },
    ]);
    const warnings = await reconcileOaInvoices(
      [
        {
          invoiceNumber: "INV-1",
          expectedTotal: 150,
          expectedTax: 10,
          expectedTaxByState: { CA: 10 },
        },
        {
          invoiceNumber: "INV-2",
          expectedTotal: 220,
          expectedTax: 20,
          expectedTaxByState: { TX: 20 },
        },
      ],
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fn as unknown as typeof fetch,
        expectedTaxByState: { CA: 10, TX: 20 },
      },
    );
    expect(warnings).toEqual([]);
    // Sanity-check we sent a Bearer GET against /invoices with the
    // expected query param.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`${TEST_HOST}/invoices?`);
    expect(calls[0].url).toContain("invoice_numbers=");
  });

  it("warns on per-invoice total + tax mismatches", async () => {
    // OA stored $151 / $11 instead of our $150 / $10 — silent drift.
    const { fn } = makeQueryFetch([
      { invoice_number: "INV-1", total: 151, tax_total: 11 },
    ]);
    const warnings = await reconcileOaInvoices(
      [
        {
          invoiceNumber: "INV-1",
          expectedTotal: 150,
          expectedTax: 10,
          expectedTaxByState: { CA: 10 },
        },
      ],
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fn as unknown as typeof fetch,
      },
    );
    expect(warnings.length).toBe(2);
    expect(warnings[0].identifier).toBe("INV-1");
    expect(warnings[0].message).toMatch(
      /OpenAccountant total 151\.00.*posted total 150\.00/,
    );
    expect(warnings[1].identifier).toBe("INV-1");
    expect(warnings[1].message).toMatch(
      /OpenAccountant tax 11\.00.*posted tax 10\.00/,
    );
  });

  it("warns when an expected invoice is missing from OA", async () => {
    const { fn } = makeQueryFetch([
      { invoice_number: "INV-1", total: 100, tax_total: 0 },
    ]);
    const warnings = await reconcileOaInvoices(
      [
        { invoiceNumber: "INV-1", expectedTotal: 100, expectedTax: 0 },
        { invoiceNumber: "INV-MISSING", expectedTotal: 50, expectedTax: 0 },
      ],
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fn as unknown as typeof fetch,
      },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].identifier).toBe("INV-MISSING");
    expect(warnings[0].message).toMatch(/could not be found in OpenAccountant/);
  });

  it("warns on aggregate per-state mismatch against the report", async () => {
    // Per-invoice numbers match OA, but the caller's expectedTaxByState
    // (i.e. VNDRLY's Sales-Tax-by-State report total) disagrees with
    // what we apportioned from the invoices — this is the "report drift"
    // signal.
    const { fn } = makeQueryFetch([
      { invoice_number: "INV-1", total: 110, tax_total: 10 },
    ]);
    const warnings = await reconcileOaInvoices(
      [
        {
          invoiceNumber: "INV-1",
          expectedTotal: 110,
          expectedTax: 10,
          expectedTaxByState: { CA: 10 },
        },
      ],
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fn as unknown as typeof fetch,
        // Report says CA collected $12 — drift!
        expectedTaxByState: { CA: 12 },
      },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].identifier).toBe("(state:CA)");
    expect(warnings[0].message).toMatch(
      /CA totals 10\.00.*report shows 12\.00/,
    );
  });

  it("apportions invoice tax across states by VNDRLY's per-state ratio", async () => {
    // One invoice with $30 total tax split CA=$20 / TX=$10 by VNDRLY,
    // and OA returns the same $30 — per-state aggregate should match
    // the report exactly because we apportion by ratio.
    const { fn } = makeQueryFetch([
      { invoice_number: "INV-1", total: 330, tax_total: 30 },
    ]);
    const warnings = await reconcileOaInvoices(
      [
        {
          invoiceNumber: "INV-1",
          expectedTotal: 330,
          expectedTax: 30,
          expectedTaxByState: { CA: 20, TX: 10 },
        },
      ],
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fn as unknown as typeof fetch,
        expectedTaxByState: { CA: 20, TX: 10 },
      },
    );
    expect(warnings).toEqual([]);
  });

  it("is fail-soft when the OA query itself errors", async () => {
    const fn = vi.fn(async () =>
      new Response("server boom", { status: 500 }),
    );
    const warnings = await reconcileOaInvoices(
      [{ invoiceNumber: "INV-1", expectedTotal: 100, expectedTax: 0 }],
      {
        apiKey: "K",
        baseUrl: TEST_HOST,
        fetchImpl: fn as unknown as typeof fetch,
      },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].identifier).toBe("(reconciliation)");
    expect(warnings[0].message).toMatch(/could not read invoices back/);
  });

  it("returns no warnings for an empty expectations list (skips OA call)", async () => {
    const fn = vi.fn();
    const warnings = await reconcileOaInvoices([], {
      apiKey: "K",
      baseUrl: TEST_HOST,
      fetchImpl: fn as unknown as typeof fetch,
    });
    expect(warnings).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("refuses to reconcile against a disallowed base URL (defense in depth)", async () => {
    const fn = vi.fn();
    await expect(
      reconcileOaInvoices(
        [{ invoiceNumber: "INV-1", expectedTotal: 100, expectedTax: 0 }],
        {
          apiKey: "K",
          baseUrl: "http://localhost:8080/v1",
          fetchImpl: fn as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow(/OA base URL/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("updateOaInvoice", () => {
  // Single-invoice bundle reused across the update tests below.
  const ONE_INV_BUNDLE = SAMPLE_BUNDLE;

  it("PUTs the invoice body to /invoices/{id} and returns the new doc number", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const fakeFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ url, method, body: String(init?.body ?? "") });
        if (method === "PUT") {
          return new Response(
            JSON.stringify({ id: "remote-1", invoice_number: "INV-2" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    );
    const r = await updateOaInvoice({
      apiKey: "K",
      baseUrl: TEST_HOST,
      externalInvoiceId: "remote-1",
      bundle: ONE_INV_BUNDLE,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(r.status).toBe("updated");
    if (r.status === "updated") {
      expect(r.externalInvoiceId).toBe("remote-1");
      expect(r.externalDocNumber).toBe("INV-2");
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(new URL(calls[0].url).pathname).toBe("/v1/invoices/remote-1");
    const body = JSON.parse(calls[0].body);
    expect(body.invoice_number).toBe("INV-2");
    expect(body.lines[0].amount).toBe(50);
  });

  it('returns {status: "missing"} when OA returns HTTP 404', async () => {
    const fakeFetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        return new Response("not found", { status: 404 });
      },
    );
    const r = await updateOaInvoice({
      apiKey: "K",
      baseUrl: TEST_HOST,
      externalInvoiceId: "missing-id",
      bundle: ONE_INV_BUNDLE,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(r.status).toBe("missing");
    if (r.status === "missing") {
      expect(r.message).toMatch(/no longer exists/);
    }
  });

  it("throws on non-404 server errors", async () => {
    const fakeFetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        return new Response("kaboom", { status: 500 });
      },
    );
    await expect(
      updateOaInvoice({
        apiKey: "K",
        baseUrl: TEST_HOST,
        externalInvoiceId: "x",
        bundle: ONE_INV_BUNDLE,
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/OpenAccountant API 500/);
  });
});
