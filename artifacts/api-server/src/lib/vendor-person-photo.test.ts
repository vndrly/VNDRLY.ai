import { describe, expect, it } from "vitest";

import {
  resolveVendorPersonPhotoUrl,
  storageApiPathFromObjectPath,
} from "./vendor-person-photo";

describe("vendor-person-photo", () => {
  it("builds storage API paths from object paths", () => {
    expect(storageApiPathFromObjectPath("/objects/uploads/abc")).toBe(
      "/api/storage/objects/uploads/abc",
    );
  });

  it("prefers profilePhotoPath over legacy photoUrl", () => {
    expect(
      resolveVendorPersonPhotoUrl(
        "/objects/uploads/new",
        "/api/storage/objects/uploads/old",
      ),
    ).toBe("/api/storage/objects/uploads/new");
  });

  it("falls back to photoUrl when profilePhotoPath is empty", () => {
    expect(
      resolveVendorPersonPhotoUrl(null, "/api/storage/objects/uploads/legacy"),
    ).toBe("/api/storage/objects/uploads/legacy");
  });
});
