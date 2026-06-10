import { describe, expect, it } from "vitest";
import { RequestUploadUrlResponse } from "@workspace/api-zod";
import { absoluteUploadUrl } from "../lib/uploadUrl";
import { getObjectStore } from "../lib/objectStore";

describe("storage upload descriptor", () => {
  it("parses request-url response shape", () => {
    const descriptor = getObjectStore().getUploadDescriptor();
    const uploadURL = absoluteUploadUrl(
      { get: (h: string) => (h === "host" ? "localhost:8080" : undefined) } as any,
      descriptor.uploadURL,
    );
    const parsed = RequestUploadUrlResponse.parse({
      uploadURL,
      objectPath: descriptor.objectPath,
    });
    expect(parsed.uploadURL).toContain("/api/storage/upload/");
    expect(parsed.objectPath).toMatch(/^\/objects\/uploads\//);
  });
});
