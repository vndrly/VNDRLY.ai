import { describe, expect, it } from "vitest";
import { allowedSendToGroups } from "./ticket-send-to";
import { parseTicketIdFromHref } from "./parse-ticket-href";

describe("allowedSendToGroups", () => {
  it("admin sees vendor/partner POC splits and VNDRLY staff", () => {
    expect(allowedSendToGroups("admin")).toEqual([
      "on_ticket",
      "vendor_poc_field",
      "vendor_poc_office",
      "vendor_office",
      "partner_poc_operations",
      "partner_poc_ap",
      "partner_office",
      "vndrly_office",
    ]);
  });

  it("partner sees vendor field/office POC and partner ops/ap/office peers", () => {
    expect(allowedSendToGroups("partner")).toEqual([
      "on_ticket",
      "vendor_poc_field",
      "vendor_poc_office",
      "partner_poc_operations",
      "partner_poc_ap",
      "partner_office",
    ]);
  });

  it("vendor reaches field POC, partner ops/ap, and vendor office peers", () => {
    expect(allowedSendToGroups("vendor")).toEqual([
      "on_ticket",
      "vendor_poc_field",
      "partner_poc_operations",
      "partner_poc_ap",
      "vendor_office",
    ]);
  });

  it("field employees reach vendor POC and same-vendor field crew", () => {
    expect(allowedSendToGroups("field_employee")).toEqual([
      "on_ticket",
      "vendor_poc_field",
      "vendor_poc_office",
      "field_crew",
    ]);
  });

  it("unknown roles get no groups", () => {
    expect(allowedSendToGroups("guest")).toEqual([]);
  });
});

describe("parseTicketIdFromHref", () => {
  it("parses web and deep-link ticket paths", () => {
    expect(parseTicketIdFromHref("/tickets/42")).toBe(42);
    expect(parseTicketIdFromHref("vndrly-deep-link:ticket-detail/99")).toBe(99);
    expect(parseTicketIdFromHref("https://vndrly.ai/tickets/7")).toBe(7);
  });

  it("returns null for non-ticket links", () => {
    expect(parseTicketIdFromHref("/hotlist")).toBeNull();
    expect(parseTicketIdFromHref("")).toBeNull();
  });

  it("parses ticket ids before hash fragments", () => {
    expect(parseTicketIdFromHref("/tickets/123#comment-456")).toBe(123);
  });
});
