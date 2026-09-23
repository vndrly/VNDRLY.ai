# VNDRLY Camera Integration Design

## Purpose

VNDRLY will treat Montavue as the first camera provider, not as the camera
architecture. A site gateway discovers or registers recorders and cameras,
normalizes them into a stable hardware registry, and brokers browser/iOS-safe
playback without exposing recorder credentials or RTSP addresses to clients.

## Boundaries

- A partner-owned site may have one gateway and any number of recorders,
  cameras, sensors, or future device types.
- One read-only credential reference may be reused across several recorders.
  The credential value stays in the site gateway's secret store; VNDRLY stores
  only an opaque reference and a non-secret label.
- ONVIF discovery is preferred. Manually supplied RTSP endpoints are the
  fallback. Provider adapters normalize make/model-specific metadata.
- VNDRLY clients receive only short-lived playback descriptors (WebRTC first,
  HLS fallback), never upstream credentials or RTSP URLs.
- Admins and partner administrators can configure hardware. Other authenticated
  users may view only cameras at sites they can already read.
- Gateway inventory updates are idempotent and keyed by gateway plus stable
  hardware key, so rescans update existing hardware rather than duplicate it.

## First shippable slice

This batch establishes the database, domain rules, authenticated API contract,
gateway reconciliation protocol, and web camera center. Live Montavue video
still requires the site's read-only credentials, NVR addresses, a reachable
gateway host, and one live-feed verification.
