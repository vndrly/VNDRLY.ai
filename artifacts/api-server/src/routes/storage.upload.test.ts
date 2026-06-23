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
    expect(parsed.uploadURL).toContain("expires=");
    expect(parsed.uploadURL).toContain("signature=");
    expect(parsed.objectPath).toMatch(/^\/objects\/uploads\//);
  });

  it("validates only signed, unexpired upload URLs", () => {
    const store = getObjectStore();
    const descriptor = store.getUploadDescriptor();
    const parsed = new URL(descriptor.uploadURL, "https://vndrly.ai");
    const uploadId = parsed.pathname.split("/").pop();

    expect(uploadId).toBeTruthy();
    expect(
      store.validateUploadURL(
        uploadId!,
        parsed.searchParams.get("expires") ?? undefined,
        parsed.searchParams.get("signature") ?? undefined,
      ),
    ).toBe(true);

    expect(store.validateUploadURL(uploadId!, undefined, undefined)).toBe(false);
    expect(
      store.validateUploadURL(
        uploadId!,
        parsed.searchParams.get("expires") ?? undefined,
        "0".repeat(64),
      ),
    ).toBe(false);
  });
});
