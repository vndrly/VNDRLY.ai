import { describe, expect, it } from "vitest";
import { buildInventory, parseOnvifProbeResponse } from "./discovery";

describe("ONVIF camera gateway discovery", () => {
  it("parses namespace-independent WS-Discovery probe matches", () => {
    const result = parseOnvifProbeResponse(`
      <e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
        xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
        xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
        <e:Body><d:ProbeMatches><d:ProbeMatch>
          <a:EndpointReference><a:Address>urn:uuid:ABC-123</a:Address></a:EndpointReference>
          <d:XAddrs>http://10.0.0.20/onvif/device_service</d:XAddrs>
          <d:Scopes>onvif://www.onvif.org/name/Front%20Gate onvif://www.onvif.org/hardware/MNR8208</d:Scopes>
        </d:ProbeMatch></d:ProbeMatches></e:Body>
      </e:Envelope>
    `);
    expect(result).toEqual([
      {
        stableKey: "urn:uuid:abc-123",
        name: "Front Gate",
        model: "MNR8208",
        xaddrs: ["http://10.0.0.20/onvif/device_service"],
      },
    ]);
  });

  it("keeps network addresses and credential values local while reusing one reference", () => {
    const inventory = buildInventory({
      credentials: {
        "shared-readonly": { username: "viewer", password: "local-only-password" },
      },
      devices: [
        {
          stableKey: "nvr-1",
          name: "Main NVR",
          kind: "recorder",
          manufacturer: "Montavue",
          model: "MNR8208",
          protocols: ["onvif", "rtsp"],
          address: "10.0.0.20",
          credentialRef: "shared-readonly",
          channels: [{ stableKey: "1", name: "Front gate", mediaPath: "front-gate" }],
        },
        {
          stableKey: "nvr-2",
          name: "Backup NVR",
          kind: "recorder",
          protocols: ["rtsp"],
          address: "10.0.0.21",
          credentialRef: "shared-readonly",
          channels: [{ stableKey: "1", name: "Back gate", mediaPath: "back-gate" }],
        },
      ],
    });
    expect(inventory.map((device) => device.credentialRef)).toEqual([
      "shared-readonly",
      "shared-readonly",
    ]);
    expect(JSON.stringify(inventory)).not.toMatch(/local-only-password|viewer|10\.0\.0\./);
  });
});
