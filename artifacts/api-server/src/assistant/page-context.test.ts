import { expect, it } from "vitest";
import { parsePageContext } from "./page-context";
it("carries the current activity and field status into text conversations without accepting raw field values", () => {
  const context = parsePageContext({ path: "/payroll", page: { path: "/payroll", title: "Payroll", activity: { title: "Run payroll", kind: "form", fields: [{ label: "Pay period", filled: true, required: true, value: "private payroll value" }], controls: [{ label: "Preview", disabled: false }] } } });
  expect(context).toMatchObject({ path: "/payroll", page: { title: "Payroll", activity: { title: "Run payroll", fields: [{ label: "Pay period", filled: true, required: true }] } } });
  expect(JSON.stringify(context)).not.toContain("private payroll value");
});
