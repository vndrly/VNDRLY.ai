import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizationUrl,
  ensureQboItemMap,
  pushBundleToQbo,
  reconcileQboInvoices,
  updateQboInvoice,
} from "./qbo";
import type { QbAccount } from "../reports/qb-mapping";
import { inMemoryPushedInvoiceStore } from "./pushedInvoices";

const ENV_KEYS = [
  "INTUIT_CLIENT_ID",
  "INTUIT_CLIENT_SECRET",
  "INTUIT_REDIRECT_URI",
  "INTUIT_ENVIRONMENT",
] as const;

function setQboEnv(env?: string) {
  process.env.INTUIT_CLIENT_ID = "test-client-id";
  process.env.INTUIT_CLIENT_SECRET = "test-client-secret";
  process.env.INTUIT_REDIRECT_URI =
    "https://example.test/api/accounting/qbo/callback";
  if (env) process.env.INTUIT_ENVIRONMENT = env;
  else delete process.env.INTUIT_ENVIRONMENT;
}

describe("qbo authorizationUrl", () => {
  const previous: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) previous[k] = process.env[k];
    setQboEnv();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k]!;
    }
  });

  it("includes scope, redirect_uri, and state", () => {
    const url = new URL(authorizationUrl("abc.123"));
    expect(url.host).toContain("intuit.com");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("scope")).toBe(
      "com.intuit.quickbooks.accounting",
    );
    expect(url.searchParams.get("state")).toBe("abc.123");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("throws when not configured", () => {
    delete process.env.INTUIT_CLIENT_ID;
    expect(() => authorizationUrl("x")).toThrow(/not configured/);
  });
});

const SAMPLE_BUNDLE = {
  invoices: [
    {
      invoiceNumber: "INV-1",
      invoiceDate: new Date("2026-01-15T00:00:00Z"),
      dueDate: new Date("2026-02-14T00:00:00Z"),
      total: "150.00",
      subtotal: "140.00",
      taxTotal: "10.00",
      memo: "Jan work",
      partnerName: "Acme",
      vendorName: "Sub",
    },
  ],
  lines: [
    {
      invoiceNumber: "INV-1",
      description: "Pump rental",
      amount: "140.00",
      taxAmount: "10.00",
      lineType: "Rental",
    },
  ],
  partners: [{ name: "Acme", email: "a@x.test", address: "1 Main St" }],
  vendors: [
    {
      name: "Sub",
      email: null,
      address: null,
      federalTaxId: "12-3456789",
    },
  ],
};

describe("pushBundleToQbo", () => {
  // makeFetch is the older test helper used by the tax-preferences tests.
  // It mirrors fetch's signature but lets the test assert on every call.
  // The handler is responsible for returning Responses for the URLs it
  // expects; anything unexpected gets 404, so tests fail fast.
  //
  // We always route GET /query to an empty QueryResponse so the dedupe
  // lookup-first behavior in pushBundleToQbo doesn't error and the tests
  // can continue to focus on the customer/vendor/invoice POSTs.
  function makeFetch(
    handler: (
      url: string,
      init: RequestInit | undefined,
    ) => Response | Promise<Response> | null,
  ) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fn = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, init });
        if (url.includes("/query")) {
          return new Response(JSON.stringify({ QueryResponse: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const r = await handler(url, init);
        if (r) return r;
        return new Response("not found", { status: 404 });
      },
    );
    return { fn, calls };
  }

  // buildFakeQboFetch is the dedupe-aware helper. It routes GET /query
  // to canned existing-customer / existing-vendor tables and POST
  // /customer|/vendor|/invoice to canned create responses or fault
  // payloads. Use this when the test exercises the lookup-first +
  // pushed-invoice-store dedupe behavior.
  function buildFakeQboFetch(opts: {
    existingCustomers?: Record<string, string>;
    existingVendors?: Record<string, string>;
    customerCreate?: { Id: string; DisplayName: string };
    vendorCreate?: { Id: string; DisplayName: string };
    invoiceCreate?: { Id: string; DocNumber: string };
    invoicePostFault?: { Message: string; Detail?: string };
    customerPostFault?: { Message: string; Detail?: string };
  }) {
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ url, method, body: String(init?.body ?? "") });
        if (url.includes("/query")) {
          const decoded = decodeURIComponent(url);
          const m = /WHERE DisplayName = '((?:[^'\\]|\\.)*)'/i.exec(decoded);
          const name = m ? m[1].replace(/\\(.)/g, "$1") : "";
          if (decoded.includes("FROM Customer")) {
            const id = opts.existingCustomers?.[name];
            return new Response(
              JSON.stringify(
                id
                  ? { QueryResponse: { Customer: [{ Id: id, DisplayName: name }] } }
                  : { QueryResponse: {} },
              ),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          if (decoded.includes("FROM Vendor")) {
            const id = opts.existingVendors?.[name];
            return new Response(
              JSON.stringify(
                id
                  ? { QueryResponse: { Vendor: [{ Id: id, DisplayName: name }] } }
                  : { QueryResponse: {} },
              ),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
        }
        if (url.includes("/customer") && method === "POST") {
          if (opts.customerPostFault) {
            return new Response(
              JSON.stringify({ Fault: { Error: [opts.customerPostFault] } }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              Customer: opts.customerCreate ?? { Id: "1", DisplayName: "Acme" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/vendor") && method === "POST") {
          return new Response(
            JSON.stringify({
              Vendor: opts.vendorCreate ?? { Id: "2", DisplayName: "Sub" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/invoice") && method === "POST") {
          if (opts.invoicePostFault) {
            return new Response(
              JSON.stringify({ Fault: { Error: [opts.invoicePostFault] } }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              Invoice: opts.invoiceCreate ?? { Id: "9", DocNumber: "INV-1" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    );
    return { fetchImpl, calls };
  }

  it("calls customer / vendor / invoice endpoints with bearer token and posts tax via TxnTaxDetail", async () => {
    const { fn: fakeFetch, calls } = makeFetch((url) => {
      if (url.includes("/customer")) {
        return new Response(
          JSON.stringify({ Customer: { Id: "1", DisplayName: "Acme" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/vendor")) {
        return new Response(
          JSON.stringify({ Vendor: { Id: "2", DisplayName: "Sub" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/preferences")) {
        return new Response(
          JSON.stringify({
            Preferences: {
              TaxPrefs: {
                UsingSalesTax: true,
                PartnerTaxEnabled: true,
                TaxGroupCodeRef: { value: "5" },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/invoice")) {
        return new Response(
          JSON.stringify({ Invoice: { Id: "9", DocNumber: "INV-1" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return null;
    });

    const result = await pushBundleToQbo(SAMPLE_BUNDLE, {
      accessToken: "ACC123",
      realmId: "9876",
      environment: "sandbox",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    expect(result.customersCreated).toBe(1);
    expect(result.vendorsCreated).toBe(1);
    expect(result.invoicesCreated).toBe(1);
    expect(result.warnings).toEqual([]);

    // We must have queried preferences before posting the invoice.
    expect(calls.some((c) => c.url.includes("/preferences"))).toBe(true);

    // Sanity: customer POST hit sandbox URL with Bearer token.
    const cust = calls.find((c) => c.url.includes("/customer") && c.init);
    expect(cust).toBeDefined();
    expect(cust!.url).toContain("sandbox-quickbooks.api.intuit.com");
    expect(cust!.url).toContain("/v3/company/9876/customer");

    // Invoice body uses the QBO Line shape, TxnDate, and excludes tax
    // from the line Amount (the bug fix).
    const inv = calls.find((c) => c.url.includes("/invoice"));
    const body = JSON.parse(String(inv!.init!.body));
    expect(body.DocNumber).toBe("INV-1");
    expect(body.TxnDate).toBe("2026-01-15");
    expect(body.DueDate).toBe("2026-02-14");
    expect(body.CustomerRef.value).toBe("1");
    expect(Array.isArray(body.Line)).toBe(true);
    expect(body.Line[0].DetailType).toBe("SalesItemLineDetail");
    expect(body.Line[0].Amount).toBe(140);
    expect(body.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: "5" });
    // Tax is sent through TxnTaxDetail rather than baked into Amount.
    expect(body.GlobalTaxCalculation).toBe("TaxExcluded");
    expect(body.TxnTaxDetail).toEqual({
      TxnTaxCodeRef: { value: "5" },
      TotalTax: 10,
    });
  });

  it("warns instead of folding tax into income when sales tax is disabled in QBO", async () => {
    const { fn: fakeFetch, calls } = makeFetch((url) => {
      if (url.includes("/customer")) {
        return new Response(
          JSON.stringify({ Customer: { Id: "1", DisplayName: "Acme" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/preferences")) {
        return new Response(
          JSON.stringify({
            Preferences: { TaxPrefs: { UsingSalesTax: false } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/invoice")) {
        return new Response(
          JSON.stringify({ Invoice: { Id: "9", DocNumber: "INV-2" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return null;
    });

    const result = await pushBundleToQbo(
      {
        invoices: [
          {
            invoiceNumber: "INV-2",
            invoiceDate: new Date("2026-01-15T00:00:00Z"),
            dueDate: null,
            total: "150.00",
            subtotal: "140.00",
            taxTotal: "10.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
        ],
        lines: [
          {
            invoiceNumber: "INV-2",
            description: "Pump rental",
            amount: "140.00",
            taxAmount: "10.00",
            lineType: "Rental",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [],
      },
      {
        accessToken: "ACC",
        realmId: "1",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );

    expect(result.invoicesCreated).toBe(1);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].kind).toBe("invoice");
    expect(result.warnings[0].identifier).toBe("INV-2");
    expect(result.warnings[0].message).toMatch(/sales tax is disabled/i);

    const inv = calls.find((c) => c.url.includes("/invoice"));
    const body = JSON.parse(String(inv!.init!.body));
    // Line amount is the pre-tax amount — tax is NOT folded in.
    expect(body.Line[0].Amount).toBe(140);
    expect(body.TxnTaxDetail).toBeUndefined();
    expect(body.GlobalTaxCalculation).toBeUndefined();
    // No TaxCodeRef when we can't post tax.
    expect(body.Line[0].SalesItemLineDetail.TaxCodeRef).toBeUndefined();
  });

  it("skips the preferences call entirely when no invoice has tax", async () => {
    const { fn: fakeFetch, calls } = makeFetch((url) => {
      if (url.includes("/customer")) {
        return new Response(
          JSON.stringify({ Customer: { Id: "1", DisplayName: "Acme" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/invoice")) {
        return new Response(
          JSON.stringify({ Invoice: { Id: "9", DocNumber: "INV-3" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return null;
    });

    const result = await pushBundleToQbo(
      {
        invoices: [
          {
            invoiceNumber: "INV-3",
            invoiceDate: new Date("2026-01-15T00:00:00Z"),
            dueDate: null,
            total: "100.00",
            subtotal: "100.00",
            taxTotal: "0.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
        ],
        lines: [
          {
            invoiceNumber: "INV-3",
            description: "Labor",
            amount: "100.00",
            taxAmount: "0.00",
            lineType: "labor_regular",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [],
      },
      {
        accessToken: "ACC",
        realmId: "1",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );

    expect(result.invoicesCreated).toBe(1);
    expect(result.invoicesPushed).toEqual(["INV-3"]);
    expect(result.warnings).toEqual([]);
    expect(calls.some((c) => c.url.includes("/preferences"))).toBe(false);
    const inv = calls.find((c) => c.url.includes("/invoice"));
    const body = JSON.parse(String(inv!.init!.body));
    expect(body.Line[0].Amount).toBe(100);
    expect(body.TxnTaxDetail).toBeUndefined();
  });

  it("uses the resolved itemMap value for each invoice line's ItemRef", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fakeFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, init });
        if (url.includes("/query")) {
          return new Response(JSON.stringify({ QueryResponse: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/customer")) {
          return new Response(
            JSON.stringify({ Customer: { Id: "1", DisplayName: "Acme" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/invoice")) {
          return new Response(
            JSON.stringify({ Invoice: { Id: "9", DocNumber: "INV-1" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    );

    await pushBundleToQbo(
      {
        invoices: [
          {
            invoiceNumber: "INV-1",
            invoiceDate: new Date("2026-01-15T00:00:00Z"),
            dueDate: null,
            total: "100.00",
            subtotal: "100.00",
            taxTotal: "0.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
        ],
        lines: [
          {
            invoiceNumber: "INV-1",
            description: "Hours",
            amount: "60.00",
            taxAmount: "0.00",
            lineType: "labor_regular",
          },
          {
            invoiceNumber: "INV-1",
            description: "Reimbursable",
            amount: "40.00",
            taxAmount: "0.00",
            lineType: "unknown_type",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [],
      },
      {
        accessToken: "ACC123",
        realmId: "9876",
        environment: "sandbox",
        fetchImpl: fakeFetch as unknown as typeof fetch,
        itemMap: { labor_regular: "42" },
        defaultItemId: "99",
      },
    );

    const inv = calls.find((c) => c.url.includes("/invoice"));
    const body = JSON.parse(String(inv!.init!.body));
    // Known line type → real Item Id from the map.
    expect(body.Line[0].SalesItemLineDetail.ItemRef.value).toBe("42");
    // Unknown line type → defaultItemId is used (not the legacy "1"
    // placeholder).
    expect(body.Line[1].SalesItemLineDetail.ItemRef.value).toBe("99");
  });

  it("reports invoice as pushed even when it carries a tax-not-posted warning", async () => {
    // Sales tax is disabled in QBO so we can't post the $10 tax block,
    // but the invoice is still created (with a warning) for the
    // pre-tax line amount. The reconciler downstream needs to know the
    // invoice exists in QBO so it can read it back — this test pins
    // that expectation by asserting `invoicesPushed` includes it.
    const fakeFetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/query")) {
        return new Response(JSON.stringify({ QueryResponse: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/customer")) {
        return new Response(
          JSON.stringify({ Customer: { Id: "1", DisplayName: "Acme" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/preferences")) {
        return new Response(
          JSON.stringify({
            Preferences: { TaxPrefs: { UsingSalesTax: false } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/invoice")) {
        return new Response(
          JSON.stringify({ Invoice: { Id: "9", DocNumber: "INV-WT" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });
    const result = await pushBundleToQbo(
      {
        invoices: [
          {
            invoiceNumber: "INV-WT",
            invoiceDate: new Date("2026-01-15T00:00:00Z"),
            dueDate: null,
            total: "150.00",
            subtotal: "140.00",
            taxTotal: "10.00",
            memo: null,
            partnerName: "Acme",
            vendorName: "Sub",
          },
        ],
        lines: [
          {
            invoiceNumber: "INV-WT",
            description: "Pump rental",
            amount: "140.00",
            taxAmount: "10.00",
            lineType: "Rental",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [],
      },
      {
        accessToken: "ACC",
        realmId: "1",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );
    expect(result.invoicesCreated).toBe(1);
    expect(result.invoicesPushed).toEqual(["INV-WT"]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].message).toMatch(/sales tax is disabled/i);
  });

  it("queries QBO first, then POSTs new entities and the invoice", async () => {
    const { fetchImpl, calls } = buildFakeQboFetch({});
    const result = await pushBundleToQbo(SAMPLE_BUNDLE, {
      accessToken: "ACC123",
      realmId: "9876",
      environment: "sandbox",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.customersCreated).toBe(1);
    expect(result.vendorsCreated).toBe(1);
    expect(result.invoicesCreated).toBe(1);
    expect(result.customersAlreadyExisted).toBe(0);
    expect(result.vendorsAlreadyExisted).toBe(0);
    expect(result.invoicesAlreadyUpToDate).toBe(0);

    // We did query first.
    const queries = calls.filter((c) => c.url.includes("/query"));
    expect(queries.length).toBe(2);
    expect(queries.every((c) => c.method === "GET")).toBe(true);

    // Sanity: customer POST hit sandbox URL with Bearer token.
    const cust = calls.find(
      (c) => c.url.includes("/customer") && c.method === "POST",
    );
    expect(cust).toBeDefined();
    expect(cust!.url).toContain("sandbox-quickbooks.api.intuit.com");
    expect(cust!.url).toContain("/v3/company/9876/customer");

    // Invoice body uses the QBO Line shape and TxnDate.
    const inv = calls.find(
      (c) => c.url.includes("/invoice") && c.method === "POST",
    );
    const body = JSON.parse(inv!.body);
    expect(body.DocNumber).toBe("INV-1");
    expect(body.TxnDate).toBe("2026-01-15");
    expect(body.DueDate).toBe("2026-02-14");
    expect(body.CustomerRef.value).toBe("1");
    expect(Array.isArray(body.Line)).toBe(true);
  });

  it("reuses existing QBO customers/vendors instead of POSTing duplicates", async () => {
    // This is the scenario from the bug report: a second sync against
    // the same period must NOT skip every invoice just because the
    // customer already exists in QBO.
    const { fetchImpl, calls } = buildFakeQboFetch({
      existingCustomers: { Acme: "55" },
      existingVendors: { Sub: "77" },
      invoiceCreate: { Id: "9", DocNumber: "INV-1" },
    });
    const result = await pushBundleToQbo(SAMPLE_BUNDLE, {
      accessToken: "ACC",
      realmId: "1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.customersCreated).toBe(0);
    expect(result.customersAlreadyExisted).toBe(1);
    expect(result.vendorsCreated).toBe(0);
    expect(result.vendorsAlreadyExisted).toBe(1);
    expect(result.invoicesCreated).toBe(1);

    // We never POSTed to /customer or /vendor.
    expect(
      calls.some((c) => c.url.includes("/customer") && c.method === "POST"),
    ).toBe(false);
    expect(
      calls.some((c) => c.url.includes("/vendor") && c.method === "POST"),
    ).toBe(false);

    // The invoice POST used the existing customer Id from the query.
    const inv = calls.find(
      (c) => c.url.includes("/invoice") && c.method === "POST",
    );
    expect(JSON.parse(inv!.body).CustomerRef.value).toBe("55");
  });

  it("skips invoices already recorded in the pushed-invoice store", async () => {
    const { fetchImpl, calls } = buildFakeQboFetch({
      existingCustomers: { Acme: "55" },
      existingVendors: { Sub: "77" },
    });
    const store = inMemoryPushedInvoiceStore(["INV-1"]);
    const result = await pushBundleToQbo(SAMPLE_BUNDLE, {
      accessToken: "ACC",
      realmId: "1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pushedInvoiceStore: store,
    });

    expect(result.invoicesCreated).toBe(0);
    expect(result.invoicesAlreadyUpToDate).toBe(1);
    expect(
      calls.some((c) => c.url.includes("/invoice") && c.method === "POST"),
    ).toBe(false);
  });

  it("records new invoices in the store after successful POST", async () => {
    const { fetchImpl } = buildFakeQboFetch({
      invoiceCreate: { Id: "9", DocNumber: "INV-1" },
    });
    const store = inMemoryPushedInvoiceStore();
    await pushBundleToQbo(SAMPLE_BUNDLE, {
      accessToken: "ACC",
      realmId: "1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pushedInvoiceStore: store,
    });
    expect(store.has("INV-1")).toBe(true);
  });

  it("tags each line's Description with the 1099 income category so the live QBO push matches the file-based exports", async () => {
    const { fn: fakeFetch, calls } = makeFetch((url) => {
      if (url.includes("/customer")) {
        return new Response(
          JSON.stringify({ Customer: { Id: "1", DisplayName: "Acme" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/invoice")) {
        return new Response(
          JSON.stringify({ Invoice: { Id: "9", DocNumber: "INV-1099" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return null;
    });

    await pushBundleToQbo(
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
            description: "Legal review",
            amount: "200.00",
            taxAmount: "0.00",
            lineType: "Labor",
            incomeCategory: "misc_attorney",
          },
          {
            invoiceNumber: "INV-1099",
            description: "Pump rental",
            amount: "100.00",
            taxAmount: "0.00",
            lineType: "Rental",
            // "none" must NOT be tagged — keeps non-1099 lines clean.
            incomeCategory: "none",
          },
        ],
        partners: [{ name: "Acme", email: null, address: null }],
        vendors: [],
      },
      {
        accessToken: "ACC",
        realmId: "1",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );

    const inv = calls.find((c) => c.url.includes("/invoice") && c.init);
    const body = JSON.parse(String(inv!.init!.body));
    expect(body.Line[0].Description).toBe(
      "Legal review [1099: Attorney fees – 1099-MISC Box 10]",
    );
    // "none" stays clean — no [1099: ...] suffix.
    expect(body.Line[1].Description).toBe("Pump rental");
  });

  it("collects warnings instead of throwing on per-row POST faults", async () => {
    const { fetchImpl } = buildFakeQboFetch({
      customerPostFault: { Message: "Some validation error" },
    });
    const result = await pushBundleToQbo(
      {
        invoices: [],
        lines: [],
        partners: [{ name: "X", email: null, address: null }],
        vendors: [],
      },
      {
        accessToken: "x",
        realmId: "1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(result.customersCreated).toBe(0);
    expect(
      result.warnings.some(
        (w) =>
          w.kind === "customer" &&
          w.identifier === "X" &&
          /Some validation error/.test(w.message),
      ),
    ).toBe(true);
  });
});

describe("ensureQboItemMap", () => {
  const incomeAccount: QbAccount = {
    name: "Service Income",
    number: "4000",
    qbType: "INC",
  };
  const otherAccount: QbAccount = {
    name: "Other Income",
    number: "4090",
    qbType: "INC",
  };

  it("creates Account + Item when nothing matches and persists via onResolve", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fakeFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });

        // All queries miss → forces account + item creation.
        if (method === "GET" && url.includes("/query")) {
          return new Response(
            JSON.stringify({ QueryResponse: {} }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (method === "POST" && url.includes("/account")) {
          return new Response(
            JSON.stringify({ Account: { Id: "AC-77" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (method === "POST" && url.includes("/item")) {
          return new Response(
            JSON.stringify({ Item: { Id: "IT-12" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    );

    const persisted: Array<{
      lineType: string;
      qboItemId: string;
      qboAccountId: string;
      qboAccountName: string;
    }> = [];
    const result = await ensureQboItemMap(
      {
        existing: {},
        desired: [{ lineType: "labor_regular", account: incomeAccount }],
        onResolve: async (e) => void persisted.push(e),
      },
      {
        accessToken: "ACC",
        realmId: "9876",
        environment: "sandbox",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );

    expect(result.itemMap).toEqual({ labor_regular: "IT-12" });
    expect(result.warnings).toEqual([]);
    expect(persisted).toEqual([
      {
        lineType: "labor_regular",
        qboItemId: "IT-12",
        qboAccountId: "AC-77",
        qboAccountName: "Service Income",
      },
    ]);
    // Account create body includes our AcctNum + AccountType mapping.
    const acctPost = calls.find(
      (c) => c.method === "POST" && c.url.includes("/account"),
    );
    expect(acctPost!.body).toMatchObject({
      Name: "Service Income",
      AcctNum: "4000",
      AccountType: "Income",
    });
    // Item create wires IncomeAccountRef to the account we just resolved.
    const itemPost = calls.find(
      (c) => c.method === "POST" && c.url.includes("/item"),
    );
    expect(itemPost!.body).toMatchObject({
      Name: "Service Income",
      Type: "Service",
      IncomeAccountRef: { value: "AC-77" },
    });
  });

  it("re-uses cached Item when its account still matches the desired account", async () => {
    const fakeFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        // Cache hit means we should NOT create anything; only the account
        // query is needed to validate the cached account is still right.
        if (method === "GET" && url.includes("/query") && url.includes("Account")) {
          return new Response(
            JSON.stringify({ QueryResponse: { Account: [{ Id: "AC-1", Name: "Service Income" }] } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      },
    );
    const persisted: unknown[] = [];
    const result = await ensureQboItemMap(
      {
        existing: { labor_regular: { qboItemId: "IT-existing", qboAccountId: "AC-1" } },
        desired: [{ lineType: "labor_regular", account: incomeAccount }],
        onResolve: async (e) => void persisted.push(e),
      },
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );
    expect(result.itemMap).toEqual({ labor_regular: "IT-existing" });
    expect(persisted).toEqual([]);
  });

  it("re-resolves when the cached account no longer matches the desired one", async () => {
    let createdItem = false;
    const fakeFetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.includes("/query") && url.includes("Account")) {
          // Account exists with a different Id than the cache.
          return new Response(
            JSON.stringify({ QueryResponse: { Account: [{ Id: "AC-NEW" }] } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (method === "GET" && url.includes("/query") && url.includes("Item")) {
          // Item doesn't exist — forces create.
          return new Response(
            JSON.stringify({ QueryResponse: {} }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (method === "POST" && url.includes("/item")) {
          createdItem = true;
          return new Response(
            JSON.stringify({ Item: { Id: "IT-NEW" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      },
    );
    const result = await ensureQboItemMap(
      {
        existing: { other: { qboItemId: "IT-OLD", qboAccountId: "AC-OLD" } },
        desired: [{ lineType: "other", account: otherAccount }],
      },
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );
    expect(createdItem).toBe(true);
    expect(result.itemMap).toEqual({ other: "IT-NEW" });
  });

  it("captures per-line warnings and falls back to cached id on failure", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response("boom", { status: 500 }),
    );
    const result = await ensureQboItemMap(
      {
        existing: { labor_regular: { qboItemId: "IT-cached", qboAccountId: null } },
        desired: [{ lineType: "labor_regular", account: incomeAccount }],
      },
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      },
    );
    expect(result.itemMap).toEqual({ labor_regular: "IT-cached" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].lineType).toBe("labor_regular");
  });
});

describe("reconcileQboInvoices", () => {
  function makeQueryFetch(invoices: Array<{
    DocNumber: string;
    TotalAmt: number;
    TxnTaxDetail?: { TotalTax: number };
  }>) {
    const calls: { url: string }[] = [];
    const fn = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url });
      // Filter the canned invoices by what was asked for so batched
      // queries return only the matching subset.
      const decoded = decodeURIComponent(url);
      const matching = invoices.filter((i) =>
        decoded.includes(`'${i.DocNumber}'`),
      );
      return new Response(
        JSON.stringify({ QueryResponse: { Invoice: matching } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    return { fn, calls };
  }

  it("returns no warnings when QBO totals + tax match exactly", async () => {
    const { fn } = makeQueryFetch([
      { DocNumber: "INV-1", TotalAmt: 150, TxnTaxDetail: { TotalTax: 10 } },
      { DocNumber: "INV-2", TotalAmt: 220, TxnTaxDetail: { TotalTax: 20 } },
    ]);
    const warnings = await reconcileQboInvoices(
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
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fn as unknown as typeof fetch,
        expectedTaxByState: { CA: 10, TX: 20 },
      },
    );
    expect(warnings).toEqual([]);
  });

  it("warns on per-invoice total + tax mismatches", async () => {
    // QBO recomputed tax via AST: $11 instead of our $10. Total
    // therefore also drifted to $151.
    const { fn } = makeQueryFetch([
      { DocNumber: "INV-1", TotalAmt: 151, TxnTaxDetail: { TotalTax: 11 } },
    ]);
    const warnings = await reconcileQboInvoices(
      [
        {
          invoiceNumber: "INV-1",
          expectedTotal: 150,
          expectedTax: 10,
          expectedTaxByState: { CA: 10 },
        },
      ],
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fn as unknown as typeof fetch,
      },
    );
    expect(warnings.length).toBe(2);
    expect(warnings[0].identifier).toBe("INV-1");
    expect(warnings[0].message).toMatch(/total 151\.00.*posted total 150\.00/);
    expect(warnings[1].identifier).toBe("INV-1");
    expect(warnings[1].message).toMatch(/tax 11\.00.*posted tax 10\.00/);
  });

  it("warns when an expected invoice is missing from QBO", async () => {
    const { fn } = makeQueryFetch([
      { DocNumber: "INV-1", TotalAmt: 100, TxnTaxDetail: { TotalTax: 0 } },
    ]);
    const warnings = await reconcileQboInvoices(
      [
        { invoiceNumber: "INV-1", expectedTotal: 100, expectedTax: 0 },
        { invoiceNumber: "INV-MISSING", expectedTotal: 50, expectedTax: 0 },
      ],
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fn as unknown as typeof fetch,
      },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].identifier).toBe("INV-MISSING");
    expect(warnings[0].message).toMatch(/could not be found in QuickBooks/);
  });

  it("warns on aggregate per-state mismatch against the report", async () => {
    // Per-invoice numbers match QBO, but the caller's expectedTaxByState
    // (i.e. VNDRLY's Sales-Tax-by-State report total) disagrees with
    // what we apportioned from the invoices — this is the "report drift"
    // signal.
    const { fn } = makeQueryFetch([
      { DocNumber: "INV-1", TotalAmt: 110, TxnTaxDetail: { TotalTax: 10 } },
    ]);
    const warnings = await reconcileQboInvoices(
      [
        {
          invoiceNumber: "INV-1",
          expectedTotal: 110,
          expectedTax: 10,
          expectedTaxByState: { CA: 10 },
        },
      ],
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
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
    // and QBO returns the same $30 — per-state aggregate should match
    // the report exactly because we apportion by ratio.
    const { fn } = makeQueryFetch([
      { DocNumber: "INV-1", TotalAmt: 330, TxnTaxDetail: { TotalTax: 30 } },
    ]);
    const warnings = await reconcileQboInvoices(
      [
        {
          invoiceNumber: "INV-1",
          expectedTotal: 330,
          expectedTax: 30,
          expectedTaxByState: { CA: 20, TX: 10 },
        },
      ],
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fn as unknown as typeof fetch,
        expectedTaxByState: { CA: 20, TX: 10 },
      },
    );
    expect(warnings).toEqual([]);
  });

  it("is fail-soft when the QBO query itself errors", async () => {
    const fn = vi.fn(async () =>
      new Response("server boom", { status: 500 }),
    );
    const warnings = await reconcileQboInvoices(
      [{ invoiceNumber: "INV-1", expectedTotal: 100, expectedTax: 0 }],
      {
        accessToken: "ACC",
        realmId: "1",
        environment: "sandbox",
        fetchImpl: fn as unknown as typeof fetch,
      },
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0].identifier).toBe("(reconciliation)");
    expect(warnings[0].message).toMatch(/could not read invoices back/);
  });

  it("returns no warnings for an empty expectations list (skips QBO call)", async () => {
    const fn = vi.fn();
    const warnings = await reconcileQboInvoices([], {
      accessToken: "ACC",
      realmId: "1",
      environment: "sandbox",
      fetchImpl: fn as unknown as typeof fetch,
    });
    expect(warnings).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("updateQboInvoice", () => {
  // Invoice update flow: GET /invoice/{id} → POST /invoice (sparse).
  // The fake fetch lets each test inject the read + update response
  // plus the customer lookup that the update path always re-runs.
  function buildFakeUpdateFetch(opts: {
    readResponse?: { status?: number; body?: unknown };
    updateResponse?: { status?: number; body?: unknown };
    existingCustomerId?: string;
  }) {
    const calls: { url: string; method: string; body: string }[] = [];
    const fn = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ url, method, body: String(init?.body ?? "") });
        if (url.includes("/query") && method === "GET") {
          const id = opts.existingCustomerId ?? "C-1";
          return new Response(
            JSON.stringify({
              QueryResponse: {
                Customer: [{ Id: id, DisplayName: "Acme" }],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/invoice/") && method === "GET") {
          const r = opts.readResponse ?? {
            status: 200,
            body: { Invoice: { Id: "999", SyncToken: "3", DocNumber: "INV-1" } },
          };
          return new Response(
            typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
            {
              status: r.status ?? 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (url.includes("/invoice") && method === "POST") {
          const r = opts.updateResponse ?? {
            status: 200,
            body: { Invoice: { Id: "999", DocNumber: "INV-1" } },
          };
          return new Response(
            typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
            {
              status: r.status ?? 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response("not found", { status: 404 });
      },
    );
    return { fn, calls };
  }

  it("reads SyncToken then POSTs a sparse update with Id+SyncToken+sparse=true", async () => {
    const { fn, calls } = buildFakeUpdateFetch({});
    const r = await updateQboInvoice({
      accessToken: "ACC",
      realmId: "1",
      externalInvoiceId: "999",
      bundle: SAMPLE_BUNDLE,
      environment: "sandbox",
      fetchImpl: fn as unknown as typeof fetch,
    });
    expect(r.status).toBe("updated");
    if (r.status === "updated") {
      expect(r.externalInvoiceId).toBe("999");
      expect(r.externalDocNumber).toBe("INV-1");
    }
    // Order: GET invoice/999, GET customer query, GET preferences (tax),
    //        POST invoice (sparse update). Reading prefs is conditional
    //        on the invoice carrying tax; SAMPLE_BUNDLE has tax=10 so
    //        the call must happen.
    const reads = calls.filter((c) => c.method === "GET");
    expect(reads.some((c) => c.url.includes("/invoice/999"))).toBe(true);
    expect(reads.some((c) => c.url.includes("/preferences"))).toBe(true);
    const update = calls.find(
      (c) => c.method === "POST" && c.url.includes("/invoice"),
    );
    expect(update).toBeDefined();
    expect(update!.url).toContain("operation=update");
    const body = JSON.parse(update!.body);
    expect(body.Id).toBe("999");
    expect(body.SyncToken).toBe("3");
    expect(body.sparse).toBe(true);
    expect(body.DocNumber).toBe("INV-1");
    expect(body.CustomerRef.value).toBe("C-1");
    // Same body shape as the create path.
    expect(body.Line[0].DetailType).toBe("SalesItemLineDetail");
  });

  it('returns {status: "missing"} when QBO returns Object Not Found (Fault 610)', async () => {
    const { fn } = buildFakeUpdateFetch({
      readResponse: {
        status: 200,
        body: {
          Fault: {
            Error: [{ Message: "Object Not Found", code: "610" }],
          },
        },
      },
    });
    const r = await updateQboInvoice({
      accessToken: "ACC",
      realmId: "1",
      externalInvoiceId: "999",
      bundle: SAMPLE_BUNDLE,
      environment: "sandbox",
      fetchImpl: fn as unknown as typeof fetch,
    });
    expect(r.status).toBe("missing");
    if (r.status === "missing") {
      expect(r.message).toMatch(/no longer exists/);
    }
  });

  it('returns {status: "missing"} when QBO returns HTTP 404 on the read', async () => {
    const { fn } = buildFakeUpdateFetch({
      readResponse: { status: 404, body: { Fault: { Error: [] } } },
    });
    const r = await updateQboInvoice({
      accessToken: "ACC",
      realmId: "1",
      externalInvoiceId: "999",
      bundle: SAMPLE_BUNDLE,
      environment: "sandbox",
      fetchImpl: fn as unknown as typeof fetch,
    });
    expect(r.status).toBe("missing");
  });

  it("throws when the update POST returns a non-NotFound fault", async () => {
    const { fn } = buildFakeUpdateFetch({
      updateResponse: {
        status: 200,
        body: {
          Fault: {
            Error: [{ Message: "Stale Object Error", code: "5010" }],
          },
        },
      },
    });
    await expect(
      updateQboInvoice({
        accessToken: "ACC",
        realmId: "1",
        externalInvoiceId: "999",
        bundle: SAMPLE_BUNDLE,
        environment: "sandbox",
        fetchImpl: fn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Stale Object Error/);
  });
});
