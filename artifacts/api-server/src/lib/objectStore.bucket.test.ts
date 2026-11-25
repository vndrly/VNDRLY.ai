import { expect, it } from "vitest";
import { isExistingStorageBucketError } from "./objectStore";

it("treats an existing Supabase bucket as safe to reuse", () => {
  expect(isExistingStorageBucketError({ message: "The resource already exists", status: 400, statusCode: "409" })).toBe(true);
  expect(isExistingStorageBucketError({ message: "Bucket not found", status: 400, statusCode: "404" })).toBe(false);
  expect(isExistingStorageBucketError(null)).toBe(false);
});
