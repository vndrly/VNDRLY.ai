# VNDRLY Camera Gateway Setup

The camera gateway runs inside each site's camera network. It keeps recorder
addresses and passwords local, sends only normalized hardware inventory to
VNDRLY, and brokers short-lived HLS/WebRTC playback sessions.

## What VNDRLY supports

- ONVIF discovery for compatible cameras and recorders.
- Manual RTSP registration when ONVIF is unavailable.
- Montavue through the `montavue-onvif` adapter while retaining the generic
  ONVIF/RTSP model for other manufacturers.
- One read-only credential reference shared by several recorders, or separate
  references when a site requires isolation.
- MediaMTX-compatible HLS and WHEP paths for browser/iOS playback.

## Gateway host prerequisites

- A Windows or Linux host that can reach every approved NVR/camera on the LAN.
- Node.js 24 and the VNDRLY repository or packaged camera-gateway artifact.
- MediaMTX (or an equivalent RTSP-to-HLS/WebRTC relay) configured with one
  non-secret media path name per approved channel.
- Outbound HTTPS access to the VNDRLY API.
- An HTTPS public/zero-trust URL reaching the gateway playback endpoint and
  relay. Do not expose NVR management ports directly to the internet.

## Safe configuration sequence

1. In VNDRLY, open the site and its Camera Center. Create a site gateway. Copy
   the enrollment token directly into the gateway service environment; it is
   shown once and VNDRLY stores only its SHA-256 hash.
2. On the gateway host, create `camera-gateway.json`. Keep it outside the repo
   and restrict filesystem permissions to the gateway service account.
3. Create a dedicated Montavue/NVR user with live-view permission only. Disable
   configuration, deletion, export, PTZ, firmware, user management, and audio
   talk unless explicitly required.
4. Put the username/password only in the local gateway config. Register its
   opaque name (for example `site-main-readonly`) in VNDRLY. The same reference
   may be selected by all four recorders.
5. Start MediaMTX and confirm each configured path can read its RTSP source from
   the gateway host. Then start `pnpm --filter @workspace/camera-gateway start`.
6. Confirm the gateway reports Online, inventory contains the expected recorder
   and channel count, and one live channel plays in Camera Center.

Example local config (placeholders only):

```json
{
  "credentials": {
    "site-main-readonly": {
      "username": "REPLACE_ON_GATEWAY",
      "password": "REPLACE_ON_GATEWAY"
    }
  },
  "devices": [
    {
      "stableKey": "main-nvr",
      "name": "Main NVR",
      "kind": "recorder",
      "manufacturer": "Montavue",
      "model": "REPLACE_WITH_MODEL",
      "protocols": ["onvif", "rtsp"],
      "address": "REPLACE_WITH_LAN_ADDRESS",
      "credentialRef": "site-main-readonly",
      "channels": [
        { "stableKey": "1", "name": "Front gate", "mediaPath": "front-gate" }
      ]
    }
  ]
}
```

## Morning live-site checklist

- Provide the NVR make/model and LAN address for each of the four recorders.
- Create or confirm the dedicated read-only live-view account.
- Confirm which channels VNDRLY may display and their user-facing names.
- Choose the onsite host and allow it to reach the NVRs, VNDRLY HTTPS, and the
  approved zero-trust playback endpoint.
- Verify one live channel end to end before enabling the remaining channels.

Never paste passwords, RTSP URLs, or enrollment tokens into chat, tickets,
source control, screenshots, or logs.
