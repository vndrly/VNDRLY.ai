# Vendor-Neutral Camera Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the extensible VNDRLY camera registry, gateway contract, authorization boundary, and browser camera center with Montavue as the first provider.

**Architecture:** A site-scoped gateway owns LAN discovery and credentials, then reconciles normalized hardware into VNDRLY. The API stores non-secret registry data and issues short-lived playback descriptors; web clients never receive RTSP URLs or recorder credentials.

**Tech Stack:** TypeScript 5.9, Express 5, PostgreSQL/Drizzle, Zod 4, React 19, Vitest.

**Spec:** `docs/camera-integration-design.md`

## Global Constraints

- No destructive database operations; migration is additive only.
- No camera passwords, RTSP credentials, or raw secrets in VNDRLY responses or logs.
- Existing site authorization remains the source of truth.
- ONVIF and RTSP are protocols behind adapters, not hard-coded product identities.
- Tests precede production behavior and must fail for the intended missing behavior.

## Review Focus

- A partner user requesting another partner's camera receives 403 and no metadata.
- Repeated gateway inventory for the same stable key updates one device instead of duplicating it.
- A shared credential reference can bind several recorders without copying a secret.
- Unsupported protocols and unsafe playback URLs are rejected.
- Offline or revoked gateways cannot issue a playback descriptor.

---

### Task 1: Camera registry domain

**Files:**
- Create: `artifacts/api-server/src/cameras/registry.ts`
- Test: `artifacts/api-server/src/cameras/registry.test.ts`

**Interfaces:**
- Consumes: normalized gateway inventory entries.
- Produces: `normalizeCameraInventory`, `selectCameraAdapter`, and safe playback validation.

- [ ] **Step 1: Write failing tests** for Montavue/ONVIF selection, RTSP fallback,
  idempotent stable keys, shared credential references, and secret redaction.
- [ ] **Step 2: Run** `pnpm --filter @workspace/api-server exec vitest run src/cameras/registry.test.ts`
  and confirm failure because the module does not exist.
- [ ] **Step 3: Implement minimal pure functions** returning literal normalized
  device/channel records and rejecting credential-bearing URLs.
- [ ] **Step 4: Re-run the focused test** and confirm it passes.

### Task 2: Additive camera schema

**Files:**
- Create: `lib/db/src/schema/cameras.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/drizzle/chunk_068.sql`
- Test: `artifacts/api-server/src/cameras/camera-schema.test.ts`

**Interfaces:**
- Consumes: partner sites and users.
- Produces: gateway, credential-reference, device, channel, and audit tables.

- [ ] **Step 1: Write a failing schema test** that imports all camera tables and
  asserts their database names, tenant columns, unique inventory key, and the
  absence of password/secret columns.
- [ ] **Step 2: Run the focused schema test** and confirm missing exports fail it.
- [ ] **Step 3: Add Drizzle tables and an additive SQL migration** with foreign
  keys, unique indexes, status fields, timestamps, and no secret-value column.
- [ ] **Step 4: Re-run the focused schema test** and confirm it passes.

### Task 3: Registry and gateway API

**Files:**
- Create: `artifacts/api-server/src/cameras/service.ts`
- Create: `artifacts/api-server/src/cameras/service.test.ts`
- Create: `artifacts/api-server/src/routes/cameras.ts`
- Create: `artifacts/api-server/src/routes/cameras.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Consumes: camera tables, site authorization, normalized inventory.
- Produces: site registry reads, admin configuration, gateway heartbeat/inventory,
  and short-lived playback-descriptor endpoints.

- [ ] **Step 1: Write failing service tests** for idempotent reconciliation,
  gateway revocation/offline behavior, protocol preference, and expiry.
- [ ] **Step 2: Run service tests** and confirm they fail for missing behavior.
- [ ] **Step 3: Implement repository-driven service logic** without Express or DB
  details and re-run service tests.
- [ ] **Step 4: Write failing route tests** for authentication, cross-tenant 403,
  partner-admin mutation rules, gateway token hashing, and response redaction.
- [ ] **Step 5: Implement the routes and DB repository**, register the router, and
  re-run both focused suites.

### Task 4: Browser camera center

**Files:**
- Create: `artifacts/vndrly/src/pages/camera-center.tsx`
- Create: `artifacts/vndrly/src/pages/camera-center.test.tsx`
- Modify: `artifacts/vndrly/src/App.tsx`

**Interfaces:**
- Consumes: `/api/sites/:siteId/cameras` and playback descriptors.
- Produces: site/device status, channel selection, and native HLS/WebRTC handoff.

- [ ] **Step 1: Write a failing component test** proving offline status renders,
  a view request is explicit, and no upstream address appears in the DOM.
- [ ] **Step 2: Run the focused web test** and confirm missing page failure.
- [ ] **Step 3: Implement the page** with loading, empty, offline, error, and
  playback states using existing components and fetch conventions.
- [ ] **Step 4: Register the route** and re-run the focused test.

### Task 5: Documentation and verification

**Files:**
- Create: `docs/camera-gateway-setup.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: the implemented gateway/API contract.
- Produces: a safe onsite checklist and deployment configuration reference.

- [x] **Step 1: Document** gateway prerequisites, read-only account permissions,
  NVR/channel inventory, network/firewall needs, and verification steps without
  embedding any credentials.
- [x] **Step 2: Run** focused camera tests, `pnpm run typecheck`,
  `pnpm run lint:i18n`, and the relevant web/API suites.
- [x] **Step 3: Inspect** `git diff --check`, `git status`, and the final diff for
  secrets, tenant leaks, and destructive SQL.
