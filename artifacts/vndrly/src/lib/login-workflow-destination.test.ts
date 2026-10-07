import { expect, it } from "vitest";
import { loginWorkflowDestination } from "./login-workflow-destination";
it("preserves exact ticket entry and Work Hub context after sign-in", () => {
  expect(loginWorkflowDestination("/tickets/100005", "?askvEntry=photo")).toBe("/tickets/100005?askvEntry=photo");
  expect(loginWorkflowDestination("/work-hub/files", "?folderId=demo")).toBe("/work-hub/files?folderId=demo");
});
it("refuses external or unknown destinations and malformed query strings", () => {
  for (const path of ["https://attacker.test", "//attacker.test", "/login", "/switch-account", "/tickets/0", "/tickets/42/../admin", "/work-hub\\evil"]) expect(loginWorkflowDestination(path, "")).toBe("/");
  for (const search of ["//attacker.test", "?a=\nlocation", "?a=\\evil", "?" + "x".repeat(2048)]) expect(loginWorkflowDestination("/tickets/42", search)).toBe("/");
});
