# Web Multi-Role and Gate Access Design

## Intent

Let a MidCon person hold several responsibilities at once without losing their normal portal access. A person may be an Admin, Office worker, Field Employee, Foreman, Gatekeeper, and Gate Supervisor at the same time. The web Employees page must display every assigned role and let an authorized administrator manage roles and site access for both direct MidCon employees and vendor-managed workers.

The change also removes the current mismatch where a MidCon Admin can enter Gate Mode but is rejected by Gate APIs. A MidCon Admin must be able to manage every active gate at every partner site MidCon is currently authorized to service, including creating gate locations, managing schedules, and covering an open shift. Ask V must enforce the same authority as the web UI.

## Release Scope

This is a web-and-API release only.

- Update the web Employees, Gate Mode, Work Hub scheduling, and Ask V surfaces.
- Add guarded, additive database structures and API support.
- Commit, advance `main` without force, deploy the web application and API, run guarded production migrations, and verify the live release.
- Do not modify mobile source, publish an iOS OTA update, or start a TestFlight build.
- Keep current mobile clients compatible with the API and their existing session fields.

## Role and Access Model

### Account authority

Organization Admin remains an account-level permission supplied by the active vendor membership. It is not downgraded to an operational tag.

A MidCon Admin automatically receives access to all current and future active sites that MidCon is authorized to service. The authorization still requires both a current vendor/site work assignment and an approved partner/vendor relationship. Admin authority never exposes unrelated partner sites.

### Operational roles

Direct vendor people may hold any combination of:

- Office
- Field Employee
- Foreman
- Gatekeeper
- Gate Supervisor

Admin is displayed alongside these roles when the active vendor membership is administrative. Multiple roles appear as separate role pills in the employee list.

Existing company-responsibility tags such as Driver and Visitor Notifications remain separate metadata. The UI labels them **Job responsibilities** so they are not mistaken for access-controlling roles.

### Site access

Direct non-admin employees receive explicit site access selected on the Employees page. Gatekeeper and Gate Supervisor actions are allowed only at the intersection of the person's operational role and assigned site access.

Admins do not require individual site rows. The Employees page displays their site access as **All authorized sites**, dynamically including future sites that MidCon becomes authorized to service.

Vendor-managed workers retain their existing site-scoped role-grant model. The API projects direct-worker and managed-worker grants into one normalized web response so the same editor and scheduler semantics apply to both.

## Persistence

Add two guarded, additive tables for direct vendor people:

1. `vendor_person_operational_roles`
   - vendor person
   - role
   - active status
   - grantor and timestamps
   - one active row per person and role

2. `vendor_person_site_access`
   - vendor person
   - site location
   - active status
   - grantor and timestamps
   - one active row per person and site

No existing role, person, membership, or history row is deleted. The migration backfills operational roles from `vendor_people.vendor_role`:

- `both` becomes Office plus Field Employee.
- Other recognized values become their corresponding operational role.
- Existing direct Gatekeeper and Gate Supervisor users receive site access for the vendor's currently assigned, approved service sites so the migration cannot silently remove their access.

The legacy `vendor_role` field remains as a backward-compatible projection for current mobile clients and older APIs. New authorization uses the normalized role set and site access. A deterministic compatibility projection chooses Admin/vendor, Office/vendor, Foreman/field, Field Employee/field, then Gate Supervisor or Gatekeeper when a single legacy persona is required.

## Central Authorization

Introduce one server-side vendor access resolver. It returns:

- account authority, including Admin;
- the complete operational-role set;
- explicitly assigned site IDs;
- dynamically inherited Admin site IDs;
- managed-subcontractor grants when applicable; and
- the effective legacy persona for backward compatibility.

All affected server paths use this resolver instead of comparing a single `vendorRole` string:

- Gate Mode site and gate discovery;
- gate-location create, edit, activate, and deactivate;
- Gate check-in, check-out, history, reports, and change-over;
- gate schedule creation and assignment;
- open-shift coverage and active-shift assumption;
- Work Hub gate scheduling and eligibility;
- Ask V Gate reads, writes, tool availability, and confirmations.

The resolver enforces these invariants:

- MidCon Admin may manage all MidCon-authorized sites and gates.
- Gate Supervisor may manage schedules and gate operations only at explicitly accessible sites.
- Gatekeeper may work or cover shifts only at explicitly accessible sites.
- Office, Field Employee, and Foreman do not gain Gate authority merely by holding those roles.
- Managed workers remain limited to their sponsor and site grants.
- Partner ownership and approved service relationships remain mandatory.

## Web Experience

### Employees page

Replace the single-role editing experience with one **Roles & Access** section:

- multi-select role pills;
- Gate Supervisor included;
- site-access selector for non-admin direct employees;
- inherited **All authorized sites** indicator for Admins;
- the existing managed-worker **Edit access** flow using the same labels and rules;
- multiple role pills and a concise site-access summary in the employee tables.

The old responsibility picker remains below this section as **Job responsibilities**.

### Portal routing

Users are not prompted to choose a role at every sign-in. Landing behavior is deterministic:

1. Admin or Office opens the vendor portal.
2. Foreman opens the foreman workspace.
3. Field Employee opens the field workspace.
4. A Gate-only worker opens Gate Mode.

Any authorized multi-role user can deliberately enter Gate Mode from the portal navigation. Returning from Gate Mode restores the normal portal.

### Gate Mode and scheduling

- Admin sees all active gates across all MidCon-authorized sites.
- Non-admin users see only gates at their assigned sites.
- Schedulers can select eligible direct or managed workers for a gate shift.
- Eligibility requires Gatekeeper or Gate Supervisor plus access to the gate's site, except Admin, whose site access is inherited.
- Admin, an authorized Gate Supervisor, or an eligible Gatekeeper may cover an open shift at an accessible gate.
- Role or site revocation blocks new assignments and new shift starts while preserving prior schedules, visits, handoffs, reports, and audit history.

## Ask V

Ask V consumes the same resolved access context as the REST APIs. It must not maintain a second role matrix.

For an authorized MidCon Admin, Ask V can prepare confirmed actions to:

- create or update a gate at an authorized service site;
- assign roles and site access;
- schedule eligible direct or managed workers;
- cover an open shift; and
- open the exact Gate or Work Hub destination.

Existing confirmation, idempotency, audit, and exact-scope rules remain mandatory. Ask V cannot grant access the signed-in user does not possess.

## API Contracts

The Employees API adds a normalized access object containing account roles, operational roles, effective site access, inherited-all-sites state, and compatibility persona. Mutation endpoints accept an expected version and the complete intended role/site set, apply the update atomically, and write an audit entry.

Responses keep current `vendorRole` and existing managed-worker fields so released mobile clients continue to work. New fields are additive.

Authorization failures use stable error codes that distinguish missing role, missing site access, inactive gate, and unapproved service relationship.

## Validation

Tests must cover:

- additive migration and preservation of existing users;
- multiple direct roles and multiple role pills;
- Admin inheritance for all current and future authorized sites;
- rejection of unrelated or unapproved partner sites;
- non-admin site scoping and revocation;
- direct and managed-worker scheduling eligibility;
- Admin, Gate Supervisor, and Gatekeeper open-shift coverage;
- Gate Mode discovery for Admin and scoped workers;
- gate-location creation at an authorized service site;
- Ask V parity with REST authorization;
- current mobile compatibility fields;
- bilingual web copy and locale parity; and
- full typecheck, web, API, migration replay, and browser regression gates.

## Deployment and Verification

After all required verification passes on the unchanged release tree:

1. Commit the implementation.
2. Push the feature branch and advance `main` non-force.
3. Publish the web application.
4. Deploy the API and run only guarded additive migrations.
5. Verify the live home page, Employees page, Gate Mode, gate-location flow, scheduling flow, Ask V authorization, and API health.

Do not publish mobile OTA or TestFlight for this release.
