import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  cameraChannelsTable,
  cameraCredentialReferencesTable,
  cameraDevicesTable,
  cameraGatewaysTable,
} from "@workspace/db";

describe("camera database schema", () => {
  it("exports site-scoped camera registry tables", () => {
    expect(getTableName(cameraGatewaysTable)).toBe("camera_gateways");
    expect(getTableName(cameraCredentialReferencesTable)).toBe("camera_credential_references");
    expect(getTableName(cameraDevicesTable)).toBe("camera_devices");
    expect(getTableName(cameraChannelsTable)).toBe("camera_channels");

    expect(Object.keys(getTableColumns(cameraGatewaysTable))).toEqual(
      expect.arrayContaining(["siteLocationId", "tokenHash", "status", "lastSeenAt"]),
    );
    expect(Object.keys(getTableColumns(cameraDevicesTable))).toEqual(
      expect.arrayContaining(["gatewayId", "stableKey", "adapter", "credentialReferenceId"]),
    );
  });

  it("stores only opaque credential references and never secret values", () => {
    const columns = Object.keys(getTableColumns(cameraCredentialReferencesTable));
    expect(columns).toEqual(
      expect.arrayContaining(["gatewayId", "externalRef", "label", "scope"]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining(["password", "secret", "token", "credentialValue"]),
    );
  });
});
