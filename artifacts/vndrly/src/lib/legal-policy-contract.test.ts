import { expect, it } from "vitest";
import { LEGAL_POLICY_VERSION as shared } from "@workspace/api-zod";
import { LEGAL_POLICY_VERSION as documents, LEGAL_EFFECTIVE_DATE } from "./legal-docs";
it("uses the shared current consent version for the published documents", () => {
  expect(documents).toBe(shared);
  expect(shared).toBe("2026-08-24");
  expect(LEGAL_EFFECTIVE_DATE).toBe("August 24, 2026");
});
