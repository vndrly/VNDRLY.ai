import { expect, it } from "vitest";
import { parsePageContext, withSelectedGate } from "./page-context";
it("carries the current activity and field status into text conversations without accepting raw field values", () => {
  const context = parsePageContext({ path: "/payroll", page: { path: "/payroll", title: "Payroll", activity: { title: "Run payroll", kind: "form", fields: [{ label: "Pay period", filled: true, required: true, value: "private payroll value" }], controls: [{ label: "Preview", disabled: false }] } } });
  expect(context).toMatchObject({ path: "/payroll", page: { title: "Payroll", activity: { title: "Run payroll", fields: [{ label: "Pay period", filled: true, required: true }] } } });
  expect(JSON.stringify(context)).not.toContain("private payroll value");
});
it("keeps compact panel focus separate from whether input was typed or spoken", () => {
  expect(parsePageContext({ path: "/mobile/work-hub/calendar", inputMode: "ios_text", focusMode: true })).toMatchObject({ inputMode: "ios_text", focusMode: true });
  expect(parsePageContext({ path: "/mobile/work-hub/calendar", inputMode: "ios_text", focusMode: "true" })).not.toHaveProperty("focusMode");
});
it("checks visitors in and out at the site and gate selected on the Gate form", () => {
  const gateDraft = { siteLocationId: 42, gateStationId: "11111111-1111-4111-8111-111111111111", firstName: "John" };
  expect(withSelectedGate("confirm_visitor_check_in", { firstName: "John", siteLocationId: 7, gateStationId: "22222222-2222-4222-8222-222222222222" }, gateDraft))
    .toEqual({ firstName: "John", siteLocationId: 42, gateStationId: gateDraft.gateStationId });
  expect(withSelectedGate("resolve_gate_check_in", { lastName: "Smith" }, gateDraft)).toEqual({ lastName: "Smith", siteLocationId: 42, gateStationId: gateDraft.gateStationId });
  expect(withSelectedGate("prepare_visitor_check_out", { query: "John Smith" }, gateDraft)).toEqual({ query: "John Smith", siteLocationId: 42 });
  expect(withSelectedGate("confirm_visitor_check_out", { visitId: 5 }, gateDraft)).toEqual({ visitId: 5, gateStationId: gateDraft.gateStationId });
  expect(withSelectedGate("query_gate_log", { siteLocationId: 7 }, gateDraft)).toEqual({ siteLocationId: 7 });
  expect(withSelectedGate("confirm_visitor_check_in", { firstName: "John" }, undefined)).toEqual({ firstName: "John" });
});
