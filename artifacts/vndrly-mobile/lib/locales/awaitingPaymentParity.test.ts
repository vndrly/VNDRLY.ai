import { describe, expect, it } from "vitest";

import en from "./en.json";
import es from "./es.json";

// ---------------------------------------------------------------------------
// Awaiting-payment locale parity (Task #602)
//
// The mobile awaiting-payment confirmation modal, the success Alert, and the
// `invalid_awaiting_payment_body` inline error all rely on translation keys
// that exist today in both `en.json` and `es.json`. There is no automated
// check that they stay in sync — if someone adds a new `tickets.awaitingPayment*`
// key in `en.json` and forgets the Spanish counterpart, Spanish-speaking
// field employees would silently see English copy (or the raw key) on a
// critical money-related screen.
//
// This test enumerates every awaiting-payment-related key in each locale
// and asserts the other locale defines a non-empty string for the same key.
// ---------------------------------------------------------------------------

type LocaleSection = Record<string, unknown>;

function ticketsSection(locale: Record<string, unknown>): LocaleSection {
  const section = locale.tickets;
  if (!section || typeof section !== "object") {
    throw new Error("Locale is missing the `tickets` section");
  }
  return section as LocaleSection;
}

function errorsSection(locale: Record<string, unknown>): LocaleSection {
  const section = locale.errors;
  if (!section || typeof section !== "object") {
    throw new Error("Locale is missing the `errors` section");
  }
  return section as LocaleSection;
}

// Match every `tickets.*` key whose name references "AwaitingPayment" in any
// casing — that covers `awaitingPayment*`, `markAwaitingPayment`, and
// `errorAwaitingPayment` mentioned in Task #602.
const AWAITING_PAYMENT_TICKET_KEY = /awaitingpayment/i;

function awaitingPaymentTicketKeys(locale: Record<string, unknown>): string[] {
  return Object.keys(ticketsSection(locale))
    .filter((key) => AWAITING_PAYMENT_TICKET_KEY.test(key))
    .sort();
}

function expectNonEmptyString(value: unknown, label: string): void {
  expect(typeof value, `${label} must be a string`).toBe("string");
  expect((value as string).length, `${label} must be non-empty`).toBeGreaterThan(0);
}

describe("awaiting-payment locale parity (Task #602)", () => {
  it("finds the expected awaiting-payment ticket keys in en.json (sanity)", () => {
    // Guard against the regex silently matching nothing — if someone renames
    // every key away from "AwaitingPayment", this test should fail loudly
    // rather than vacuously pass.
    expect(awaitingPaymentTicketKeys(en).length).toBeGreaterThan(0);
  });

  it("every tickets.awaitingPayment* / markAwaitingPayment / errorAwaitingPayment key in en.json exists in es.json", () => {
    const enKeys = awaitingPaymentTicketKeys(en);
    const esTickets = ticketsSection(es);
    for (const key of enKeys) {
      expectNonEmptyString(esTickets[key], `es.json tickets.${key}`);
    }
  });

  it("every tickets.awaitingPayment* / markAwaitingPayment / errorAwaitingPayment key in es.json exists in en.json", () => {
    const esKeys = awaitingPaymentTicketKeys(es);
    const enTickets = ticketsSection(en);
    for (const key of esKeys) {
      expectNonEmptyString(enTickets[key], `en.json tickets.${key}`);
    }
  });

  it("the awaiting-payment ticket key sets are identical across en.json and es.json", () => {
    // Belt-and-suspenders: also assert the sorted key sets match exactly so
    // a missing key on either side produces a single, easy-to-read diff.
    expect(awaitingPaymentTicketKeys(es)).toEqual(
      awaitingPaymentTicketKeys(en),
    );
  });

  it("errors.invalid_awaiting_payment_body is defined in both locales", () => {
    expectNonEmptyString(
      errorsSection(en).invalid_awaiting_payment_body,
      "en.json errors.invalid_awaiting_payment_body",
    );
    expectNonEmptyString(
      errorsSection(es).invalid_awaiting_payment_body,
      "es.json errors.invalid_awaiting_payment_body",
    );
  });
});
