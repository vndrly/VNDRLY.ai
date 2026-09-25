# Work Hub, Gate Locations, and Ask V Follow-up Design

## Purpose

Complete the approved post-notifications Work Hub follow-up as one coherent, permission-safe release. The work combines Files & Notes with Inventory on mobile, gives each role only the actions it owns, improves Work Hub Search, removes inappropriate exports, adds admin-managed gate locations distinct from partner wellhead locations, and brings Ask V to feature parity with the resulting workflows.

This is a full ship: web, API, guarded production migrations, iOS OTA, and a native TestFlight build and submission.

## Scope and non-goals

Included:

- iPhone and iPad Work Hub navigation and screens.
- Supporting web surfaces where the same capability or authorization contract is shared.
- API contracts, authorization, auditing, deep links, and additive schema changes required by these features.
- Ask V tools and navigation for the approved workflows.
- Focused accessibility, English/Spanish localization, automated tests, and release verification.

Excluded:

- Camera Center and camera/NVR work.
- App Store Ready for Sale.
- A general payroll product for gatekeepers; personal hours remain a future dedicated view.
- A second file store, inventory store, notification system, or gate/site ownership model.

## Authorization model

The server remains authoritative. Clients render explicit capabilities returned by the API rather than inferring permission from labels alone. Relevant capabilities include:

- `canUploadFile`
- `canCreateNote`
- `canEditNote`
- `canCreateAsset`
- `canManageAsset`
- `canCheckOutAsset`
- `canVerifyIssuedAsset`
- `canViewExports`
- `allowedExportDatasets`
- `canManageGateLocations`

Every read and mutation endpoint enforces the same capability independently. Deep links are re-authorized when opened. Revoked or stale destinations fail closed and remain unread where applicable.

### Role matrix

| Capability | Gatekeeper | Gate supervisor | Organization admin |
| --- | --- | --- | --- |
| Read authorized files and notes | Yes | Yes | Yes |
| Add operational note/evidence | Yes, within assigned gate context | Yes, within supervised gate context | Yes |
| Edit note | Own note until policy cutoff | Own/supervised context | Yes |
| View assigned/available inventory | Yes | Yes | Yes |
| Check out or verify issued equipment | Yes | Yes | Yes |
| Oversee crew custody | No | Yes | Yes |
| Create/delete/broadly edit inventory | No | No, unless separately granted asset manager | Yes/asset manager |
| See Exports card | No | Staffing only | All approved datasets |
| Manage gate locations | No | No | Yes, for authorized serviced sites |

## Files & Inventory page

The existing mobile `Files & Inventory` entry opens one page titled **Files & Inventory** with two branded cards.

### Files & Notes card

- Reuses the existing Work Hub file-library and channel-note APIs rather than a new store.
- Lists authorized files and notes with type, author, date, scope, and the appropriate open/download action.
- Authorized users see **Upload File** and **Add Note** actions. Read-only users see the same records without mutation controls.
- Uploads retain the existing private storage, checksum, versioning, reservation/finalization, ACL, idempotency, and audit flow.
- Notes retain channel scope and optimistic version checks. A gatekeeper may edit their own operational note within the existing edit window; supervisors/admins may manage notes in their authorized context. A channel writer does not automatically receive unrestricted edit rights over another author's note.
- Empty, loading, failed-upload, conflict, and no-access states are explicit.

### Inventory card

- Lists authorized assets with identity, status, condition, current custodian, current location, and any hold.
- Gatekeepers can check out eligible items, return them, and verify equipment already issued to them.
- Gate supervisors can perform those actions and oversee custody for their gate crew.
- Organization admins or asset managers create and manage the catalog, aliases, categories, holds, merges, and corrections.
- Existing custody events and evidence remain the system of record. Mutations preserve compare-and-swap version checks and idempotency.
- The API response is normalized to one documented shape and both web and mobile consume that shape. The current array-versus-object mismatch is fixed with compatibility coverage so existing callers do not silently render an empty inventory.
- Existing asset location columns are integrated into service/repository mapping. No duplicate inventory-location model is introduced.

## Work Hub Search

The mobile Search page uses one branded card:

1. A two-pixel brand-color input border.
2. Query, date, and content-type filters matching the authorized web search contract.
3. A branded VNDRLY pill **Search** action.
4. A clear divider.
5. Scrollable results below the divider with loading, empty, no-results, and error states.

Search remains permission-scoped and covers authorized messages, channel notes, meeting titles/agendas/transcripts, files, tasks, forms, announcements, and inventory. Results include enough routing metadata to open the exact authorized item. Existing result limits remain in force for this release; the API returns a stable continuation cursor where supported rather than implying an unlimited archive search.

## Role-based Exports

- Gatekeepers do not see the Exports card.
- Gate supervisors see **Staffing** only.
- Organization admins see **Payroll Hours**, **QuickBooks Time**, **Inventory & Custody**, **Staffing**, and **Safety Response**.
- Personal payroll information is not exposed through the company export surface.
- Export preview and final export use the identical owner/dataset authorization check. The current preview-route gap is closed.
- Every generated export remains audited and preserves CSV-injection protection.

## Gate Location management

An organization admin sees **Add Gate Location** beneath Compliance in Profile & Settings. A gate location is a physical check-in/check-out crossing, not a partner's site or wellhead coordinate.

### Data and ownership

- A gate location is linked to one partner-owned site location.
- A site may have multiple named gates, such as Main Gate, East Gate, or South Gate.
- Each gate stores its own display name, latitude, longitude, geofence radius, active status, and version/audit metadata.
- Gate coordinates may be miles from the wellheads and never overwrite the partner's site coordinates.
- MidCon organization admins may manage gates only for partner sites their organization is authorized to service. The partner remains the owner of the site record.
- Creation and updates use additive guarded migrations, exact-value confirmation, optimistic versioning, idempotency, and audit events. No destructive schema operation is permitted.

### UI

- The admin flow selects an authorized partner site, names the gate, captures or enters coordinates, previews the point and radius, and confirms before saving.
- Existing gates are listed with edit, deactivate/reactivate, and map-preview actions subject to authorization.
- Gatekeepers and gate supervisors may select/use authorized gates operationally but cannot create or modify gate locations.
- Existing supervisor shift-station creation remains operationally separate; its broad permission is not reused as the admin-management permission.

## Ask V capability parity

Ask V uses the same server capabilities, confirmation rules, and audit trail as the UI. A capability inventory and acceptance matrix cover every approved control across Gate, Work Hub, Files & Inventory, Search, notifications, History/report sending, Shift Notes/handoffs, Profile & Settings/compliance, and Gate Locations.

Each matrix row records:

- UI control and role visibility.
- Read, prepare, and execute tool names.
- Server authorization.
- Required confirmation fields.
- Version/idempotency behavior.
- Audit target.
- Web and native deep-link destination.
- Success, conflict, unavailable, and revoked-access behavior.

### Required corrections and additions

- Make the already-registered asset custody tools executable through the shared tool resolver; unknown or unsupported asset actions fail closed.
- Add canonical Work Hub tool-family aliases for `files-notes`, `inventory`, `tasks-forms`, `implementation-exports`, and settings/connections so native routing does not fall into a generic command family.
- Add shared web/native deep-link contracts for Inventory, Shift Notes, Profile & Settings, Gate, and the exact Search result destinations.
- Extend audit-target inference for file, asset, station, channel, task, occurrence, and export identifiers.
- Files tools distinguish reserved, uploaded, and finalized states and do not claim success before finalization.
- Search tools support the approved query/date/type filters and authorized inventory results.
- Export tools mirror the dataset role matrix and provide authorized preview/status/download behavior.
- Profile/compliance tools support safe reads and prepared/confirmed updates, including credential renewal/upload where the signed-in user is authorized.
- Gate-location tools are admin-only prepared/confirmed mutations with exact site, name, coordinates, and radius in the confirmation.
- Shift Notes remain read-first. Drafting or item creation is confirmation-bound; authentication and shift transfer remain explicit user flows.
- Notifications retain their gate-role taxonomy and add only the settings/actions already represented by the UI.

Ask V never receives camera controls in this release.

## Error handling and accessibility

- Unauthorized controls are absent, while revoked or stale targets show a neutral unavailable state without leaking content.
- Mutation conflicts show the current record and ask the user to refresh or reconfirm; they are not silently overwritten.
- File upload and custody actions preserve retry-safe idempotency.
- Cards, branded pills, inputs, maps, and dialogs meet touch-target, keyboard, focus, contrast, label, and screen-reader requirements on their supported surfaces.
- English and Spanish locale keys ship together and pass parity checks.

## Verification

### Focused coverage

- Files/notes capability rendering, ACLs, version conflicts, upload finalization, and empty states.
- Inventory response compatibility, list rendering, checkout/return/verification, holds, custody history, and role denials.
- Search filters, inventory inclusion, authorization, exact-item routing, and result states.
- Export card role matrix and identical preview/final authorization.
- Gate-location admin flow, multiple gates per site, geofence values, cross-organization denial, optimistic conflicts, and audit events.
- Ask V tool executability, confirmation, audit targets, aliases, deep links, and fail-closed behavior.
- iPhone/iPad layouts and Profile & Settings placement.

### Mandatory gates

- Typecheck.
- Web tests.
- Mobile tests and locale parity.
- Isolated API suite and schema checks.
- End-to-end browser checks.
- Accessibility review of new/changed surfaces.
- Whole-branch review of the exact release tree.

## Release boundary

After the unchanged release tree passes verification:

1. Commit the work and non-force advance `main` on GitHub.
2. Publish the web application.
3. Deploy the API and run only guarded additive production migrations.
4. Verify the public site, Gate surface, and API health.
5. Publish the production iOS OTA when runtime compatibility permits.
6. Build and submit the native iOS release to TestFlight.
7. Report each lane independently, including TestFlight submission versus Apple's later processing.

The release is not complete until the TestFlight submission succeeds.
