import { Router, type IRouter } from "express";
import { eq, and, or, ne, sql, desc, asc, isNull, aliasedTable } from "drizzle-orm";
import { decodeSession } from "../lib/session";

import { SESSION_SECRET } from "../lib/session";

const COOKIE_NAME = "vndrly_session";
type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null };
function getSession(req: any): Session | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return null;
  const decoded = decodeSession(cookie);
  if (!decoded || typeof decoded.role !== "string" || decoded.userId == null) return null;
  return {
    userId: decoded.userId,
    role: decoded.role,
    vendorId: decoded.vendorId ?? null,
    partnerId: decoded.partnerId ?? null,
  };
}
import {
  db,
  ticketsTable,
  siteLocationsTable,
  vendorsTable,
  workTypesTable,
  fieldEmployeesTable,
  partnersTable,
  gpsLogsTable,
  ticketNoteLogsTable,
  ticketUnlocksTable,
  ticketLineItemsTable,
  taxRatesTable,
  usersTable,
  vendorPeopleTable,
  ticketCheckInsTable,
  ticketStatusHistoryTable,
  paymentAuditTable,
} from "@workspace/db";

// Returns the field-employee row for the current session, or null if not a field user.
async function getFieldEmployeeForSession(req: any) {
  const session = getSession(req);
  if (!session || session.role !== "field_employee") return null;
  const [fe] = await db
    .select({ id: vendorPeopleTable.id, vendorId: vendorPeopleTable.vendorId })
    .from(vendorPeopleTable)
    .where(and(
      eq(vendorPeopleTable.userId, session.userId),
      eq(vendorPeopleTable.isActive, true),
      isNull(vendorPeopleTable.deletedAt),
    ));
  return fe || null;
}

// Guards a ticket route — enforces that the caller has rights to the ticket.
// Admin sees any; vendor sees own vendor's tickets; partner sees tickets on their sites;
// field_employee sees only tickets assigned directly to them; all others are denied.
// Returns true to continue, false if a response was already sent.
async function ensureFieldOwnership(req: any, res: any, ticketId: number): Promise<boolean> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return false;
  }
  if (session.role === "admin") return true;

  const { loadFieldTicketAccessRow, fieldEmployeeCanAccessTicket } = await import(
    "../lib/field-ticket-access"
  );
  const t = await loadFieldTicketAccessRow(ticketId);

  if (!t) {
    res.status(404).json({ message: "Ticket not found", code: "ticket.not_found" });
    return false;
  }

  if (session.role === "vendor") {
    if (t.vendorId !== session.vendorId) {
      res.status(403).json({ message: "You do not have access to this ticket", code: "ticket.no_access" });
      return false;
    }
    return true;
  }

  if (session.role === "partner") {
    if (t.partnerId !== session.partnerId) {
      res.status(403).json({ message: "You do not have access to this ticket", code: "ticket.no_access" });
      return false;
    }
    return true;
  }

  if (session.role === "field_employee") {
    const fe = await getFieldEmployeeForSession(req);
    if (!fe) {
      res.status(403).json({ message: "Field account not active", code: "field.account_inactive" });
      return false;
    }
    const allowed = await fieldEmployeeCanAccessTicket(
      ticketId,
      { id: fe.id, vendorId: fe.vendorId, userId: session.userId },
      t,
    );
    if (!allowed) {
      res.status(403).json({ message: "You do not have access to this ticket", code: "ticket.no_access" });
      return false;
    }
    return true;
  }

  res.status(403).json({ message: "You do not have access to this ticket", code: "ticket.no_access" });
  return false;
}

const MUTABLE_TICKET_STATUSES = new Set([
  "initiated",
  "draft",
  "in_progress",
  "pending_review",
  "kicked_back",
]);

// ────────────────────────────────────────────────────────────────────────────
// Task #500 — Status-mutation guard checklist (READ BEFORE ADDING A ROUTE)
// Task #846 — Extended to cover PATCH and DELETE per-ticket endpoints.
//
// Task #494 introduced the partner→vendor invite handshake. Every endpoint
// below that mutates ticket status MUST refuse to act while the ticket is
// still in `awaiting_acceptance` or `denied` (see PRE_ACCEPT_STATUSES);
// otherwise a vendor could bypass the explicit Accept step and silently
// drive the ticket forward. The recognized ways to enforce this are:
//
//   • `ensureAccepted(req, res, id)` — generic gate; rejects 409 if the
//     ticket is in PRE_ACCEPT_STATUSES.
//   • `ensureTicketMutable(req, res, id)` — only allows MUTABLE_TICKET_STATUSES
//     (initiated/draft/in_progress/pending_review/kicked_back), which by
//     construction excludes pre-accept.
//   • A locally-declared allowlist (e.g. `CHECK_IN_ALLOWED`, `allowedStatus`)
//     that does not include `awaiting_acceptance` / `denied`.
//   • A direct equality check against `awaiting_acceptance` (e.g. /accept,
//     /deny CAS) — by definition only callable IN that state.
//   • `PRE_ACCEPT_STATUSES.has(...)` plus a role check (used by /cancel so
//     the inviting partner / admin can still retract a pending invite).
//   • `REINVITE_ELIGIBLE_STATUSES` (the partner-side reassignment policy).
//
// If a new endpoint cannot use any of the above (e.g. it's admin-only, or
// it is gated by a status that already excludes the pre-accept set such as
// `approved`, or — for PATCH/DELETE — its body schema cannot reach the
// `status` column at all), tag the route with a `@no-accept-guard:`
// comment that explains why. The meta unit test in
// `tickets-status-guard.test.ts` will otherwise fail and remind you to
// revisit this checklist.
//
// Scope of the meta lint (see tickets-status-guard.test.ts):
//   • `router.post("/tickets/:id/...")`
//   • `router.patch("/tickets/:id"...)` and `router.patch("/tickets/:id/...")`
//   • `router.delete("/tickets/:id/...")`
// PUT is intentionally not scanned because the codebase uses PATCH for
// partial updates; if that convention changes, broaden the regex.
//
// Current endpoint → guard mapping (keep this table in sync when you add
// a new POST/PATCH/DELETE /tickets/:id[/...] route):
//
//   POST   /tickets/:id/check-in                  CHECK_IN_ALLOWED
//   POST   /tickets/:id/en-route                  allowedStatus (initiated/draft/in_progress)
//   POST   /tickets/:id/check-out                 ensureAccepted
//   POST   /tickets/:id/submit                    ensureAccepted
//   POST   /tickets/:id/approve                   @no-accept-guard (admin/partner role + ne(status,"approved"))
//   POST   /tickets/:id/disperse-funds            @no-accept-guard (status must be approved | awaiting_payment)
//   POST   /tickets/:id/awaiting-payment          @no-accept-guard (per-actor allowedPreStates list)
//   POST   /tickets/:id/kickback                  ensureAccepted
//   POST   /tickets/:id/accept                    literal "awaiting_acceptance" CAS
//   POST   /tickets/:id/deny                      literal "awaiting_acceptance" CAS
//   POST   /tickets/:id/reinvite                  REINVITE_ELIGIBLE_STATUSES + CAS
//   POST   /tickets/:id/unlock                    @no-accept-guard (admin-only, status must be submitted | approved)
//   POST   /tickets/:id/cancel                    PRE_ACCEPT_STATUSES + role check (partner|admin)
//   POST   /tickets/:id/reactivate                @no-accept-guard (admin-only, status must be cancelled)
//   POST   /tickets/:id/note-logs                 ensureTicketMutable
//   POST   /tickets/:id/line-items                ensureTicketMutable
//   PATCH  /tickets/:id                           @no-accept-guard (UpdateTicketBody only exposes
//                                                 description/notes/fieldEmployeeId — `status` is not
//                                                 in the schema, so no transition is reachable here)
//   DELETE /tickets/:id/note-logs/:noteId         @no-accept-guard (soft-deletes a single note row;
//                                                 does not touch ticketsTable.status)
//   DELETE /tickets/:id/line-items/:lineItemId    ensureTicketMutable
// ────────────────────────────────────────────────────────────────────────────

// Task #494: states where the partner→vendor invite handshake has not yet
// settled. Vendors are not allowed to use any field-work endpoint
// (check-out/submit/kickback) on tickets in these states — they must
// /accept first. Cancel is also blocked from these states because the
// /deny endpoint is the proper way for a vendor to opt out.
const PRE_ACCEPT_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_acceptance",
  "denied",
]);

// Task #494: REINVITE_ELIGIBLE_STATUSES is the canonical list of statuses
// from which the owning partner may swap in a different vendor. Defined in
// `lib/intake-status.ts` so unit tests can pin the policy without importing
// route code.
import {
  computeInitialStatus,
  computeInitialLifecycleState,
  isOnSiteAtCreate,
  OFFICE_INTAKE_CHANNELS,
  REINVITE_ELIGIBLE_STATUSES,
  type IntakeChannel,
} from "../lib/intake-status";
import { getForemanVendorPersonId, userIsVendorOffice } from "../lib/office-role";
import {
  TICKET_EN_ROUTE_INVALID_STATE,
  TICKET_NOT_ACCEPTED,
  TICKET_NOT_AWAITING_ACCEPTANCE,
  TICKET_NOT_CHECKINABLE,
  TICKET_STATE_CHANGED,
} from "@workspace/ticket-state-conflict-codes";
import {
  FIELD_EMPLOYEE_VENDOR_MISMATCH,
  FOREMAN_FIELD_EMPLOYEE_MISMATCH,
  FOREMAN_VENDOR_MISMATCH,
} from "@workspace/crew-validation-codes";
import { OFF_GEOFENCE } from "@workspace/visit-error-codes";

// Returns true if the ticket has cleared the accept gate. If not, sends a
// 409 ticket_not_accepted response and returns false. Use at the top of any
// status-mutating endpoint that should not run during the invite phase.
async function ensureAccepted(req: any, res: any, ticketId: number): Promise<boolean> {
  const [t] = await db
    .select({ status: ticketsTable.status })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!t) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return false;
  }
  if (PRE_ACCEPT_STATUSES.has(t.status)) {
    res.status(409).json({
      error: TICKET_NOT_ACCEPTED,
      message: `Ticket is ${t.status.replace(/_/g, " ")}; it must be accepted before this action`,
    });
    return false;
  }
  return true;
}

// Task #572: when a field employee tries to advance a ticket whose
// vendor's site/work-type assignment was removed by the office while the
// ticket was already open, surface the same structured codes the
// new-ticket flow uses (`site_vendor_mismatch` /
// `work_type_not_allowed`) so the mobile ticket detail screen can show
// a friendly "your assignment was changed" banner instead of bubbling
// up a generic API error under the action button.
//
// Only applies to the `field_employee` role — admin / partner / vendor
// office callers may legitimately drive a ticket through its lifecycle
// for remediation after an assignment was pulled, so we skip the check
// for them. Returns true to continue, false if a response was already
// sent.
async function ensureFieldAssignmentForFieldEmployee(
  req: any,
  res: any,
  ticketId: number,
): Promise<boolean> {
  const session = getSession(req);
  if (!session || session.role !== "field_employee") return true;
  const [ticket] = await db
    .select({
      vendorId: ticketsTable.vendorId,
      siteLocationId: ticketsTable.siteLocationId,
      workTypeId: ticketsTable.workTypeId,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return false;
  }
  if (
    ticket.vendorId == null ||
    ticket.siteLocationId == null ||
    ticket.workTypeId == null
  ) {
    // Pre-existing rows missing one of these foreign keys can't be
    // validated against the assignment table — let the action proceed
    // rather than block the field employee with a confusing message
    // they have no way to act on.
    return true;
  }
  const [assignment] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(and(
      eq(siteWorkAssignmentsTable.vendorId, ticket.vendorId),
      eq(siteWorkAssignmentsTable.siteLocationId, ticket.siteLocationId),
      eq(siteWorkAssignmentsTable.workTypeId, ticket.workTypeId),
    ));
  if (assignment) return true;
  // Narrow the diagnosis with one extra read so the mobile banner can
  // tell the operator whether the site itself was pulled or just this
  // particular work type for the site. Mirrors the create-ticket
  // validation in `routes/field.ts` (Task #528) so the mobile client
  // can reuse the same error-handling path.
  const [vendorAssignment] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(and(
      eq(siteWorkAssignmentsTable.vendorId, ticket.vendorId),
      eq(siteWorkAssignmentsTable.siteLocationId, ticket.siteLocationId),
    ));
  if (!vendorAssignment) {
    res.status(400).json({
      code: "field_ticket.site_vendor_mismatch",
      error: "site_vendor_mismatch",
      message: "Your vendor is no longer assigned to work at this site.",
    });
    return false;
  }
  res.status(400).json({
    code: "field_ticket.work_type_not_allowed",
    error: "work_type_not_allowed",
    message: "Your vendor is no longer approved for this work type at this site.",
  });
  return false;
}

// Ensures the ticket is in a mutable state before allowing edits to its
// notes, photos, or line items. Returns true to continue, false if a
// response was already sent.
async function ensureTicketMutable(req: any, res: any, ticketId: number): Promise<boolean> {
  const [t] = await db
    .select({ status: ticketsTable.status })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!t) {
    res.status(404).json({ message: "Ticket not found", code: "ticket.not_found" });
    return false;
  }
  if (!MUTABLE_TICKET_STATUSES.has(t.status)) {
    res.status(409).json({
      message: `Ticket is ${t.status.replace(/_/g, " ")} and can no longer be edited`,
      code: "ticket.not_editable",
      status: t.status,
    });
    return false;
  }
  return true;
}

// Verifies the caller has read access to a specific site.
// Admin: unrestricted. Partner: must own the site (partnerId match).
// Vendor: must have an active assignment to the site.
// Field employee: looked up via vendor_people, then vendor must be assigned.
// All other authenticated roles are denied.
async function verifySiteAccess(
  req: any,
  res: any,
  sitePartnerId: number | null,
  siteId: number,
): Promise<boolean> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return false;
  }
  if (session.role === "admin") return true;

  if (session.role === "partner") {
    if (sitePartnerId !== session.partnerId) {
      res.status(403).json({ message: "Access denied", code: "site.no_access" });
      return false;
    }
    return true;
  }

  if (session.role === "vendor" && session.vendorId != null) {
    const [assignment] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, siteId),
          eq(siteWorkAssignmentsTable.vendorId, session.vendorId),
        ),
      );
    if (!assignment) {
      res.status(403).json({ message: "Access denied", code: "site.no_access" });
      return false;
    }
    return true;
  }

  if (session.role === "field_employee") {
    const fe = await getFieldEmployeeForSession(req);
    if (!fe) {
      res.status(403).json({ message: "Field account not active", code: "field.account_inactive" });
      return false;
    }
    const [assignment] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, siteId),
          eq(siteWorkAssignmentsTable.vendorId, fe.vendorId),
        ),
      );
    if (!assignment) {
      res.status(403).json({ message: "Access denied", code: "site.no_access" });
      return false;
    }
    return true;
  }

  res.status(403).json({ message: "Access denied", code: "site.no_access" });
  return false;
}

import {
  CreateTicketBody,
  GetTicketParams,
  GetTicketResponse,
  UpdateTicketParams,
  UpdateTicketBody,
  UpdateTicketResponse,
  ListTicketsQueryParams,
  ListTicketsResponse,
  CheckInTicketParams,
  CheckInTicketBody,
  CheckInTicketResponse,
  CheckOutTicketParams,
  CheckOutTicketBody,
  CheckOutTicketResponse,
  SubmitTicketParams,
  SubmitTicketResponse,
  ApproveTicketParams,
  ApproveTicketResponse,
  DisperseFundsTicketParams,
  DisperseFundsTicketBody,
  DisperseFundsTicketResponse,
  ReverseFundsDispersalParams,
  ReverseFundsDispersalBody,
  ReverseFundsDispersalResponse,
  ReverseDispersalParams,
  ReverseDispersalBody,
  ReverseDispersalResponse,
  KickbackTicketParams,
  KickbackTicketBody,
  KickbackTicketResponse,
  UnlockTicketParams,
  UnlockTicketBody,
  UnlockTicketResponse,
  GetTicketUnlocksParams,
  GetTicketUnlocksResponse,
  GetTicketTransitionsParams,
  GetTicketTransitionsResponse,
  GetVendorTransitionAggregateParams,
  GetVendorTransitionAggregateResponse,
  GetPartnerTransitionAggregateParams,
  GetPartnerTransitionAggregateResponse,
  GetAdminReassignmentAggregateResponse,
  CancelTicketParams,
  CancelTicketResponse,
  GetTicketGpsLogsParams,
  GetTicketGpsLogsResponse,
  GetTicketNoteLogsParams,
  GetTicketNoteLogsResponse,
  CreateTicketNoteLogParams,
  CreateTicketNoteLogBody,
  DeleteTicketNoteLogParams,
  GetPortalInfoParams,
  GetPortalInfoResponse,
  GetPortalOpenTicketsParams,
  GetPortalOpenTicketsQueryParams,
  GetPortalOpenTicketsResponse,
  GetTicketLineItemsParams,
  CreateTicketLineItemParams,
  CreateTicketLineItemBody,
  DeleteTicketLineItemParams,
  GetTaxRateByStateParams,
  GetDirectAwardCandidatesQueryParams,
  GetDirectAwardCandidatesResponse,
} from "@workspace/api-zod";
import { siteWorkAssignmentsTable, partnerVendorRelationshipsTable, vendorWorkTypesTable, hotlistJobsTable } from "@workspace/db";
import { sendResponse, sendResponseStatus } from "../lib/typed-response";
import { sendValidationFailed } from "../lib/validation-error";
import { notifyUsers, findVendorUserIds, findPartnerUserIds } from "./notifications";
import { sendPushToFieldEmployee } from "../lib/expo-push";
import { enqueueInvoiceGenerationForTicket } from "../lib/invoice-generator";
import { regenerateAutoLaborLines } from "../lib/auto-labor-lines";
import {
  recordTicketTransition,
  aggregateVendorTransitions,
  aggregatePartnerTransitions,
  aggregateAdminReassignments,
} from "../lib/ticket-transitions";
import {
  applyAuditTrailFilters,
  auditTrailCsvFilename,
  auditTrailToCsv,
  parseActorRoleFilter,
  parseDateBound,
  parseKindFilter,
  type AuditTrailFilters,
} from "../lib/audit-trail";
import { userHasApRole, findPartnerApContactEmails } from "../lib/ap-role";
import { sendPaymentReversedEmail } from "../lib/sendgrid";
import { enforceTicketsRateLimit } from "../lib/tickets-rate-limit";
import { radiusMilesBetween, isGeofenceBypassActive } from "../lib/geo";
import {
  checkComplianceFloor,
  getVendorTier,
  getVendorTiersBatch,
  isDirectAwardEligible,
} from "../lib/vendor-tier";
import {
  getCurrentTicketEventSeq,
  subscribeTicketEvents,
  type PublishedTicketEvent,
} from "../lib/ticket-events";
import { unreadTicketCommentCountSql } from "../lib/unread-comments";

const router: IRouter = Router();

const createdByUsersAlias = aliasedTable(usersTable, "created_by_users");
const closedByUsersAlias = aliasedTable(usersTable, "closed_by_users");
const paymentDispersedByUsersAlias = aliasedTable(usersTable, "payment_dispersed_by_users");

const ticketSelect = {
  id: ticketsTable.id,
  siteLocationId: ticketsTable.siteLocationId,
  vendorId: ticketsTable.vendorId,
  fieldEmployeeId: ticketsTable.fieldEmployeeId,
  workTypeId: ticketsTable.workTypeId,
  status: ticketsTable.status,
  description: ticketsTable.description,
  notes: ticketsTable.notes,
  kickbackReason: ticketsTable.kickbackReason,
  checkInTime: ticketsTable.checkInTime,
  checkOutTime: ticketsTable.checkOutTime,
  checkInLatitude: ticketsTable.checkInLatitude,
  checkInLongitude: ticketsTable.checkInLongitude,
  checkOutLatitude: ticketsTable.checkOutLatitude,
  checkOutLongitude: ticketsTable.checkOutLongitude,
  siteName: siteLocationsTable.name,
  vendorName: vendorsTable.name,
  vendorLogoUrl: vendorsTable.logoUrl,
  workTypeName: workTypesTable.name,
  fieldEmployeeName: sql<string | null>`CASE WHEN ${fieldEmployeesTable.firstName} IS NOT NULL THEN ${fieldEmployeesTable.firstName} || ' ' || ${fieldEmployeesTable.lastName} ELSE NULL END`,
  partnerName: partnersTable.name,
  partnerLogoUrl: partnersTable.logoUrl,
  createdAt: ticketsTable.createdAt,
  updatedAt: ticketsTable.updatedAt,
  unlockedAt: ticketsTable.unlockedAt,
  unlockedById: ticketsTable.unlockedById,
  unlockedByName: usersTable.displayName,
  unlockCount: ticketsTable.unlockCount,
  createdById: ticketsTable.createdById,
  createdByName: createdByUsersAlias.displayName,
  closedById: ticketsTable.closedById,
  closedByName: closedByUsersAlias.displayName,
  // Foreman / vendor-admin / org-admin pressed "Close Ticket" — running
  // [auto] labor lines are now frozen. Mobile uses this to hide the
  // Close button and to mark the ticket as locked in the UI.
  closedAt: ticketsTable.closedAt,
  lifecycleState: ticketsTable.lifecycleState,
  enRouteAt: ticketsTable.enRouteAt,
  arrivedAt: ticketsTable.arrivedAt,
  departureLatitude: ticketsTable.departureLatitude,
  departureLongitude: ticketsTable.departureLongitude,
  siteLatitude: siteLocationsTable.latitude,
  siteLongitude: siteLocationsTable.longitude,
  siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
  afe: siteWorkAssignmentsTable.afe,
  scheduledStartAt: ticketsTable.scheduledStartAt,
  scheduledDurationMinutes: ticketsTable.scheduledDurationMinutes,
  foremanUserId: ticketsTable.foremanUserId,
  // Source badge surface — Task #498. The web ticket list renders a small
  // globe/phone/boots icon based on this column so partners and vendors can
  // see at a glance where a ticket originated (partner self-service vs.
  // office phone-intake vs. field self-service).
  intakeChannel: ticketsTable.intakeChannel,
  // Funds Dispersed step (Task #497). All four payment columns flip
  // together inside the disperse-funds endpoint, so the read shape always
  // exposes them as a coherent set.
  paymentMethod: ticketsTable.paymentMethod,
  paymentReference: ticketsTable.paymentReference,
  paymentNote: ticketsTable.paymentNote,
  paymentDispersedAt: ticketsTable.paymentDispersedAt,
  paymentDispersedById: ticketsTable.paymentDispersedById,
  paymentDispersedByName: paymentDispersedByUsersAlias.displayName,
  // Task #865 — surface approvedAt on the list/detail read shape so the
  // partner AP queue can render "Approved on" / "Days waiting" columns
  // and default-sort by oldest-waiting without a second round-trip.
  // Stays populated after dispersal so the ticket history is preserved.
  approvedAt: ticketsTable.approvedAt,
  // Task #852 — optional proof-of-payment image attached at dispersal
  // time. Read alongside the rest of the payment columns so the Payment
  // Details panel on web + mobile can render the receipt thumbnail.
  paymentReceiptUrl: ticketsTable.paymentReceiptUrl,
  startingMileage: ticketsTable.startingMileage,
  endingMileage: ticketsTable.endingMileage,
};

// 1 mile fallback for sites whose `site_radius_meters` is NULL. Matches
// the partner-portal create-form default so legacy NULL rows behave the
// same as freshly-created sites until a partner explicitly tightens.
const DEFAULT_SITE_RADIUS_METERS = 1609;

function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Task #51 — `viewerUserId` controls the per-row `unreadCommentCount`
// subquery. Pass the signed-in viewer's userId on the list / detail
// endpoints (where the badge is rendered); other call sites that just
// need the freshly written ticket row back can pass `null` (or omit
// the argument) to skip the lookup, in which case the field is
// trivially 0 — the actor is the most recent author and isn't looking
// at a list.
function ticketQuery(viewerUserId: number | null = null) {
  return db
    .select({
      ...ticketSelect,
      unreadCommentCount: unreadTicketCommentCountSql(
        sql`${ticketsTable.id}`,
        viewerUserId,
      ),
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(vendorsTable, eq(ticketsTable.vendorId, vendorsTable.id))
    .leftJoin(workTypesTable, eq(ticketsTable.workTypeId, workTypesTable.id))
    .leftJoin(fieldEmployeesTable, eq(ticketsTable.fieldEmployeeId, fieldEmployeesTable.id))
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .leftJoin(usersTable, eq(ticketsTable.unlockedById, usersTable.id))
    .leftJoin(createdByUsersAlias, eq(ticketsTable.createdById, createdByUsersAlias.id))
    .leftJoin(closedByUsersAlias, eq(ticketsTable.closedById, closedByUsersAlias.id))
    .leftJoin(paymentDispersedByUsersAlias, eq(ticketsTable.paymentDispersedById, paymentDispersedByUsersAlias.id))
    .leftJoin(
      siteWorkAssignmentsTable,
      and(
        eq(siteWorkAssignmentsTable.siteLocationId, ticketsTable.siteLocationId),
        eq(siteWorkAssignmentsTable.workTypeId, ticketsTable.workTypeId),
        eq(siteWorkAssignmentsTable.vendorId, ticketsTable.vendorId),
      ),
    );
}

// ── Ticket events stream (SSE) — Task #622 ──
//
// Web counterpart to the mobile `ticket_unblocked` Expo push wired up
// in Task #592 / Task #613. The server publishes a `ticket.unblocked`
// event whenever the office restores a (vendor, site, work-type)
// assignment that re-opens an in-flight ticket; an open ticket-detail
// tab listens here and silently re-fetches the ticket so the
// assignment-removed banner (Task #593) clears the same instant the
// office made the change — no manual refresh, no waiting for the
// 7-second poll fallback (Task #607).
//
// Role scoping mirrors `/api/visits/events`:
//   - admin: every event
//   - vendor: only events for tickets where vendorId === session.vendorId
//   - partner: only events for tickets where partnerId === session.partnerId
//   - field_employee: events for their own vendor (matches the
//       mobile push's "your vendor's tickets" semantics so a foreman
//       viewing their crew member's ticket on the web also gets the
//       refresh hint).
//
// We also emit a one-shot `ticket.hello` with the current global
// sequence so reconnecting clients can detect dropped events via
// EventSource's built-in Last-Event-ID header — same gap-warning
// pattern the crew-map already relies on.
router.get("/tickets/events", (req, res): void => {
  const session = getSession(req);
  if (!session || session.role === "guest") {
    res
      .status(401)
      .json({ message: "Login required", code: "auth.required" });
    return;
  }

  const visible = (ev: PublishedTicketEvent): boolean => {
    if (session.role === "admin") return true;
    if (session.role === "vendor" || session.role === "field_employee") {
      if (!session.vendorId) return false;
      return ev.vendorId === session.vendorId;
    }
    if (session.role === "partner") {
      if (!session.partnerId) return false;
      return ev.partnerId === session.partnerId;
    }
    return false;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`: connected\n\n`);

  // EventSource auto-includes Last-Event-ID on reconnect when prior
  // events wrote `id:` lines. Compare the client's last seen seq
  // against the current global seq so we can warn the client they
  // may have missed events while disconnected.
  const lastEventIdHeader = req.header("Last-Event-ID");
  const lastSeenSeqRaw =
    lastEventIdHeader != null ? Number(lastEventIdHeader) : NaN;
  const lastSeenSeq = Number.isFinite(lastSeenSeqRaw) ? lastSeenSeqRaw : null;
  void getCurrentTicketEventSeq()
    .then((currentSeq) => {
      const gap = lastSeenSeq != null && currentSeq > lastSeenSeq;
      const hello = {
        type: "ticket.hello" as const,
        currentSeq,
        lastSeenSeq,
        gap,
      };
      try {
        res.write(`event: ticket.hello\n`);
        res.write(`data: ${JSON.stringify(hello)}\n\n`);
      } catch {
        /* client gone */
      }
    })
    .catch(() => {
      /* swallow — clients still get live events */
    });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 25000);

  const unsubscribe = subscribeTicketEvents((ev) => {
    if (!visible(ev)) return;
    try {
      if (typeof ev.seq === "number") {
        res.write(`id: ${ev.seq}\n`);
      }
      res.write(`event: ${ev.type}\n`);
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {
      /* client gone — cleanup happens on close */
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    try {
      res.end();
    } catch {
      /* already ended */
    }
  });
});

router.get("/portal/:siteCode", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }

  const params = GetPortalInfoParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "portal.invalid_site_code", error: "invalid_site_code" });
    return;
  }

  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteCode: siteLocationsTable.siteCode,
      state: siteLocationsTable.state,
      isActive: siteLocationsTable.isActive,
      status: siteLocationsTable.status,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
      afe: siteLocationsTable.afe,
      photoUrl: siteLocationsTable.photoUrl,
      partnerName: partnersTable.name,
      // Partner brand assets surfaced on the portal so QR-code field
      // employees see the site owner's branding even when their own auth
      // org is a vendor (Task #158). Selecting these here avoids a second
      // round-trip and keeps the portal page self-sufficient — the field
      // employee's `useBrand` context is keyed on their auth org and
      // would show their vendor brand otherwise.
      partnerLogoUrl: partnersTable.logoUrl,
      partnerLogoSquareUrl: partnersTable.logoSquareUrl,
      partnerBrandPrimaryColor: partnersTable.brandPrimaryColor,
      partnerBrandAccentColor: partnersTable.brandAccentColor,
      createdAt: siteLocationsTable.createdAt,
    })
    .from(siteLocationsTable)
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .where(eq(siteLocationsTable.siteCode, params.data.siteCode));

  if (!site) {
    res.status(404).json({
      code: "site.not_found",
      error: "site_not_found",
      message: "Site not found",
    });
    return;
  }
  if (!(await verifySiteAccess(req, res, site.partnerId, site.id))) return;

  // Use innerJoin so the row types stay non-nullable: workTypeId and
  // vendorId are NOT NULL foreign keys on site_work_assignments, so the
  // joined rows always exist. Using leftJoin here would widen Drizzle's
  // row type to `string | null` and conflict with the response schema's
  // non-nullable workTypeName/workTypeCategory/vendorName — exactly the
  // sort of drift that the typed-response bridge is designed to surface.
  const assignments = await db
    .select({
      id: siteWorkAssignmentsTable.id,
      siteLocationId: siteWorkAssignmentsTable.siteLocationId,
      workTypeId: siteWorkAssignmentsTable.workTypeId,
      vendorId: siteWorkAssignmentsTable.vendorId,
      workTypeName: workTypesTable.name,
      workTypeCategory: workTypesTable.category,
      vendorName: vendorsTable.name,
      afe: siteWorkAssignmentsTable.afe,
    })
    .from(siteWorkAssignmentsTable)
    .innerJoin(workTypesTable, eq(siteWorkAssignmentsTable.workTypeId, workTypesTable.id))
    .innerJoin(vendorsTable, eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id))
    .where(eq(siteWorkAssignmentsTable.siteLocationId, site.id));

  // Pull the partner brand fields off `site` so the SiteLocation payload
  // stays narrow (matches the shared SiteLocation schema). The brand block
  // is null when the site has no partner; we also include it when the
  // partner exists but every brand field is unset, so the client can read
  // partner.name even with no brand assets and still fall back cleanly to
  // the VNDRLY default colors.
  const {
    partnerLogoUrl,
    partnerLogoSquareUrl,
    partnerBrandPrimaryColor,
    partnerBrandAccentColor,
    ...siteLocation
  } = site;
  const partnerBrand = site.partnerId
    ? {
        id: site.partnerId,
        name: site.partnerName ?? "",
        logoUrl: partnerLogoUrl,
        logoSquareUrl: partnerLogoSquareUrl,
        brandPrimaryColor: partnerBrandPrimaryColor,
        brandAccentColor: partnerBrandAccentColor,
      }
    : null;

  sendResponse(res, GetPortalInfoResponse, {
    siteLocation,
    availableWorkTypes: assignments,
    partnerBrand,
  });
});

router.get("/portal/:siteCode/open-tickets", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }

  const params = GetPortalOpenTicketsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "portal.invalid_site_code", error: "invalid_site_code" });
    return;
  }
  const query = GetPortalOpenTicketsQueryParams.safeParse(req.query);

  const [site] = await db.select().from(siteLocationsTable).where(eq(siteLocationsTable.siteCode, params.data.siteCode));
  if (!site) {
    res.status(404).json({
      code: "site.not_found",
      error: "site_not_found",
      message: "Site not found",
    });
    return;
  }
  if (!(await verifySiteAccess(req, res, site.partnerId, site.id))) return;

  const conditions = [
    eq(ticketsTable.siteLocationId, site.id),
    sql`${ticketsTable.status} IN ('initiated', 'draft', 'in_progress', 'kicked_back')`,
  ];

  if (query.success && query.data.vendorId) {
    conditions.push(eq(ticketsTable.vendorId, query.data.vendorId));
  }

  // Portal viewers may be unauthenticated guests; pass session.userId
  // when present so signed-in partner staff still get accurate badge
  // counts on the per-site open-tickets list, and 0 otherwise.
  const tickets = await ticketQuery(session?.userId ?? null)
    .where(and(...conditions))
    .orderBy(desc(ticketsTable.createdAt));

  sendResponse(res, GetPortalOpenTicketsResponse, tickets);
});

router.get("/tickets", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }
  // Task #675: per-session rate limit so a buggy client (mashed
  // refresh, looping browser extension, runaway test script, etc.)
  // can't hammer the database. Default budget is high enough that
  // the normal poll + manual-refresh cadence never trips it; abuse
  // gets a 429 with Retry-After instead of slowing the whole org.
  if (!await enforceTicketsRateLimit(req, res, session)) return;

  const query = ListTicketsQueryParams.safeParse(req.query);
  const conditions: any[] = [];

  if (query.success) {
    if (query.data.status) conditions.push(eq(ticketsTable.status, query.data.status));
    if (query.data.siteLocationId) conditions.push(eq(ticketsTable.siteLocationId, query.data.siteLocationId));
    if (query.data.vendorId) conditions.push(eq(ticketsTable.vendorId, query.data.vendorId));
    if (query.data.partnerId) conditions.push(eq(siteLocationsTable.partnerId, query.data.partnerId));
    // AP queue toggle: status='approved' AND not yet dispersed. We anchor
    // on paymentDispersedAt rather than status='funds_dispersed' because
    // the column is the authoritative "money has moved" timestamp; status
    // alone could be loosened in the future without changing this filter.
    if (query.data.awaitingPayment) {
      conditions.push(eq(ticketsTable.status, "approved"));
      conditions.push(isNull(ticketsTable.paymentDispersedAt));
    }
  }

  // Enforce tenant scope based on role.
  if (session.role === "vendor" && session.vendorId != null) {
    conditions.push(eq(ticketsTable.vendorId, session.vendorId));
  } else if (session.role === "partner" && session.partnerId != null) {
    conditions.push(eq(siteLocationsTable.partnerId, session.partnerId));
  } else if (session.role === "field_employee") {
    // Field employees are scoped to their own assigned tickets only.
    const fe = await getFieldEmployeeForSession(req);
    if (!fe) {
      res.status(403).json({ message: "Field account not active", code: "field.account_inactive" });
      return;
    }
    conditions.push(eq(ticketsTable.vendorId, fe.vendorId));
    conditions.push(eq(ticketsTable.fieldEmployeeId, fe.id));
  } else if (session.role !== "admin") {
    // Unknown/unhandled roles see no tickets.
    sendResponse(res, ListTicketsResponse, []);
    return;
  }

  // Task #51 — pass the viewer so each row carries an accurate
  // `unreadCommentCount` for the badge on the tickets-list page.
  const tickets = conditions.length > 0
    ? await ticketQuery(session.userId).where(and(...conditions)).orderBy(desc(ticketsTable.createdAt))
    : await ticketQuery(session.userId).orderBy(desc(ticketsTable.createdAt));
  sendResponse(res, ListTicketsResponse, tickets);
});

router.post("/tickets", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }

  const parsed = CreateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  // Look up site so we can decide whether to auto-check-in and verify tenancy.
  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, parsed.data.siteLocationId));
  if (!site) {
    // Task #517: structured error code so the office intake form can
    // surface this inline on the site picker rather than showing the
    // generic "Failed to create phone intake ticket" toast.
    res.status(400).json({
      code: "site.not_found",
      error: "site_not_found",
      message: "Site not found.",
    });
    return;
  }

  // Enforce caller tenancy before inserting.
  let ticketVendorId: number | null = null;
  if (session.role === "vendor") {
    if (parsed.data.vendorId !== session.vendorId) {
      res.status(403).json({
        code: "ticket.vendor_mismatch",
        error: "ticket_vendor_mismatch",
        message: "Cannot create tickets for another vendor",
      });
      return;
    }
    ticketVendorId = session.vendorId;
  } else if (session.role === "field_employee") {
    const fe = await getFieldEmployeeForSession(req);
    if (!fe) {
      res.status(403).json({ message: "Field account not active", code: "field.account_inactive" });
      return;
    }
    if (parsed.data.vendorId !== fe.vendorId) {
      res.status(403).json({
        code: "ticket.vendor_mismatch",
        error: "ticket_vendor_mismatch",
        message: "Cannot create tickets for another vendor",
      });
      return;
    }
    ticketVendorId = fe.vendorId;
  } else if (session.role === "partner") {
    if (site.partnerId !== session.partnerId) {
      res.status(403).json({
        code: "ticket.partner_site_mismatch",
        error: "ticket_partner_site_mismatch",
        message: "Cannot create tickets for another partner's site",
      });
      return;
    }
  } else if (session.role !== "admin") {
    res.status(403).json({
      code: "ticket.insufficient_permissions",
      error: "ticket_insufficient_permissions",
      message: "Insufficient permissions",
    });
    return;
  }

  // For vendor and field_employee actors, require an active site assignment
  // (defense-in-depth: they cannot open tickets at sites they are not assigned to).
  // Task #517: this used to be a single site+vendor check that returned an
  // unstructured 403. We now split it into two structured codes so the
  // office intake form can surface them inline on the offending picker:
  //   * site_vendor_mismatch — the vendor has no assignment at this site
  //     at all (the site picker is wrong)
  //   * work_type_not_allowed — the vendor IS assigned to the site but
  //     not for this particular work type (the work-type picker is wrong)
  // Both are 400s now (body-vs-config mismatch, not a permissions issue
  // on the *user*) so the front end can lump them together with the
  // existing foreman_* codes when deciding whether to swallow the toast.
  if (ticketVendorId != null) {
    const [vendorAssignment] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, parsed.data.siteLocationId),
          eq(siteWorkAssignmentsTable.vendorId, ticketVendorId),
        ),
      );
    if (!vendorAssignment) {
      res.status(400).json({
        code: "field_ticket.site_vendor_mismatch",
        error: "site_vendor_mismatch",
        message: "Vendor is not assigned to work at this site.",
      });
      return;
    }
    const [workTypeAssignment] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, parsed.data.siteLocationId),
          eq(siteWorkAssignmentsTable.vendorId, ticketVendorId),
          eq(siteWorkAssignmentsTable.workTypeId, parsed.data.workTypeId),
        ),
      );
    if (!workTypeAssignment) {
      res.status(400).json({
        code: "field_ticket.work_type_not_allowed",
        error: "work_type_not_allowed",
        message:
          "Vendor is not approved for this work type at this site.",
      });
      return;
    }
  }

  const initialState = parsed.data.initialState ?? "on_site";
  const lat = parsed.data.checkInLatitude ?? null;
  const lng = parsed.data.checkInLongitude ?? null;

  const radius = site.siteRadiusMeters ?? DEFAULT_SITE_RADIUS_METERS;
  // Pre-compute the GPS-to-site distance once so we can both (a) decide
  // whether to auto-check-in below and (b) include it verbatim in the
  // off_geofence rejection payload (Task #145) without re-deriving.
  const metersFromSite =
    lat != null && lng != null
      ? distanceMeters(lat, lng, site.latitude, site.longitude)
      : null;
  // Demo bypass: when the bypass window is active (see lib/geo.ts) any
  // submitted coords are accepted as inside the geofence so office
  // create-with-on-site flows complete from anywhere during the demo.
  const insideGeofence =
    metersFromSite != null
      ? isGeofenceBypassActive() || metersFromSite <= radius
      : false;

  const now = new Date();

  const creatorSession = getSession(req);

  // ── Task #498: intake_channel resolution ─────────────────────────────
  //
  // Default channel comes from the actor's role:
  //   - partner role                              → partner_self_service
  //   - field_employee role                       → vendor_field_self_service
  //   - admin/vendor + fieldEmployeeId provided   → office_on_behalf_of_field_employee
  //   - admin/vendor + no fieldEmployeeId         → office_on_behalf_of_partner
  //
  // Callers may explicitly request an intake channel via body.intakeChannel;
  // we validate the actor is allowed to claim it and silently fall back to
  // the default if they're not (rather than 403'ing — the legitimate
  // creation still succeeds, it's the badge attribution that gets corrected).
  // The one strict rejection: a field_employee may NEVER claim an office_*
  // channel, since that would let a crew member fake the intake source.
  const defaultChannel: IntakeChannel =
    creatorSession?.role === "partner"
      ? "partner_self_service"
      : creatorSession?.role === "field_employee"
        ? "vendor_field_self_service"
        : parsed.data.fieldEmployeeId != null
          ? "office_on_behalf_of_field_employee"
          : "office_on_behalf_of_partner";

  let intakeChannel: IntakeChannel = defaultChannel;
  const requestedChannel = parsed.data.intakeChannel as
    | IntakeChannel
    | null
    | undefined;
  if (requestedChannel && requestedChannel !== defaultChannel) {
    const role = creatorSession?.role;
    let allowed = false;
    if (OFFICE_INTAKE_CHANNELS.has(requestedChannel)) {
      // Office channels: admin always; vendor sessions only if the user is
      // a vendor admin OR carries vendor_role IN ('office','both') on a
      // vendor_people row for the target vendor.
      if (role === "admin") {
        allowed = true;
      } else if (role === "vendor" && creatorSession?.userId != null) {
        allowed = await userIsVendorOffice(
          creatorSession.userId,
          parsed.data.vendorId,
        );
      }
    } else if (requestedChannel === "vendor_field_self_service") {
      // Only the field_employee themselves may self-serve under this badge.
      allowed = role === "field_employee";
    } else if (requestedChannel === "partner_self_service") {
      // Partners can claim psv at the same site they own; admins always.
      allowed = role === "admin" || role === "partner";
    }
    if (allowed) intakeChannel = requestedChannel;
    // Otherwise silently keep the default — see comment block above.
  }

  // Phone-intake gating (Task #498). The general "Create Job" button on
  // the vendor list pre-existed this task and is open to any vendor user;
  // we don't break that flow. But the *phone intake* affordances —
  // explicitly claiming an intakeChannel, marking acceptance as implicit,
  // or recording a caller name — must only be honored when the actor is
  // verifiably office staff (admin OR vendor_people.vendor_role IN
  // ('office','both')). For unauthorized callers we hard-reject with 403
  // rather than silently stripping fields so a misconfigured client gets
  // immediate, debuggable feedback (and so a non-office vendor cannot
  // fabricate caller-name attribution on tickets they entered themselves).
  const usedPhoneIntakeFields =
    parsed.data.intakeChannel != null ||
    parsed.data.acceptanceImplicit === true ||
    (typeof parsed.data.phoneIntakeCallerName === "string" &&
      parsed.data.phoneIntakeCallerName.trim().length > 0);
  let phoneIntakeAuthorized = creatorSession?.role === "admin";
  if (
    !phoneIntakeAuthorized &&
    creatorSession?.role === "vendor" &&
    creatorSession.userId != null
  ) {
    phoneIntakeAuthorized = await userIsVendorOffice(
      creatorSession.userId,
      parsed.data.vendorId,
    );
  }
  if (usedPhoneIntakeFields && !phoneIntakeAuthorized) {
    res.status(403).json({
      code: "ticket.phone_intake_role_required",
      error: "phone_intake_role_required",
      message:
        "Phone intake requires admin or vendor office role on the target vendor.",
    });
    return;
  }

  // Office_on_behalf_of_field_employee uses body.foremanUserId to mark the
  // named FE as the foreman on the new ticket. For vendor_field_self_service
  // the foreman is ALWAYS the creator themselves — never trust the body
  // here, since accepting it would let a field_employee impersonate
  // another foreman on their adjacent tickets. For office channels we
  // only honor body.foremanUserId after the office authz check above.
  let foremanUserId: number | null = null;
  if (intakeChannel === "vendor_field_self_service") {
    foremanUserId = creatorSession?.userId ?? null;
  } else if (
    intakeChannel === "office_on_behalf_of_field_employee" &&
    phoneIntakeAuthorized
  ) {
    foremanUserId = parsed.data.foremanUserId ?? null;
  } else if (creatorSession?.role === "admin") {
    // Admins can attribute foreman freely on any channel.
    foremanUserId = parsed.data.foremanUserId ?? null;
  }

  // Task #507: validate the resolved foremanUserId actually belongs to
  // the ticket's vendor. Without this a buggy or malicious client could
  // attribute a job to a foreman from a different vendor, polluting
  // reporting and timesheets. We additionally enforce that — when both
  // fieldEmployeeId and foremanUserId are set — they reference the SAME
  // vendor_people row, since office_on_behalf_of_field_employee means
  // "the named FE is also the foreman on this ticket".
  if (foremanUserId != null) {
    const foremanVpId = await getForemanVendorPersonId(
      foremanUserId,
      parsed.data.vendorId,
    );
    if (foremanVpId == null) {
      res.status(400).json({
        code: "ticket.foreman_vendor_mismatch",
        error: FOREMAN_VENDOR_MISMATCH,
        message: "Foreman user does not belong to the ticket's vendor.",
      });
      return;
    }
    if (
      parsed.data.fieldEmployeeId != null &&
      parsed.data.fieldEmployeeId !== foremanVpId
    ) {
      res.status(400).json({
        code: "ticket.foreman_field_employee_mismatch",
        error: FOREMAN_FIELD_EMPLOYEE_MISMATCH,
        message:
          "Foreman user must match the assigned field employee on this ticket.",
      });
      return;
    }
  }

  // Task #145: a field employee self-creating a ticket with
  // `initialState: "on_site"` is asserting they're physically at the
  // site. Refuse the create with the same structured `off_geofence`
  // payload the visitor public flow uses (`POST /api/visits/check-in`
  // — see routes/visits.ts) so the field web (`field-new-ticket.tsx`)
  // and mobile (`new-ticket.tsx`) screens can render the same
  // distance/radius message instead of silently downgrading the new
  // ticket to `pending_arrival`.
  //
  // Scope is intentionally narrow:
  //   • only the `vendor_field_self_service` channel — this is the FE
  //     fraud risk the task title calls out. Office channels
  //     (`office_on_behalf_of_*`) and `partner_self_service` are not
  //     asserting their own location, so we keep the existing silent
  //     downgrade for them.
  //   • only when GPS coords were actually supplied; without coords
  //     there's nothing to enforce against and the legacy "no GPS →
  //     pending_arrival" path still wins.
  //   • respects the `isGeofenceBypassActive()` demo escape hatch the
  //     visitor flow honours.
  if (
    intakeChannel === "vendor_field_self_service" &&
    initialState === "on_site" &&
    metersFromSite != null &&
    !insideGeofence
  ) {
    const distance = Math.round(metersFromSite);
    res.status(403).json({
      message: `You are too far from the site (${distance}m away, must be within ${radius}m).`,
      code: OFF_GEOFENCE,
      distanceMeters: distance,
      radiusMeters: radius,
    });
    return;
  }

  // Auto check-in only if the client said "on_site" AND we have GPS proving it.
  // If client said "pending_arrival", honor that even if they're inside the
  // geofence — they may still be in the parking lot prepping.
  // Task #494: partner self-service tickets MUST go through the vendor accept
  // gate, so we ignore any auto-check-in hint on that channel — the partner
  // user is creating on the vendor's behalf and cannot also "be on site" for
  // them. Office/field intake retain the auto-check-in optimization.
  const shouldCheckIn =
    intakeChannel !== "partner_self_service" &&
    initialState === "on_site" &&
    insideGeofence;

  // Default-status branching — see lib/intake-status.ts for the canonical
  // rule. office_on_behalf_of_partner respects body.acceptanceImplicit so
  // the office operator can mark "partner already coordinated" tickets as
  // bypassing the vendor accept gate (Task #498). Both acceptanceImplicit
  // and the phone-intake caller-name attribution below only take effect
  // when the actor is authorized for phone intake (admin OR office vendor
  // user) — otherwise we silently ignore them so a non-office vendor can't
  // bypass the accept gate or fabricate caller names.
  const acceptanceImplicit =
    parsed.data.acceptanceImplicit === true && phoneIntakeAuthorized;
  const initialStatus = computeInitialStatus(
    intakeChannel,
    shouldCheckIn,
    acceptanceImplicit,
  );
  const onSiteAtCreate = isOnSiteAtCreate(initialStatus, shouldCheckIn);
  const initialLifecycleState = computeInitialLifecycleState(
    initialStatus,
    shouldCheckIn,
  );

  // Phone intake captures the human caller's name on the initial transition
  // row so the front-office can later trace which caller opened a ticket
  // even if the office operator changed shifts. Format documented in the
  // ticket_status_history doc-comment: `phone_intake_caller:<name>`.
  const callerName =
    typeof parsed.data.phoneIntakeCallerName === "string" && phoneIntakeAuthorized
      ? parsed.data.phoneIntakeCallerName.trim()
      : "";
  const isOfficeIntake = OFFICE_INTAKE_CHANNELS.has(intakeChannel);
  const transitionReason = isOfficeIntake && callerName
    ? `phone_intake_caller:${callerName}`
    : shouldCheckIn
      ? "auto-check-in via geofence"
      : "ticket created";

  const ticket = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(ticketsTable)
      .values({
        siteLocationId: parsed.data.siteLocationId,
        vendorId: parsed.data.vendorId,
        fieldEmployeeId: parsed.data.fieldEmployeeId ?? null,
        workTypeId: parsed.data.workTypeId,
        description: parsed.data.description ?? null,
        status: initialStatus,
        intakeChannel,
        lifecycleState: initialLifecycleState,
        checkInTime: onSiteAtCreate ? now : null,
        arrivedAt: onSiteAtCreate ? now : null,
        checkInLatitude: shouldCheckIn ? lat : null,
        checkInLongitude: shouldCheckIn ? lng : null,
        createdById: creatorSession?.userId ?? null,
        foremanUserId,
        scheduledStartAt: parsed.data.scheduledStartAt
          ? new Date(parsed.data.scheduledStartAt)
          : undefined,
        scheduledDurationMinutes:
          parsed.data.scheduledDurationMinutes ?? undefined,
      })
      .returning();
    await recordTicketTransition({
      tx,
      ticketId: t.id,
      fromStatus: null,
      toStatus: initialStatus,
      actorUserId: creatorSession?.userId ?? null,
      actorRole: creatorSession?.role ?? null,
      reason: transitionReason,
    });
    return t;
  });

  if (shouldCheckIn && lat != null && lng != null) {
    await db.insert(gpsLogsTable).values({
      ticketId: ticket.id,
      latitude: lat,
      longitude: lng,
      eventType: "check_in",
    });
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, ticket.id));
  if (parsed.data.fieldEmployeeId) {
    void sendPushToFieldEmployee(parsed.data.fieldEmployeeId, {
      title: "New Tracking Assigned",
      body: `Tracking #${String(ticket.id).padStart(4, "0")} has been assigned to you.`,
      data: { ticketId: ticket.id, type: "ticket_assigned" },
    });
  }

  // Task #494: when a partner self-services a ticket, notify the invited
  // vendor's user accounts so they can Accept or Deny the work. Office and
  // field intake skip this — those tickets land in `initiated` and were
  // already coordinated with the vendor out-of-band.
  if (initialStatus === "awaiting_acceptance") {
    try {
      const vendorUserIds = await findVendorUserIds(ticket.vendorId);
      const trackingNumber = String(ticket.id).padStart(8, "0");
      await notifyUsers(vendorUserIds, {
        type: "ticket_invite_sent",
        title: "New ticket awaiting your acceptance",
        body: `${result?.partnerName ?? "A partner"} invited you to ticket #${trackingNumber} at ${result?.siteName ?? "their site"}. Accept or deny to proceed.`,
        link: `/tickets/${ticket.id}`,
      });
    } catch (e) {
      console.error("[tickets] failed to notify vendor of new invite", e);
    }
  }

  sendResponseStatus(res, 201, GetTicketResponse, result);
});

router.get("/tickets/:id", async (req, res): Promise<void> => {
  const params = GetTicketParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  // Task #675: same per-session rate limit as the list endpoint. The
  // detail page polls more aggressively (e.g. when the assignment-removed
  // banner is up it refetches every 7s), so we apply the same budget so
  // a single tab can't sit on a tight loop and overwhelm the database.
  // We rate-limit BEFORE ensureFieldOwnership so an attacker scanning
  // detail ids also gets throttled.
  const detailSessionForLimit = getSession(req);
  if (!await enforceTicketsRateLimit(req, res, detailSessionForLimit)) return;
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  // Task #51 — pass the viewer so the response carries an accurate
  // `unreadCommentCount`. The thread fetch on this page calls
  // `markAllSeen`, so the badge will clear on the next list refresh.
  const [ticket] = await ticketQuery(detailSessionForLimit?.userId ?? null)
    .where(eq(ticketsTable.id, params.data.id));
  if (!ticket) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return;
  }
  // Task #497: surface a viewer-derived capability so the web/mobile UI can
  // hide the Disperse Funds action from non-AP partners (server still
  // re-checks on POST). Admins always pass; partner viewers must hold the
  // AP role on their own partner — and ensureFieldOwnership above has
  // already verified the ticket belongs to detailSession.partnerId, so we
  // use that as the authoritative partner id rather than re-deriving it
  // from the joined ticket row (which doesn't select partnerId).
  const detailSession = getSession(req);
  let viewerCanDisperseFunds = false;
  if (detailSession) {
    if (detailSession.role === "admin") {
      viewerCanDisperseFunds = true;
    } else if (
      detailSession.role === "partner" &&
      detailSession.userId &&
      detailSession.partnerId
    ) {
      viewerCanDisperseFunds = await userHasApRole(
        detailSession.userId,
        detailSession.partnerId,
      );
    }
  }
  // Task #853 — Reverse-dispersal capability flag. Same authority gate as
  // disperse-funds (admin OR partner-AP), but additionally constrained to
  // tickets that are *currently* `funds_dispersed` so the web/mobile
  // ticket detail panels can hide the "Reverse dispersal" link the moment
  // the ticket is no longer in that state. The server still re-checks
  // role + status on POST — this flag is purely UI affordance.
  const viewerCanReverseDispersal =
    viewerCanDisperseFunds && ticket.status === "funds_dispersed";
  // Task #508: surface the office phone-intake caller name on the ticket
  // detail timeline. The reason is persisted on the initial transition row
  // as `phone_intake_caller:<name>` (see POST /tickets above). We read the
  // earliest history row for the ticket and only keep its caller-name
  // payload when it has the documented prefix — this guarantees we never
  // mistake an unrelated reason ("auto-check-in via geofence",
  // "ticket created", a kickback note, …) for a caller name even if that
  // row happens to be the oldest. List endpoints intentionally skip this
  // extra read; the ticket-detail page is the only consumer per spec.
  const [initialTransition] = await db
    .select({ reason: ticketStatusHistoryTable.reason })
    .from(ticketStatusHistoryTable)
    .where(eq(ticketStatusHistoryTable.ticketId, params.data.id))
    .orderBy(asc(ticketStatusHistoryTable.createdAt), asc(ticketStatusHistoryTable.id))
    .limit(1);
  const PHONE_INTAKE_PREFIX = "phone_intake_caller:";
  const phoneIntakeCallerName =
    initialTransition?.reason && initialTransition.reason.startsWith(PHONE_INTAKE_PREFIX)
      ? initialTransition.reason.slice(PHONE_INTAKE_PREFIX.length).trim() || null
      : null;
  sendResponse(res, GetTicketResponse, {
    ...ticket,
    viewerCanDisperseFunds,
    viewerCanReverseDispersal,
    phoneIntakeCallerName,
  });
});

// @no-accept-guard: Task #846 — UpdateTicketBody only exposes
// `description`, `notes`, and `fieldEmployeeId`. The `status` column is
// not in the schema, so this endpoint cannot transition a ticket out of
// `awaiting_acceptance` / `denied`. If a future revision of
// UpdateTicketBody adds `status` (or any other field that drives a
// transition), drop this opt-out and gate the route with
// `ensureAccepted` / `ensureTicketMutable` per the Task #500 checklist
// at the top of this file.
router.patch("/tickets/:id", async (req, res): Promise<void> => {
  const params = UpdateTicketParams.safeParse(req.params);
  if (!params.success) {
    // Task #533: structured code so the inline edit form on web/mobile can
    // show a localized "That ticket id is invalid" message instead of the
    // raw Zod sentence.
    sendValidationFailed(res, params.error, { code: "ticket.invalid_ticket_id", error: "invalid_ticket_id" });
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  const parsed = UpdateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    // Task #533: keep the Zod issue list in `message` for developer tooling
    // but tag the response with a stable code so the UI can render a
    // catalog-translated banner.
    sendValidationFailed(res, parsed.error, { code: "ticket.invalid_update_body", error: "invalid_update_body" });
    return;
  }
  // Task #527: validate that a reassigned field employee actually belongs
  // to this ticket's vendor. Without this guard the PATCH would silently
  // assign a worker from a different vendor — the mobile app and field
  // dashboards would then refuse to show the ticket to that worker because
  // ensureFieldOwnership requires a matching vendor membership.
  const [existingTicket] = await db
    .select({
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      vendorId: ticketsTable.vendorId,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, params.data.id));
  if (
    parsed.data.fieldEmployeeId != null &&
    existingTicket?.vendorId != null
  ) {
    const [fe] = await db
      .select({ vendorId: vendorPeopleTable.vendorId })
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.id, parsed.data.fieldEmployeeId),
          isNull(vendorPeopleTable.deletedAt),
        ),
      );
    if (!fe || fe.vendorId !== existingTicket.vendorId) {
      res.status(400).json({
        code: "ticket.field_employee_vendor_mismatch",
        error: FIELD_EMPLOYEE_VENDOR_MISMATCH,
        message:
          "Selected field employee does not belong to this ticket's vendor.",
      });
      return;
    }
  }
  const [updated] = await db.update(ticketsTable).set(parsed.data).where(eq(ticketsTable.id, params.data.id)).returning();
  if (!updated) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  // Push to field employee when newly assigned via PATCH.
  if (
    parsed.data.fieldEmployeeId &&
    parsed.data.fieldEmployeeId !== existingTicket?.fieldEmployeeId
  ) {
    void sendPushToFieldEmployee(parsed.data.fieldEmployeeId, {
      title: "Tracking Assigned",
      body: `Tracking #${String(updated.id).padStart(4, "0")} has been assigned to you.`,
      data: { ticketId: updated.id, type: "ticket_assigned" },
    });
  }
  sendResponse(res, UpdateTicketResponse, result);
});

router.post("/tickets/:id/check-in", async (req, res): Promise<void> => {
  const params = CheckInTicketParams.safeParse(req.params);
  if (!params.success) {
    // Task #533: stable code for the mobile arrival screen.
    sendValidationFailed(res, params.error, { code: "ticket.invalid_id", error: "invalid_ticket_id" });
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  // Task #572: surface site_vendor_mismatch / work_type_not_allowed if
  // the office removed the vendor's assignment after the field employee
  // already opened this ticket. The mobile screen shows a friendly
  // "assignment changed" banner for those codes instead of pinning a
  // generic error inline under Check In.
  if (!(await ensureFieldAssignmentForFieldEmployee(req, res, params.data.id))) return;
  const parsed = CheckInTicketBody.safeParse(req.body);
  if (!parsed.success) {
    // Task #533: covers missing/non-numeric latitude/longitude — the
    // mobile app shows this inline next to the GPS-fetch button.
    sendValidationFailed(res, parsed.error, { code: "ticket.invalid_check_in_body", error: "invalid_check_in_body" });
    return;
  }

  const now = new Date();
  const checkInSession = getSession(req);

  // Task #145: enforce the same site-radius geofence the visitor public
  // flow uses (`POST /api/visits/check-in`, see routes/visits.ts) so the
  // mobile ticket detail screen (`app/ticket/[id].tsx`) can render the
  // shared `tickets.offGeofence` distance/radius copy on a refused
  // check-in. Done as a pre-flight read before the status CAS so we
  // don't waste a transaction round-trip for a request that will be
  // rejected anyway. The `isGeofenceBypassActive()` demo escape hatch
  // is honoured to match the visitor parity.
  const [siteForGeofence] = await db
    .select({
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
    })
    .from(siteLocationsTable)
    .innerJoin(ticketsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, params.data.id));
  if (siteForGeofence) {
    const radius =
      siteForGeofence.siteRadiusMeters ?? DEFAULT_SITE_RADIUS_METERS;
    const meters = distanceMeters(
      parsed.data.latitude,
      parsed.data.longitude,
      siteForGeofence.latitude,
      siteForGeofence.longitude,
    );
    if (meters > radius && !isGeofenceBypassActive()) {
      const distance = Math.round(meters);
      res.status(403).json({
        message: `You are too far from the site (${distance}m away, must be within ${radius}m).`,
        code: OFF_GEOFENCE,
        distanceMeters: distance,
        radiusMeters: radius,
      });
      return;
    }
  }

  // Task #494: a vendor cannot check in to a ticket that is still pending
  // their acceptance, that they have denied, or that has already been closed
  // out. Allow only the in-flight pre-checkout statuses.
  const CHECK_IN_ALLOWED: ReadonlySet<string> = new Set([
    "draft",
    "initiated",
    "in_progress",
    "on_route",
    "kicked_back",
  ]);

  const checkInResult = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ arrivedAt: ticketsTable.arrivedAt, status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, params.data.id));
    if (!existing) return { kind: "not_found" as const };
    if (!CHECK_IN_ALLOWED.has(existing.status)) {
      return { kind: "blocked" as const, status: existing.status };
    }
    const [u] = await tx
      .update(ticketsTable)
      .set({
        status: "in_progress",
        lifecycleState: "on_site",
        checkInTime: now,
        checkInLatitude: parsed.data.latitude,
        checkInLongitude: parsed.data.longitude,
        arrivedAt: existing.arrivedAt ?? now,
      })
      .where(eq(ticketsTable.id, params.data.id))
      .returning();
    if (u && existing.status !== "in_progress") {
      await recordTicketTransition({
        tx,
        ticketId: u.id,
        fromStatus: existing.status,
        toStatus: "in_progress",
        actorUserId: checkInSession?.userId ?? null,
        actorRole: checkInSession?.role ?? null,
        reason: "check-in",
      });
    }
    return { kind: "ok" as const, ticket: u };
  });

  if (checkInResult.kind === "not_found") {
    // Task #533: lift to the standard {code, error, message} shape used by
    // every other mutation 404 in this file so the inline error UI can
    // surface a translated string.
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (checkInResult.kind === "blocked") {
    res.status(409).json({
      code: "ticket.not_checkinable",
      error: TICKET_NOT_CHECKINABLE,
      message: `Ticket is ${checkInResult.status.replace(/_/g, " ")} and cannot be checked in`,
    });
    return;
  }
  const updated = checkInResult.ticket;
  if (!updated) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }

  await db.insert(gpsLogsTable).values({
    ticketId: updated.id,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    eventType: "check_in",
  });

  // Dual-write to ticket_check_ins for the primary field employee, if any.
  if (updated.fieldEmployeeId) {
    const [existingOpen] = await db
      .select({ id: ticketCheckInsTable.id })
      .from(ticketCheckInsTable)
      .where(and(
        eq(ticketCheckInsTable.ticketId, updated.id),
        eq(ticketCheckInsTable.employeeId, updated.fieldEmployeeId),
        isNull(ticketCheckInsTable.checkOutAt),
      ));
    if (!existingOpen) {
      const [emp] = await db
        .select({ hourlyRate: vendorPeopleTable.hourlyRate })
        .from(vendorPeopleTable)
        .where(eq(vendorPeopleTable.id, updated.fieldEmployeeId));
      await db.insert(ticketCheckInsTable).values({
        ticketId: updated.id,
        employeeId: updated.fieldEmployeeId,
        checkInAt: now,
        checkInLatitude: parsed.data.latitude,
        checkInLongitude: parsed.data.longitude,
        hourlyRateAtTime: emp?.hourlyRate ?? null,
        source: "auto",
      });
    }
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  sendResponse(res, CheckInTicketResponse, result);
});

router.post("/tickets/:id/en-route", async (req, res): Promise<void> => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) {
    res.status(400).json({ error: "invalid_ticket_id", message: "Invalid ticket id" });
    return;
  }
  if (!(await ensureFieldOwnership(req, res, idNum))) return;
  // Task #572: same assignment-removed handling as check-in/check-out/submit.
  if (!(await ensureFieldAssignmentForFieldEmployee(req, res, idNum))) return;

  // Only allow en-route while ticket is still pre-arrival or already en-route.
  const [existing] = await db
    .select({
      status: ticketsTable.status,
      lifecycleState: ticketsTable.lifecycleState,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, idNum));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  const allowedLifecycle: Array<string | null> = [
    "pending_arrival",
    "en_route",
    null,
  ];
  const allowedStatus: string[] = ["initiated", "draft", "in_progress"];
  if (
    !allowedLifecycle.includes(existing.lifecycleState) ||
    !allowedStatus.includes(existing.status)
  ) {
    // Task #527: keep the legacy `code: ticket.en_route_invalid_state` so
    // the mobile app's existing translator entry still resolves; add the
    // structured `error` field in snake_case so the new code-based
    // contract from Task #517 applies here too.
    res.status(409).json({
      error: TICKET_EN_ROUTE_INVALID_STATE,
      code: "ticket.en_route_invalid_state",
      message: "Ticket is not in a state that allows en route",
    });
    return;
  }

  const lat =
    typeof req.body?.latitude === "number" ? req.body.latitude : null;
  const lng =
    typeof req.body?.longitude === "number" ? req.body.longitude : null;

  // T004: starting odometer is captured the moment the field employee
  // presses "En Route". Optional — the mobile UI lets the crew skip the
  // prompt — but if a value is sent it must be a non-negative finite
  // number (we round to 1 decimal to match the numeric(10,1) column).
  // Idempotency: re-pressing "En Route" overwrites the prior value so
  // the crew can correct a typo without admin help.
  let startingMileage: string | null | undefined = undefined;
  if (req.body?.startingMileage != null) {
    const n = Number(req.body.startingMileage);
    if (!Number.isFinite(n) || n < 0) {
      res.status(400).json({
        code: "ticket.starting_mileage_invalid",
        error: "starting_mileage_invalid",
        message: "Starting mileage must be a non-negative number",
      });
      return;
    }
    startingMileage = (Math.round(n * 10) / 10).toFixed(1);
  }

  const [updated] = await db
    .update(ticketsTable)
    .set({
      lifecycleState: "en_route",
      enRouteAt: new Date(),
      departureLatitude: lat,
      departureLongitude: lng,
      ...(startingMileage !== undefined ? { startingMileage } : {}),
    })
    .where(eq(ticketsTable.id, idNum))
    .returning();

  if (!updated) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return;
  }

  if (lat != null && lng != null) {
    await db.insert(gpsLogsTable).values({
      ticketId: updated.id,
      latitude: lat,
      longitude: lng,
      eventType: "en_route",
    });
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  const dest =
    result?.siteLatitude != null && result?.siteLongitude != null
      ? `${result.siteLatitude},${result.siteLongitude}`
      : encodeURIComponent(result?.siteName ?? "");
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  res.json({ ticket: result, mapsUrl });
});

// POST /tickets/:id/on-location — vendor pressed "On Location": they have
// arrived at the site but are not yet on the clock. Distinct from check-in
// (which starts billing hours). Allowed transitions:
//   lifecycle: pending_arrival | en_route | on_location | null
//   status:    initiated | draft | in_progress
// Idempotent — pressing it twice just refreshes onLocationAt + coords.
router.post("/tickets/:id/on-location", async (req, res): Promise<void> => {
  const idNum = Number(req.params.id);
  if (!Number.isFinite(idNum)) {
    res.status(400).json({ error: "invalid_ticket_id", message: "Invalid ticket id" });
    return;
  }
  if (!(await ensureFieldOwnership(req, res, idNum))) return;
  if (!(await ensureFieldAssignmentForFieldEmployee(req, res, idNum))) return;

  const [existing] = await db
    .select({
      status: ticketsTable.status,
      lifecycleState: ticketsTable.lifecycleState,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, idNum));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  const allowedLifecycle: Array<string | null> = [
    "pending_arrival",
    "en_route",
    "on_location",
    null,
  ];
  const allowedStatus: string[] = ["initiated", "draft", "in_progress"];
  if (
    !allowedLifecycle.includes(existing.lifecycleState) ||
    !allowedStatus.includes(existing.status)
  ) {
    res.status(409).json({
      error: "on_location_invalid_state",
      code: "ticket.on_location_invalid_state",
      message: "Ticket is not in a state that allows on-location",
    });
    return;
  }

  const lat =
    typeof req.body?.latitude === "number" ? req.body.latitude : null;
  const lng =
    typeof req.body?.longitude === "number" ? req.body.longitude : null;

  const [updated] = await db
    .update(ticketsTable)
    .set({
      lifecycleState: "on_location",
      onLocationAt: new Date(),
      onLocationLatitude: lat,
      onLocationLongitude: lng,
    })
    .where(eq(ticketsTable.id, idNum))
    .returning();

  if (!updated) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return;
  }

  if (lat != null && lng != null) {
    await db.insert(gpsLogsTable).values({
      ticketId: updated.id,
      latitude: lat,
      longitude: lng,
      eventType: "on_location",
    });
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  res.json({ ticket: result });
});

router.post("/tickets/:id/check-out", async (req, res): Promise<void> => {
  const params = CheckOutTicketParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  // Task #494: cannot check out a ticket that has not been accepted yet.
  if (!(await ensureAccepted(req, res, params.data.id))) return;
  // Bug #2 fix: lifecycle ordering — vendor cannot check out before
  // they have checked in. Status must be `in_progress` (set by the
  // /check-in handler). Without this gate the vendor could POST
  // /check-out straight from `initiated` and skip the on-the-clock
  // window entirely, which breaks labor auto-fill and GPS reconcile.
  {
    const [t] = await db
      .select({ status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, params.data.id));
    if (t && t.status !== "in_progress") {
      res.status(409).json({
        code: "ticket.not_checked_in",
        error: "ticket_not_checked_in",
        message: `Ticket is ${t.status.replace(/_/g, " ")}; it must be checked in before check-out`,
      });
      return;
    }
  }
  // Task #572: surface assignment-removed banner on the mobile screen
  // when the office pulls the vendor's site/work-type assignment mid-job.
  if (!(await ensureFieldAssignmentForFieldEmployee(req, res, params.data.id))) return;
  const parsed = CheckOutTicketBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }

  const closerSession = getSession(req);
  const newCheckOutStatus = parsed.data.workCompleted ? "completed" : "pending_review";

  // T004: ending odometer captured at check-out. Optional and validated
  // the same way as the starting reading on /en-route. We additionally
  // require ending >= starting *when both are present* to catch obvious
  // typos at the source — partial entries (only end, only start) are
  // tolerated because field crews sometimes forget the start reading
  // and we'd rather have one value than zero.
  let endingMileage: string | null | undefined = undefined;
  const rawEnd = (req.body as { endingMileage?: unknown } | undefined)?.endingMileage;
  if (rawEnd != null) {
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n < 0) {
      res.status(400).json({
        code: "ticket.ending_mileage_invalid",
        error: "ending_mileage_invalid",
        message: "Ending mileage must be a non-negative number",
      });
      return;
    }
    const [priorMileage] = await db
      .select({ start: ticketsTable.startingMileage })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, params.data.id));
    const startNum = priorMileage?.start != null ? Number(priorMileage.start) : null;
    if (startNum != null && Number.isFinite(startNum) && n < startNum) {
      res.status(400).json({
        code: "ticket.ending_mileage_below_start",
        error: "ending_mileage_below_start",
        message: "Ending mileage cannot be less than starting mileage",
      });
      return;
    }
    endingMileage = (Math.round(n * 10) / 10).toFixed(1);
  }

  const updated = await db.transaction(async (tx) => {
    const [priorCheckOut] = await tx
      .select({ status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, params.data.id));
    const [u] = await tx
      .update(ticketsTable)
      .set({
        status: newCheckOutStatus,
        lifecycleState: "off_site",
        checkOutTime: new Date(),
        checkOutLatitude: parsed.data.latitude,
        checkOutLongitude: parsed.data.longitude,
        closedById: closerSession?.userId ?? null,
        ...(endingMileage !== undefined ? { endingMileage } : {}),
      })
      .where(eq(ticketsTable.id, params.data.id))
      .returning();
    if (u && priorCheckOut && priorCheckOut.status !== newCheckOutStatus) {
      await recordTicketTransition({
        tx,
        ticketId: u.id,
        fromStatus: priorCheckOut.status,
        toStatus: newCheckOutStatus,
        actorUserId: closerSession?.userId ?? null,
        actorRole: closerSession?.role ?? null,
        reason: parsed.data.workCompleted ? "check-out (work completed)" : "check-out (pending review)",
      });
    }
    return u;
  });

  if (!updated) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return;
  }

  if (parsed.data.latitude != null && parsed.data.longitude != null) {
    await db.insert(gpsLogsTable).values({
      ticketId: updated.id,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      eventType: "check_out",
    });
  }

  // Dual-write: close any open ticket_check_ins for primary field employee.
  if (updated.fieldEmployeeId) {
    await db.update(ticketCheckInsTable)
      .set({
        checkOutAt: new Date(),
        checkOutLatitude: parsed.data.latitude,
        checkOutLongitude: parsed.data.longitude,
      })
      .where(and(
        eq(ticketCheckInsTable.ticketId, updated.id),
        eq(ticketCheckInsTable.employeeId, updated.fieldEmployeeId),
        isNull(ticketCheckInsTable.checkOutAt),
      ));
  }

  // Auto-generate labor line items so the vendor sees their hours rolled up
  // into Parts & Labor immediately after check-out. Best-effort: a failure
  // here must not block the check-out response. The same logic also runs
  // when the operator presses "Generate" on the web crew-time UI, and
  // re-running it is idempotent (it replaces "[auto]" rows in place).
  try {
    await regenerateAutoLaborLines(updated.id);
  } catch (err) {
    req.log.error({ err, ticketId: updated.id }, "auto labor line generation failed on check-out");
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  sendResponse(res, CheckOutTicketResponse, result);
});

router.post("/tickets/:id/submit", async (req, res): Promise<void> => {
  const params = SubmitTicketParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  // Task #494: cannot submit work on a ticket that has not been accepted yet.
  if (!(await ensureAccepted(req, res, params.data.id))) return;
  // Task #572: same assignment-removed handling as the other state changes.
  if (!(await ensureFieldAssignmentForFieldEmployee(req, res, params.data.id))) return;

  // Guard: refuse if any crew member is still checked in (would produce
  // runaway hours). Caller can pass ?force=true to override (after explicit
  // confirmation in the UI).
  if (req.query.force !== "true") {
    const open = await db
      .select({ employeeId: ticketCheckInsTable.employeeId })
      .from(ticketCheckInsTable)
      .where(and(
        eq(ticketCheckInsTable.ticketId, params.data.id),
        isNull(ticketCheckInsTable.checkOutAt),
      ));
    if (open.length > 0) {
      res.status(409).json({
        code: "ticket.open_crew_sessions",
        error: "open_crew_sessions",
        message: `${open.length} crew member(s) are still checked in. Check them out (or pass force=true) before submitting.`,
        openEmployeeIds: open.map(o => o.employeeId),
      });
      return;
    }
  }

  const submitSession = getSession(req);
  const updated = await db.transaction(async (tx) => {
    const [priorSubmit] = await tx
      .select({ status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, params.data.id));
    const [u] = await tx
      .update(ticketsTable)
      .set({
        status: "submitted",
        lifecycleState: "off_site",
      })
      .where(eq(ticketsTable.id, params.data.id))
      .returning();
    if (u && priorSubmit && priorSubmit.status !== "submitted") {
      await recordTicketTransition({
        tx,
        ticketId: u.id,
        fromStatus: priorSubmit.status,
        toStatus: "submitted",
        actorUserId: submitSession?.userId ?? null,
        actorRole: submitSession?.role ?? null,
        reason: "submitted for review",
      });
    }
    return u;
  });
  if (!updated) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return;
  }
  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  sendResponse(res, SubmitTicketResponse, result);
});

// @no-accept-guard: status-mutation guard is the (admin OR owning-partner)
// role check below combined with `ne(status, "approved")` — vendor / field
// roles cannot reach this endpoint at all, so the pre-accept bypass does
// not apply. See Task #500 checklist at the top of this file.
router.post("/tickets/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveTicketParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      code: "auth.not_authenticated",
      error: "not_authenticated",
      message: "Not authenticated",
    });
    return;
  }
  const [existing] = await db
    .select({
      ticketId: ticketsTable.id,
      partnerId: siteLocationsTable.partnerId,
      status: ticketsTable.status,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (session.role !== "admin" && !(session.role === "partner" && session.partnerId === existing.partnerId)) {
    res.status(403).json({
      code: "ticket.forbidden_not_owning_partner",
      error: "forbidden_not_owning_partner",
      message: "Only the owning partner or an admin can approve this ticket",
    });
    return;
  }
  // Bug #1 fix: only tickets that have actually been worked + submitted by
  // the vendor are eligible for partner approval. Without this gate a
  // partner could approve (and disperse funds against) a ticket still in
  // `awaiting_acceptance`/`denied`/`initiated`/`in_progress` — i.e. before
  // any work happened. `approved` is allowed for idempotency. The existing
  // CAS below makes a no-op idempotent.
  const APPROVABLE_STATUSES: ReadonlySet<string> = new Set([
    "pending_review",
    "completed",
    "approved",
  ]);
  if (!APPROVABLE_STATUSES.has(existing.status)) {
    res.status(409).json({
      code: "ticket.not_approvable",
      error: "ticket_not_approvable",
      message: `Ticket is ${existing.status.replace(/_/g, " ")}; it must be submitted by the vendor before it can be approved`,
    });
    return;
  }
  // Idempotent approve: only flip non-approved tickets, and only enqueue
  // invoice generation when we actually transitioned. Repeated calls are
  // no-ops accounting-wise. The status flip + history insert run inside a
  // single transaction so we never end up with one without the other.
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(ticketsTable)
      // Stamp approvedAt at the same moment we flip status. This is the
      // immutable accounting timestamp the invoice engine pivots on; it is
      // never overwritten on later edits.
      .set({ status: "approved", approvedAt: new Date() })
      .where(and(eq(ticketsTable.id, params.data.id), ne(ticketsTable.status, "approved")))
      .returning();
    if (u) {
      await recordTicketTransition({
        tx,
        ticketId: u.id,
        fromStatus: existing.status,
        toStatus: "approved",
        actorUserId: session.userId,
        actorRole: session.role,
        reason: "ticket approved",
      });
    }
    return u;
  });
  if (!updated) {
    // Either not found OR already approved. Distinguish for accurate response.
    const [existing] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
      return;
    }
    const [result] = await ticketQuery().where(eq(ticketsTable.id, existing.id));
    sendResponse(res, ApproveTicketResponse, result);
    return;
  }
  // Phase 2 accounting: kick off invoice generation in the background. We
  // never block the approve response on this — failures are logged. The
  // generator coalesces concurrent calls per ticket.
  enqueueInvoiceGenerationForTicket(updated.id);
  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  sendResponse(res, ApproveTicketResponse, result);
});

// POST /tickets/:id/disperse-funds (Task #497) — Partner AP records the
// payment that closes the ticket loop. Only callable on status='approved'
// (so the AP queue gets a clean handoff from the approval step) and only
// by an admin OR a partner-side user with AP authority on the owning
// partner (admin org membership OR a partner_contacts row tagged
// "Accounts Payable"). The status flip + payment metadata write + history
// row all live inside one transaction so we never end up with
// status='funds_dispersed' but no payment columns.
//
// @no-accept-guard: this endpoint requires status === "approved" or
// "awaiting_payment" before dispersing — both states are post-accept by
// definition, so the pre-accept bypass is structurally unreachable here.
// See Task #500 checklist at the top of this file.
router.post("/tickets/:id/disperse-funds", async (req, res): Promise<void> => {
  const params = DisperseFundsTicketParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "ticket.invalid_id", error: "invalid_ticket_id" });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      code: "auth.not_authenticated",
      error: "not_authenticated",
      message: "Not authenticated",
    });
    return;
  }
  const parsed = DisperseFundsTicketBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "ticket.invalid_disperse_funds_body", error: "invalid_disperse_funds_body" });
    return;
  }
  const ref = parsed.data.paymentReference?.trim() || null;
  // Check # is the only required reference — etf and other are free-form
  // and may legitimately omit a reference (cash handoff, voided line, etc).
  if (parsed.data.paymentMethod === "check" && !ref) {
    res.status(400).json({
      code: "ticket.payment_reference_required",
      error: "payment_reference_required",
      message: "paymentReference is required for paymentMethod=check",
    });
    return;
  }

  const [existing] = await db
    .select({
      ticketId: ticketsTable.id,
      partnerId: siteLocationsTable.partnerId,
      vendorId: ticketsTable.vendorId,
      status: ticketsTable.status,
    })
    .from(ticketsTable)
    .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }

  // AP authz: admin always wins; partners must (a) be on the right partner
  // and (b) hold the AP role (org admin or AP partner_contact).
  let allowed = session.role === "admin";
  if (!allowed && session.role === "partner" && session.partnerId === existing.partnerId) {
    allowed = await userHasApRole(session.userId, existing.partnerId);
  }
  if (!allowed) {
    res.status(403).json({
      code: "ticket.forbidden_not_ap",
      error: "forbidden_not_ap",
      message: "Only Accounts Payable or an admin can disperse funds",
    });
    return;
  }

  // Funds can only be dispersed against an approved or awaiting_payment
  // ticket — anything else (still pending review, kicked back, already
  // dispersed, cancelled) is either premature or already final. Task #551
  // added the `awaiting_payment` branch so AP can mark the customer-paid
  // tickets dispersed without forcing them back through `approved`.
  if (existing.status !== "approved" && existing.status !== "awaiting_payment") {
    res.status(409).json({
      error: "ticket_not_approved",
      code: "ticket.not_approved",
      message: "Funds can only be dispersed on an approved or awaiting-payment ticket",
    });
    return;
  }

  // Snapshot the source status so the CAS update + history row both
  // reflect the actual transition (approved → funds_dispersed OR
  // awaiting_payment → funds_dispersed).
  const fromStatus = existing.status;
  const dispersedAt = new Date();
  const note = parsed.data.note?.trim() || null;
  // Task #852 — optional proof-of-payment image. The mobile/web modal
  // uploads the image first via /api/storage/uploads/request-url and
  // submits the resulting object path here. Trim + null-fallback so an
  // empty string from a cleared input doesn't store a junk URL.
  const receiptUrl = parsed.data.paymentReceiptUrl?.trim() || null;
  const updated = await db.transaction(async (tx) => {
    // Idempotency guard inside the tx: if the row already moved to
    // funds_dispersed between our pre-check and the update, we skip.
    const [u] = await tx
      .update(ticketsTable)
      .set({
        status: "funds_dispersed",
        paymentMethod: parsed.data.paymentMethod,
        paymentReference: ref,
        paymentNote: note,
        paymentDispersedAt: dispersedAt,
        paymentDispersedById: session.userId,
        paymentReceiptUrl: receiptUrl,
      })
      .where(
        and(
          eq(ticketsTable.id, params.data.id),
          or(eq(ticketsTable.status, "approved"), eq(ticketsTable.status, "awaiting_payment")),
        ),
      )
      .returning();
    if (u) {
      await recordTicketTransition({
        tx,
        ticketId: u.id,
        fromStatus,
        toStatus: "funds_dispersed",
        actorUserId: session.userId,
        actorRole: session.role,
        reason: note ?? `funds dispersed via ${parsed.data.paymentMethod}`,
      });
    }
    return u;
  });
  if (!updated) {
    res.status(409).json({
      error: "ticket_not_approved",
      code: "ticket.not_approved",
      message: "Funds can only be dispersed on an approved or awaiting-payment ticket",
    });
    return;
  }

  // Notify the vendor side that the money is on the way. Failures here are
  // not fatal — the dispersal itself is committed.
  try {
    const vendorUserIds = await findVendorUserIds(existing.vendorId);
    if (vendorUserIds.length > 0) {
      await notifyUsers(vendorUserIds, {
        type: "funds_dispersed",
        title: "Funds dispersed",
        body: `Ticket #${updated.id} payment was sent (${parsed.data.paymentMethod}).`,
        link: `/tickets/${updated.id}`,
      });
    }
  } catch (err) {
    // Swallow — accounting state is the source of truth, notifications are best-effort.
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  sendResponse(res, DisperseFundsTicketResponse, result);
});

// POST /tickets/:id/reverse-funds-dispersal (Task #504) — Admin-only escape
// hatch for AP teams that mistyped a payment reference, picked the wrong
// method, or paid the wrong vendor. Reverses a `funds_dispersed` ticket
// back to `approved`, clears the five payment columns, and records a
// dedicated transition row so the audit trail shows BOTH the original
// dispersal AND the reversal — never overwrites or hides the disperse
// event. The /cancel guard above (`existing.status === 'funds_dispersed'`)
// is intentionally untouched: a non-reversed dispersal still cannot be
// cancelled, but once reversed the ticket is back to `approved` and the
// usual cancel path is available again.
router.post(
  "/tickets/:id/reverse-funds-dispersal",
  async (req, res): Promise<void> => {
    const params = ReverseFundsDispersalParams.safeParse(req.params);
    if (!params.success) {
      sendValidationFailed(res, params.error);
      return;
    }
    const session = getSession(req);
    if (!session) {
      res.status(401).json({
        code: "auth.not_authenticated",
        error: "not_authenticated",
        message: "Not authenticated",
      });
      return;
    }
    // Admin-only. AP partners can disperse funds, but only an admin may
    // reverse a dispersal — keeps the financial-correction surface area
    // narrow and gives a single role to audit. Returns the same
    // `forbidden_admin_only` shape as /reactivate so the web client's
    // existing 403 toast handling Just Works.
    if (session.role !== "admin") {
      res.status(403).json({
        code: "ticket.forbidden_admin_only",
        error: "forbidden_admin_only",
        message: "Only an admin can reverse a fund dispersal",
      });
      return;
    }
    const parsed = ReverseFundsDispersalBody.safeParse(req.body);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "ticket.invalid_reverse_funds_body", error: "invalid_reverse_funds_body" });
      return;
    }
    const reason = parsed.data.reason.trim();
    if (!reason) {
      // OpenAPI minLength=1 catches empty strings, but a reason that's
      // *only* whitespace would slip through — a "  " reason is useless
      // for accounting forensics, so reject it explicitly with the same
      // structured shape AP clients already key off of.
      res.status(400).json({
        code: "ticket.reverse_funds_reason_required",
        error: "reverse_funds_reason_required",
        message: "reason is required and must be non-empty",
      });
      return;
    }

    const [existing] = await db
      .select({
        ticketId: ticketsTable.id,
        partnerId: siteLocationsTable.partnerId,
        vendorId: ticketsTable.vendorId,
        status: ticketsTable.status,
        // Snapshot the payment columns BEFORE the update clears them so
        // the Task #862 reversal email can quote the original payment
        // method/reference/date in its body. We also pull vendor +
        // partner labels here so we don't need a second join after the
        // commit just to render the email.
        paymentMethod: ticketsTable.paymentMethod,
        paymentReference: ticketsTable.paymentReference,
        paymentDispersedAt: ticketsTable.paymentDispersedAt,
        vendorName: vendorsTable.name,
        vendorBillingEmail: vendorsTable.contactEmail,
        partnerName: partnersTable.name,
      })
      .from(ticketsTable)
      .innerJoin(
        siteLocationsTable,
        eq(ticketsTable.siteLocationId, siteLocationsTable.id),
      )
      .innerJoin(vendorsTable, eq(vendorsTable.id, ticketsTable.vendorId))
      .innerJoin(partnersTable, eq(partnersTable.id, siteLocationsTable.partnerId))
      .where(eq(ticketsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({
        code: "ticket.not_found",
        error: "ticket_not_found",
        message: "Ticket not found",
      });
      return;
    }

    // Only `funds_dispersed` can be reversed. Anything else (still
    // approved, awaiting payment, cancelled, etc.) is either nothing to
    // reverse or already in a state the existing /cancel + /unlock paths
    // already cover.
    if (existing.status !== "funds_dispersed") {
      res.status(409).json({
        code: "ticket.not_funds_dispersed",
        error: "ticket_not_funds_dispersed",
        message:
          "Only a ticket whose funds have been dispersed can be reversed",
      });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      // CAS guard inside the tx mirrors /disperse-funds: if a concurrent
      // mutation already moved the ticket out of `funds_dispersed`, we
      // skip the write and surface a 409 above the response barrier.
      const [u] = await tx
        .update(ticketsTable)
        .set({
          status: "approved",
          paymentMethod: null,
          paymentReference: null,
          paymentNote: null,
          paymentDispersedAt: null,
          paymentDispersedById: null,
          // Task #852 — clear the receipt photo too so a future
          // re-dispersal starts from a clean slate; the original image
          // remains in object storage but is no longer surfaced through
          // the ticket payload.
          paymentReceiptUrl: null,
        })
        .where(
          and(
            eq(ticketsTable.id, params.data.id),
            eq(ticketsTable.status, "funds_dispersed"),
          ),
        )
        .returning();
      if (u) {
        // Distinct transition row from the original `disperse-funds`
        // event. The reason is prefixed `Reversed:` so the timeline
        // renders both the original dispersal AND the reversal as
        // separate, auditable events instead of overwriting history.
        await recordTicketTransition({
          tx,
          ticketId: u.id,
          fromStatus: "funds_dispersed",
          toStatus: "approved",
          actorUserId: session.userId,
          actorRole: session.role,
          reason: `Reversed: ${reason}`,
        });
      }
      return u;
    });
    if (!updated) {
      res.status(409).json({
        code: "ticket.not_funds_dispersed",
        error: "ticket_not_funds_dispersed",
        message:
          "Only a ticket whose funds have been dispersed can be reversed",
      });
      return;
    }

    // Notify both sides so neither AP nor the vendor is surprised when
    // the ticket re-appears in their queues. Best-effort like the
    // /disperse-funds notify — accounting state is the source of truth.
    try {
      const vendorUserIds = await findVendorUserIds(existing.vendorId);
      if (vendorUserIds.length > 0) {
        await notifyUsers(vendorUserIds, {
          type: "funds_dispersed",
          title: "Payment reversed",
          body: `Ticket #${updated.id} payment was reversed by an admin (${reason}).`,
          link: `/tickets/${updated.id}`,
        });
      }
    } catch (_err) {
      // Swallow — financial correctness is committed.
    }
    try {
      const partnerUserIds = await findPartnerUserIds(existing.partnerId);
      if (partnerUserIds.length > 0) {
        await notifyUsers(partnerUserIds, {
          type: "funds_dispersed",
          title: "Payment reversed",
          body: `Ticket #${updated.id} payment was reversed by an admin (${reason}).`,
          link: `/tickets/${updated.id}`,
        });
      }
    } catch (_err) {
      // Swallow — see above.
    }

    // Task #862: email the partner AP distribution + the vendor billing
    // contact so accounting reconciliation isn't gated on someone seeing
    // the in-app toast. Best-effort like the in-app notify above —
    // SendGrid outages must not break a committed financial reversal.
    try {
      const reversedAt = new Date();
      // Sum extended line totals (qty * unit_price). Same shape as the
      // AP weekly digest so the dollar figure quoted in the email
      // matches what AP staff already see in their other VNDRLY emails.
      const totalRows = await db.execute<{ total: string }>(sql`
        select coalesce(sum(quantity * unit_price), 0)::numeric(14,2)::text as total
        from ticket_line_items
        where ticket_id = ${updated.id}
      `);
      const totalNum = Number(totalRows.rows?.[0]?.total ?? "0") || 0;
      const amountLabel = totalNum.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });

      // Admin display name. Fall back to "an admin" if the row is gone
      // (shouldn't happen since the session was just authed, but the
      // email is best-effort and we don't want to throw on a stale FK).
      const [adminRow] = await db
        .select({ displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, session.userId));
      const reversedByName = adminRow?.displayName?.trim() || "an admin";

      const apContacts = await findPartnerApContactEmails(existing.partnerId);
      const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
      const ticketDetailUrl = baseUrl
        ? `${baseUrl}/tickets/${updated.id}`
        : `/tickets/${updated.id}`;
      const ticketTrackingNumber = String(updated.id).padStart(4, "0");
      const vendorBillingEmail = existing.vendorBillingEmail?.trim() || null;

      // sendPaymentReversedEmail itself returns null when there are zero
      // total recipients (no AP contacts AND no vendor billing email),
      // so we don't need to gate the call here.
      await sendPaymentReversedEmail({
        apRecipients: apContacts.map((c) => ({
          email: c.email,
          locale: c.preferredLocale,
        })),
        vendorBillingEmail,
        vendorName: existing.vendorName,
        partnerName: existing.partnerName,
        ticketTrackingNumber,
        ticketDetailUrl,
        reversedByName,
        reversedAt,
        reason,
        originalPayment: {
          method: existing.paymentMethod,
          reference: existing.paymentReference,
          amountLabel,
          dispersedAt: existing.paymentDispersedAt,
        },
      });
    } catch (_err) {
      // Swallow — financial correctness is committed; email is best-effort.
    }

    const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
    sendResponse(res, ReverseFundsDispersalResponse, result);
  },
);

// POST /tickets/:id/reverse-dispersal (Task #853) — AP-self-service
// reversal. Unlike the admin-only Task #504 escape hatch above, this
// endpoint is gated by the same `viewerCanDisperseFunds` capability that
// powered the original /disperse-funds POST: admins always pass, and a
// partner-side user with the AP role on the owning partner can reverse
// their own miskeyed dispersal from the field without paging dispatch.
//
// Same five-column clearing semantics + `funds_dispersed → approved`
// status flip, plus a snapshot row written to `payment_audit` capturing
// WHO reversed it, WHY, and a verbatim copy of the cleared payment
// columns. The transition row is still written for the audit timeline,
// with a `Reversed:` reason prefix so the timeline keeps both the
// original dispersal AND the reversal as distinct events.
//
// The Task #504 admin /reverse-funds-dispersal endpoint is intentionally
// preserved for backwards compatibility with its existing test suite +
// admin-only escape-hatch UI; this is a separate, broader entry point.
router.post(
  "/tickets/:id/reverse-dispersal",
  async (req, res): Promise<void> => {
    const params = ReverseDispersalParams.safeParse(req.params);
    if (!params.success) {
      sendValidationFailed(res, params.error, { code: "ticket.invalid_id", error: "invalid_ticket_id" });
      return;
    }
    const session = getSession(req);
    if (!session) {
      res.status(401).json({
        code: "auth.not_authenticated",
        error: "not_authenticated",
        message: "Not authenticated",
      });
      return;
    }
    const parsed = ReverseDispersalBody.safeParse(req.body);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "ticket.invalid_reverse_dispersal_body", error: "invalid_reverse_dispersal_body" });
      return;
    }
    const reason = parsed.data.reason.trim();
    if (!reason) {
      // OpenAPI minLength=1 rejects empty strings, but a whitespace-only
      // reason is useless for accounting forensics — surface a distinct
      // structured code so the UI can show a localized "reason required".
      res.status(400).json({
        code: "ticket.reverse_dispersal_reason_required",
        error: "reverse_dispersal_reason_required",
        message: "reason is required and must be non-empty",
      });
      return;
    }

    const [existing] = await db
      .select({
        ticketId: ticketsTable.id,
        partnerId: siteLocationsTable.partnerId,
        vendorId: ticketsTable.vendorId,
        status: ticketsTable.status,
        paymentMethod: ticketsTable.paymentMethod,
        paymentReference: ticketsTable.paymentReference,
        paymentNote: ticketsTable.paymentNote,
        paymentDispersedAt: ticketsTable.paymentDispersedAt,
        paymentDispersedById: ticketsTable.paymentDispersedById,
      })
      .from(ticketsTable)
      .innerJoin(
        siteLocationsTable,
        eq(ticketsTable.siteLocationId, siteLocationsTable.id),
      )
      .where(eq(ticketsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({
        code: "ticket.not_found",
        error: "ticket_not_found",
        message: "Ticket not found",
      });
      return;
    }

    // Authz mirrors /disperse-funds exactly — admin always wins, and a
    // partner-role caller must (a) own the ticket's partner AND (b) hold
    // the Accounts Payable role. The `viewerCanDisperseFunds` flag on
    // GET /tickets/:id surfaces the same gate to the UI.
    let allowed = session.role === "admin";
    if (
      !allowed &&
      session.role === "partner" &&
      session.partnerId === existing.partnerId
    ) {
      allowed = await userHasApRole(session.userId, existing.partnerId);
    }
    if (!allowed) {
      res.status(403).json({
        code: "ticket.forbidden_not_ap",
        error: "forbidden_not_ap",
        message: "Only Accounts Payable or an admin can reverse a dispersal",
      });
      return;
    }

    if (existing.status !== "funds_dispersed") {
      res.status(409).json({
        code: "ticket.not_funds_dispersed",
        error: "ticket_not_funds_dispersed",
        message:
          "Only a ticket whose funds have been dispersed can be reversed",
      });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      // CAS guard inside the tx: if a concurrent mutation already moved
      // the ticket out of `funds_dispersed`, skip the write and surface
      // a 409 above the response barrier.
      const [u] = await tx
        .update(ticketsTable)
        .set({
          status: "approved",
          paymentMethod: null,
          paymentReference: null,
          paymentNote: null,
          paymentDispersedAt: null,
          paymentDispersedById: null,
        })
        .where(
          and(
            eq(ticketsTable.id, params.data.id),
            eq(ticketsTable.status, "funds_dispersed"),
          ),
        )
        .returning();
      if (u) {
        // Snapshot the cleared payment columns + actor + reason into the
        // append-only payment_audit table so a future audit can answer
        // "what was the ticket actually paying when it was reversed?"
        // without joining the (now-cleared) ticket row.
        await tx.insert(paymentAuditTable).values({
          ticketId: u.id,
          action: "dispersal_reversed",
          reason,
          actorUserId: session.userId,
          actorRole: session.role,
          paymentMethodSnapshot: existing.paymentMethod,
          paymentReferenceSnapshot: existing.paymentReference,
          paymentNoteSnapshot: existing.paymentNote,
          paymentDispersedAtSnapshot: existing.paymentDispersedAt,
          paymentDispersedByIdSnapshot: existing.paymentDispersedById,
        });
        // Distinct transition row from the original `disperse-funds`
        // event. The reason is prefixed `Reversed:` so the timeline
        // shows both the dispersal AND the reversal as separate,
        // attributable history entries.
        await recordTicketTransition({
          tx,
          ticketId: u.id,
          fromStatus: "funds_dispersed",
          toStatus: "approved",
          actorUserId: session.userId,
          actorRole: session.role,
          reason: `Reversed: ${reason}`,
        });
      }
      return u;
    });
    if (!updated) {
      res.status(409).json({
        code: "ticket.not_funds_dispersed",
        error: "ticket_not_funds_dispersed",
        message:
          "Only a ticket whose funds have been dispersed can be reversed",
      });
      return;
    }

    // Notify both sides so neither AP nor the vendor is surprised when
    // the ticket re-appears in their queues. Best-effort like the
    // /disperse-funds notify — accounting state is the source of truth.
    try {
      const vendorUserIds = await findVendorUserIds(existing.vendorId);
      if (vendorUserIds.length > 0) {
        await notifyUsers(vendorUserIds, {
          type: "funds_dispersed",
          title: "Payment reversed",
          body: `Ticket #${updated.id} payment was reversed (${reason}).`,
          link: `/tickets/${updated.id}`,
        });
      }
    } catch (_err) {
      // Swallow — financial correctness is committed.
    }
    try {
      const partnerUserIds = await findPartnerUserIds(existing.partnerId);
      if (partnerUserIds.length > 0) {
        await notifyUsers(partnerUserIds, {
          type: "funds_dispersed",
          title: "Payment reversed",
          body: `Ticket #${updated.id} payment was reversed (${reason}).`,
          link: `/tickets/${updated.id}`,
        });
      }
    } catch (_err) {
      // Swallow — see above.
    }

    const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
    sendResponse(res, ReverseDispersalResponse, result);
  },
);

// Task #551: explicit awaiting-payment lifecycle step. Field employees and
// admins use this to flag an in-progress ticket that has wrapped on site
// but is now blocked on the customer paying. The route mirrors the
// structured `{ error: <snake_case_code>, message }` contract introduced
// for the rest of the ticket-mutation surface in Tasks #527 / #533. We
// don't go through ensureFieldOwnership (which still emits dotted-code
// auth errors) so the role / state guards can speak the modern code shape
// directly.
//
// @no-accept-guard: each actor has its own per-actor `allowedPreStates`
// allowlist below (vendor/field → in_progress, partner-AP → approved,
// admin → either). None include `awaiting_acceptance` or `denied`, so the
// pre-accept bypass is closed structurally. See Task #500 checklist at
// the top of this file.
router.post("/tickets/:id/awaiting-payment", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    res.status(400).json({
      code: "ticket.invalid_ticket_id",
      error: "invalid_ticket_id",
      message: "Invalid ticket id",
    });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      code: "auth.not_authenticated",
      error: "not_authenticated",
      message: "Not authenticated",
    });
    return;
  }

  // Optional free-text note recorded on the status_history transition.
  // Validated inline (no zod import here) to keep the body shape simple
  // and avoid an OpenAPI codegen round-trip just for this one field.
  const rawNote = (req.body ?? {}).note;
  if (rawNote != null && (typeof rawNote !== "string" || rawNote.length > 500)) {
    res.status(400).json({
      code: "ticket.invalid_awaiting_payment_body",
      error: "invalid_awaiting_payment_body",
      message: "note must be a string of 500 characters or fewer",
    });
    return;
  }

  const [existing] = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      status: ticketsTable.status,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }

  // Awaiting-payment used to be a vendor-side declaration only ("we're
  // done, the customer owes us"). Task #729 also lets the owning partner's
  // AP user park an *approved* ticket in awaiting_payment as a one-click
  // step before disperse-funds — same downstream payment intent, just
  // initiated by the partner instead of the vendor. Each actor has its
  // own valid pre-states: vendor / field stay on `in_progress`, partner
  // AP only on `approved`, admin can do either for support cases.
  let allowed = false;
  let allowedPreStates: ReadonlyArray<typeof existing.status> = [];
  if (session.role === "admin") {
    allowed = true;
    allowedPreStates = ["in_progress", "approved"];
  } else if (session.role === "vendor" && session.vendorId === existing.vendorId) {
    allowed = true;
    allowedPreStates = ["in_progress"];
  } else if (session.role === "field_employee") {
    const fe = await getFieldEmployeeForSession(req);
    if (fe && fe.vendorId === existing.vendorId && existing.fieldEmployeeId === fe.id) {
      allowed = true;
      allowedPreStates = ["in_progress"];
    }
  } else if (session.role === "partner" && session.partnerId != null && session.userId != null) {
    // Look up the ticket's owning partner via its site location, then
    // confirm the caller is AP-eligible there. This mirrors the
    // disperse-funds gate so the same `viewerCanDisperseFunds` flag
    // surfaces both buttons consistently.
    const [siteRow] = await db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(ticketsTable)
      .innerJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
      .where(eq(ticketsTable.id, id));
    if (siteRow?.partnerId === session.partnerId) {
      const apEligible = await userHasApRole(session.userId, session.partnerId);
      if (apEligible) {
        allowed = true;
        allowedPreStates = ["approved"];
      }
    }
  }
  if (!allowed) {
    res.status(403).json({
      code: "ticket.forbidden_not_assigned",
      error: "forbidden_not_assigned",
      message: "Only the assigned vendor, the field employee on the ticket, the partner AP user, or an admin can mark it awaiting payment",
    });
    return;
  }

  // Per-actor pre-state guard. Code is preserved as `ticket.not_in_progress`
  // for backwards compatibility with the existing client locale catalogs
  // and `tickets-mutation-codes.test.ts` regression coverage.
  if (!allowedPreStates.includes(existing.status)) {
    res.status(409).json({
      code: "ticket.not_in_progress",
      error: "ticket_not_in_progress",
      message: `Ticket is ${existing.status.replace(/_/g, " ")} and cannot be marked awaiting payment`,
    });
    return;
  }

  const fromStatus = existing.status;
  const note = typeof rawNote === "string" ? rawNote.trim() || null : null;
  const updated = await db.transaction(async (tx) => {
    // CAS guard: if the row moved out of the expected pre-state between
    // our pre-check and the update (concurrent submit/cancel/approve),
    // the WHERE clause skips and we surface the same 409 the pre-check
    // would have.
    const [u] = await tx
      .update(ticketsTable)
      .set({ status: "awaiting_payment" })
      .where(and(eq(ticketsTable.id, id), eq(ticketsTable.status, fromStatus)))
      .returning();
    if (u) {
      await recordTicketTransition({
        tx,
        ticketId: u.id,
        fromStatus,
        toStatus: "awaiting_payment",
        actorUserId: session.userId,
        actorRole: session.role,
        reason: note ?? "marked awaiting payment",
      });
    }
    return u;
  });
  if (!updated) {
    res.status(409).json({
      code: "ticket.not_in_progress",
      error: "ticket_not_in_progress",
      message: "Ticket is no longer in a valid state to be marked awaiting payment",
    });
    return;
  }

  // Task #576: now that the shared Ticket response enum includes
  // "awaiting_payment" the office web app can recognize the value, so
  // we return a lean confirmation payload alongside the new status. The
  // ticket list / detail screens will pull the full row on their next
  // refetch — no need to round-trip the entire Ticket here.
  res.json({
    id: updated.id,
    status: "awaiting_payment",
    message: "Ticket marked awaiting payment",
  });
});

router.post("/tickets/:id/kickback", async (req, res): Promise<void> => {
  const params = KickbackTicketParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  // Task #494: cannot kick back a ticket that has not been accepted yet —
  // there is no submitted work to reject in the awaiting/denied states.
  if (!(await ensureAccepted(req, res, params.data.id))) return;
  const parsed = KickbackTicketBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }
  const kickbackSession = getSession(req);
  const updated = await db.transaction(async (tx) => {
    const [priorKickback] = await tx
      .select({ status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, params.data.id));
    const [u] = await tx
      .update(ticketsTable)
      .set({ status: "kicked_back", kickbackReason: parsed.data.reason })
      .where(eq(ticketsTable.id, params.data.id))
      .returning();
    if (u && priorKickback && priorKickback.status !== "kicked_back") {
      await recordTicketTransition({
        tx,
        ticketId: u.id,
        fromStatus: priorKickback.status,
        toStatus: "kicked_back",
        actorUserId: kickbackSession?.userId ?? null,
        actorRole: kickbackSession?.role ?? null,
        reason: parsed.data.reason,
      });
    }
    return u;
  });
  if (!updated) {
    res.status(404).json({ code: "ticket.not_found", error: "ticket_not_found", message: "Ticket not found" });
    return;
  }
  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  if (result?.vendorId) {
    const vendorUserIds = await findVendorUserIds(result.vendorId);
    await notifyUsers(vendorUserIds, {
      type: "ticket_kicked_back",
      title: "Tracking number kicked back",
      body: `Tracking #${String(updated.id).padStart(4, "0")} was kicked back: ${parsed.data.reason}`,
      link: `/tickets/${updated.id}`,
    });
  }
  if (updated.fieldEmployeeId) {
    void sendPushToFieldEmployee(updated.fieldEmployeeId, {
      title: "Tracking Kicked Back",
      body: `Tracking #${String(updated.id).padStart(4, "0")} needs corrections: ${parsed.data.reason}`,
      data: { ticketId: updated.id, type: "ticket_kicked_back" },
    });
  }
  sendResponse(res, KickbackTicketResponse, result);
});

// ── Task #494: Vendor Accept / Deny + Reinvite + Nearby Vendors ──
//
// These four endpoints implement the partner→vendor invite handshake that
// gates partner-self-service tickets behind explicit vendor acknowledgment.
// Status flow:
//
//   POST /tickets (partner_self_service)    → status = awaiting_acceptance
//   POST /tickets/:id/accept (vendor)       → awaiting_acceptance → initiated
//   POST /tickets/:id/deny    (vendor)      → awaiting_acceptance → denied
//   POST /tickets/:id/reinvite (partner)    → {denied, awaiting_acceptance} → awaiting_acceptance (with new vendorId)
//
// `accept` lands on `initiated` (not `in_progress`) so the existing
// pre-check-in lifecycle keeps working — the field employee will still mark
// "En Route" and Check-In to drive status to `in_progress` exactly the same
// way office/field intake tickets do today.

// Imported from ../lib/geo (extracted so it can be unit-tested directly).
// Previously inlined; do NOT redefine.

router.post("/tickets/:id/accept", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({
      code: "ticket.invalid_id",
      error: "invalid_ticket_id",
      message: "Invalid ticket id",
    });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }
  const [existing] = await db
    .select({ id: ticketsTable.id, status: ticketsTable.status, vendorId: ticketsTable.vendorId })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  // Only members of the invited vendor (or platform admins, for support) may
  // act on the invite. We deliberately do NOT use `ensureFieldOwnership`
  // here because that helper checks `site_work_assignments`, and the vendor
  // may not yet be assigned to this site at the time they accept.
  if (
    session.role !== "admin" &&
    !(session.role === "vendor" && session.vendorId === existing.vendorId)
  ) {
    res.status(403).json({
      code: "ticket.forbidden_not_invited_vendor",
      error: "forbidden_not_invited_vendor",
      message: "Only the invited vendor may accept this ticket",
    });
    return;
  }
  if (existing.status !== "awaiting_acceptance") {
    res.status(409).json({
      code: "ticket.not_awaiting_acceptance",
      error: TICKET_NOT_AWAITING_ACCEPTANCE,
      message: `Ticket is ${existing.status.replace(/_/g, " ")} and cannot be accepted`,
    });
    return;
  }

  // Bug #3 fix: vendor office may pre-assign a primary field employee at
  // accept time. Validate that the supplied vendor_people row actually
  // belongs to the invited vendor (otherwise a vendor-office user could
  // staple a different vendor's crew onto the ticket). Persisted on the
  // same UPDATE that flips status so the assignment is atomic with accept.
  let acceptFieldEmployeeId: number | null | undefined = undefined;
  const rawFieldEmployeeId = (req.body as { fieldEmployeeId?: unknown } | undefined)?.fieldEmployeeId;
  if (rawFieldEmployeeId != null) {
    const feId = Number(rawFieldEmployeeId);
    if (!Number.isInteger(feId) || feId <= 0) {
      res.status(400).json({
        code: "ticket.invalid_field_employee_id",
        error: "invalid_field_employee_id",
        message: "fieldEmployeeId must be a positive integer",
      });
      return;
    }
    const [fe] = await db
      .select({ id: vendorPeopleTable.id, vendorId: vendorPeopleTable.vendorId })
      .from(vendorPeopleTable)
      .where(and(eq(vendorPeopleTable.id, feId), isNull(vendorPeopleTable.deletedAt)));
    if (!fe) {
      res.status(404).json({
        code: "field_employee.not_found",
        error: "field_employee_not_found",
        message: "Field employee not found",
      });
      return;
    }
    if (fe.vendorId !== existing.vendorId) {
      res.status(403).json({
        code: "field_employee.vendor_mismatch",
        error: FIELD_EMPLOYEE_VENDOR_MISMATCH,
        message: "Field employee does not belong to the invited vendor",
      });
      return;
    }
    acceptFieldEmployeeId = feId;
  }

  // Compare-and-swap: pin the update to the same vendorId AND status we
  // observed on read. Prevents a stale Accept from succeeding after the
  // partner has already reinvited a different vendor (or after a concurrent
  // deny/cancel).
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(ticketsTable)
      .set({
        status: "initiated",
        ...(acceptFieldEmployeeId !== undefined ? { fieldEmployeeId: acceptFieldEmployeeId } : {}),
      })
      .where(
        and(
          eq(ticketsTable.id, id),
          eq(ticketsTable.status, "awaiting_acceptance"),
          eq(ticketsTable.vendorId, existing.vendorId),
        ),
      )
      .returning();
    if (!u) return undefined;
    await recordTicketTransition({
      tx,
      ticketId: u.id,
      fromStatus: "awaiting_acceptance",
      toStatus: "initiated",
      actorUserId: session.userId,
      actorRole: session.role,
      reason: "vendor accepted invite",
    });
    return u;
  });
  if (!updated) {
    res.status(409).json({
      code: "ticket.state_changed",
      error: TICKET_STATE_CHANGED,
      message: "Ticket is no longer awaiting your acceptance",
    });
    return;
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));

  // Notify the partner so the office knows the vendor accepted and the
  // ticket is now actionable in their queue.
  try {
    const [siteRow] = await db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, result.siteLocationId));
    if (siteRow?.partnerId) {
      const partnerUserIds = await findPartnerUserIds(siteRow.partnerId);
      const trackingNumber = String(updated.id).padStart(8, "0");
      await notifyUsers(partnerUserIds, {
        type: "ticket_accept_received",
        title: "Vendor accepted your ticket",
        body: `${result?.vendorName ?? "The vendor"} accepted ticket #${trackingNumber}.`,
        link: `/tickets/${updated.id}`,
      });
    }
  } catch (e) {
    console.error("[tickets] failed to notify partner of accept", e);
  }

  sendResponse(res, GetTicketResponse, result);
});

router.post("/tickets/:id/deny", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({
      code: "ticket.invalid_id",
      error: "invalid_ticket_id",
      message: "Invalid ticket id",
    });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({
      code: "ticket.deny_reason_required",
      error: "deny_reason_required",
      message: "Reason is required",
    });
    return;
  }
  if (reason.length > 500) {
    res.status(400).json({
      code: "ticket.deny_reason_too_long",
      error: "deny_reason_too_long",
      message: "Reason must be 500 characters or fewer",
    });
    return;
  }
  const [existing] = await db
    .select({ id: ticketsTable.id, status: ticketsTable.status, vendorId: ticketsTable.vendorId })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (
    session.role !== "admin" &&
    !(session.role === "vendor" && session.vendorId === existing.vendorId)
  ) {
    res.status(403).json({
      code: "ticket.forbidden_not_invited_vendor",
      error: "forbidden_not_invited_vendor",
      message: "Only the invited vendor may deny this ticket",
    });
    return;
  }
  if (existing.status !== "awaiting_acceptance") {
    res.status(409).json({
      code: "ticket.not_awaiting_acceptance",
      error: TICKET_NOT_AWAITING_ACCEPTANCE,
      message: `Ticket is ${existing.status.replace(/_/g, " ")} and cannot be denied`,
    });
    return;
  }

  // Compare-and-swap: pin both status and vendorId to prevent the previously
  // invited vendor from denying after a partner has reinvited someone else.
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(ticketsTable)
      .set({ status: "denied", kickbackReason: reason })
      .where(
        and(
          eq(ticketsTable.id, id),
          eq(ticketsTable.status, "awaiting_acceptance"),
          eq(ticketsTable.vendorId, existing.vendorId),
        ),
      )
      .returning();
    if (!u) return undefined;
    await recordTicketTransition({
      tx,
      ticketId: u.id,
      fromStatus: "awaiting_acceptance",
      toStatus: "denied",
      actorUserId: session.userId,
      actorRole: session.role,
      reason,
    });
    return u;
  });
  if (!updated) {
    res.status(409).json({
      code: "ticket.state_changed",
      error: TICKET_STATE_CHANGED,
      message: "Ticket is no longer awaiting your acceptance",
    });
    return;
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));

  // Notify the partner so they can reinvite a different vendor.
  try {
    const [siteRow] = await db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, result.siteLocationId));
    if (siteRow?.partnerId) {
      const partnerUserIds = await findPartnerUserIds(siteRow.partnerId);
      const trackingNumber = String(updated.id).padStart(8, "0");
      await notifyUsers(partnerUserIds, {
        type: "ticket_deny_received",
        title: "Vendor denied your ticket",
        body: `${result?.vendorName ?? "The vendor"} denied ticket #${trackingNumber}: ${reason}`,
        link: `/tickets/${updated.id}`,
      });
    }
  } catch (e) {
    console.error("[tickets] failed to notify partner of deny", e);
  }

  sendResponse(res, GetTicketResponse, result);
});

router.post("/tickets/:id/reinvite", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({
      code: "ticket.invalid_id",
      error: "invalid_ticket_id",
      message: "Invalid ticket id",
    });
    return;
  }
  const newVendorId = Number(req.body?.vendorId);
  if (!Number.isFinite(newVendorId) || newVendorId <= 0) {
    res.status(400).json({
      code: "ticket.vendor_id_required",
      error: "vendor_id_required",
      message: "vendorId is required",
    });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }
  const [existing] = await db
    .select({
      id: ticketsTable.id,
      status: ticketsTable.status,
      vendorId: ticketsTable.vendorId,
      siteLocationId: ticketsTable.siteLocationId,
      workTypeId: ticketsTable.workTypeId,
      partnerId: siteLocationsTable.partnerId,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (
    session.role !== "admin" &&
    !(session.role === "partner" && session.partnerId === existing.partnerId)
  ) {
    res.status(403).json({
      code: "ticket.forbidden_not_owning_partner",
      error: "forbidden_not_owning_partner",
      message: "Only the owning partner may reinvite a vendor",
    });
    return;
  }
  // Reinvite is allowed any time before work actually starts. That covers:
  //   - awaiting_acceptance: invite still pending; partner changed mind
  //   - denied: previous vendor opted out
  //   - initiated: vendor accepted but has not checked in; partner can
  //                still pull the work and reassign
  // Once status === in_progress (vendor has checked in) the partner must
  // cancel before reassigning, since real field work is now in flight.
  if (!REINVITE_ELIGIBLE_STATUSES.has(existing.status)) {
    res.status(409).json({
      code: "ticket.not_reinvitable",
      error: "ticket_not_reinvitable",
      message: `Ticket is ${existing.status.replace(/_/g, " ")} and cannot be reassigned via reinvite`,
    });
    return;
  }
  const [vendor] = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, newVendorId));
  if (!vendor) {
    res.status(404).json({
      code: "vendor.not_found",
      error: "vendor_not_found",
      message: "Vendor not found",
    });
    return;
  }
  if (vendor.id === existing.vendorId) {
    res.status(400).json({
      code: "ticket.vendor_already_invited",
      error: "vendor_already_invited",
      message: "Vendor is already invited to this ticket",
    });
    return;
  }

  const previousVendorId = existing.vendorId;
  const updated = await db.transaction(async (tx) => {
    // Auto-create the site_work_assignment if missing — the partner is
    // explicitly choosing this vendor for this site/work type, so we
    // bootstrap the relationship rather than blocking on an admin step.
    const [existingAssignment] = await tx
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, existing.siteLocationId),
          eq(siteWorkAssignmentsTable.vendorId, newVendorId),
          eq(siteWorkAssignmentsTable.workTypeId, existing.workTypeId),
        ),
      );
    if (!existingAssignment) {
      await tx.insert(siteWorkAssignmentsTable).values({
        siteLocationId: existing.siteLocationId,
        vendorId: newVendorId,
        workTypeId: existing.workTypeId,
      });
    }
    // Compare-and-swap: pin both status (the read-state we observed) and the
    // previous vendorId. If the originally invited vendor accepts the ticket
    // between our read and write, this update affects 0 rows and we return a
    // 409 — the partner's reinvite is no longer valid because the work is now
    // in progress with the original vendor.
    const [u] = await tx
      .update(ticketsTable)
      .set({
        vendorId: newVendorId,
        status: "awaiting_acceptance",
        // Clear the deny reason since this is a fresh invite to a different
        // vendor; the previous vendor's note should not appear in the new
        // vendor's banner.
        kickbackReason: null,
      })
      .where(
        and(
          eq(ticketsTable.id, id),
          eq(ticketsTable.status, existing.status),
          eq(ticketsTable.vendorId, previousVendorId),
        ),
      )
      .returning();
    if (!u) return undefined;
    await recordTicketTransition({
      tx,
      ticketId: u.id,
      fromStatus: existing.status,
      toStatus: "awaiting_acceptance",
      actorUserId: session.userId,
      actorRole: session.role,
      reason: `reassigned from vendor #${previousVendorId} to vendor #${newVendorId}`,
    });
    return u;
  });
  if (!updated) {
    res.status(409).json({
      code: "ticket.state_changed",
      error: TICKET_STATE_CHANGED,
      message: "Ticket changed before reinvite could be applied; refresh and try again",
    });
    return;
  }

  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));

  // Notify the new vendor.
  try {
    const vendorUserIds = await findVendorUserIds(newVendorId);
    const trackingNumber = String(updated.id).padStart(8, "0");
    await notifyUsers(vendorUserIds, {
      type: "ticket_reinvite_sent",
      title: "New ticket awaiting your acceptance",
      body: `${result?.partnerName ?? "A partner"} invited you to ticket #${trackingNumber} at ${result?.siteName ?? "their site"}. Accept or deny to proceed.`,
      link: `/tickets/${updated.id}`,
    });
  } catch (e) {
    console.error("[tickets] failed to notify new vendor of reinvite", e);
  }

  sendResponse(res, GetTicketResponse, result);
});

router.get("/tickets/:id/nearby-vendors", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({
      code: "ticket.invalid_id",
      error: "invalid_ticket_id",
      message: "Invalid ticket id",
    });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Authentication required", code: "auth.required" });
    return;
  }
  const [existing] = await db
    .select({
      id: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      workTypeId: ticketsTable.workTypeId,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
      partnerId: siteLocationsTable.partnerId,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (
    session.role !== "admin" &&
    !(session.role === "partner" && session.partnerId === existing.partnerId)
  ) {
    res.status(403).json({
      code: "ticket.forbidden_not_owning_partner",
      error: "forbidden_not_owning_partner",
      message: "Only the owning partner may search for alternate vendors",
    });
    return;
  }
  if (existing.siteLatitude == null || existing.siteLongitude == null) {
    res.status(400).json({
      code: "site.not_geocoded",
      error: "site_not_geocoded",
      message: "Site is not geocoded; cannot compute nearby vendors",
    });
    return;
  }

  // Pull every geocoded vendor with a published operating radius along with:
  //   - their relationship status with this partner (preferred|approved|null)
  //   - whether they cover this work type
  //   - the work type's reference price (used as the displayed estimate)
  const vendorRows = await db
    .select({
      id: vendorsTable.id,
      name: vendorsTable.name,
      latitude: vendorsTable.latitude,
      longitude: vendorsTable.longitude,
      operatingRadiusMiles: vendorsTable.operatingRadiusMiles,
      logoUrl: vendorsTable.logoUrl,
      insuranceExpirationDate: vendorsTable.insuranceExpirationDate,
      coiDocumentUrl: vendorsTable.coiDocumentUrl,
      relationshipStatus: partnerVendorRelationshipsTable.status,
    })
    .from(vendorsTable)
    .leftJoin(
      partnerVendorRelationshipsTable,
      and(
        eq(partnerVendorRelationshipsTable.vendorId, vendorsTable.id),
        eq(partnerVendorRelationshipsTable.partnerId, existing.partnerId ?? 0),
      ),
    );

  // Vendor work-type coverage in a single round-trip.
  const workTypeRows = await db
    .select({ vendorId: vendorWorkTypesTable.vendorId })
    .from(vendorWorkTypesTable)
    .where(eq(vendorWorkTypesTable.workTypeId, existing.workTypeId));
  const vendorsCoveringWorkType = new Set<number>(workTypeRows.map((r) => r.vendorId));

  // Reference price for the requested work type.
  const [workType] = await db
    .select({ estimatedPrice: workTypesTable.estimatedPrice })
    .from(workTypesTable)
    .where(eq(workTypesTable.id, existing.workTypeId));
  const referencePrice = workType?.estimatedPrice ?? null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  type Candidate = {
    id: number;
    name: string;
    distanceMiles: number;
    operatingRadiusMiles: number;
    logoUrl: string | null;
    coversWorkType: boolean;
    insuranceStatus: "valid" | "expiring_soon" | "expired" | "missing";
    insuranceExpirationDate: string | null;
    estimatedPrice: string | null;
    relationshipStatus: "preferred" | "approved" | null;
    isCurrentlyInvited: boolean;
  };

  const candidates: Candidate[] = [];
  for (const v of vendorRows) {
    if (
      v.latitude == null ||
      v.longitude == null ||
      v.operatingRadiusMiles == null
    ) {
      continue;
    }
    const dist = radiusMilesBetween(
      existing.siteLatitude,
      existing.siteLongitude,
      v.latitude,
      v.longitude,
    );
    // Filter to vendors whose published operating radius covers the site —
    // they're realistically able to take the work.
    if (dist > v.operatingRadiusMiles) continue;

    let insuranceStatus: Candidate["insuranceStatus"] = "missing";
    if (v.insuranceExpirationDate) {
      const exp = new Date(v.insuranceExpirationDate);
      if (Number.isFinite(exp.getTime())) {
        const ms = exp.getTime() - today.getTime();
        const days = ms / (1000 * 60 * 60 * 24);
        insuranceStatus =
          days < 0 ? "expired" : days <= 30 ? "expiring_soon" : "valid";
      }
    }

    candidates.push({
      id: v.id,
      name: v.name,
      distanceMiles: Math.round(dist * 10) / 10,
      operatingRadiusMiles: v.operatingRadiusMiles,
      logoUrl: v.logoUrl,
      coversWorkType: vendorsCoveringWorkType.has(v.id),
      insuranceStatus,
      insuranceExpirationDate: v.insuranceExpirationDate ?? null,
      estimatedPrice: referencePrice,
      relationshipStatus:
        v.relationshipStatus === "preferred" || v.relationshipStatus === "approved"
          ? v.relationshipStatus
          : null,
      isCurrentlyInvited: v.id === existing.vendorId,
    });
  }

  candidates.sort((a, b) => {
    // Approved/preferred first, then by distance ascending.
    const aRank = a.relationshipStatus ? 0 : 1;
    const bRank = b.relationshipStatus ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return a.distanceMiles - b.distanceMiles;
  });

  const approved = candidates.filter((c) => !!c.relationshipStatus);
  const unapproved = candidates.filter((c) => !c.relationshipStatus);

  res.json({
    siteLatitude: existing.siteLatitude,
    siteLongitude: existing.siteLongitude,
    workTypeReferencePrice: referencePrice,
    currentVendorId: existing.vendorId,
    approved,
    unapproved,
  });
});

// Task #495 — Direct Award candidate list. Returns the set of vendors a
// partner is allowed to consider for Direct Award on a hotlist job. The
// usual partner-scoped /vendors endpoint is INNER JOINed on
// partner_vendor_relationships, so it would hide the very "unapproved"
// vendors Direct Award is meant to unblock. This endpoint returns any
// vendor that has the requested work type checked on their profile (i.e.
// is at least onboarded for that scope), with their tier annotated so the
// UI can warn the partner before they pick a vendor that will fail the
// COI floor.
router.get("/tickets/direct-award/candidates", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      code: "auth.required",
      error: "auth_required",
      message: "Authentication required",
    });
    return;
  }
  if (session.role !== "partner" || session.partnerId == null) {
    res.status(403).json({
      code: "ticket.partner_role_required",
      error: "partner_role_required",
      message: "Only partners may list direct-award candidates",
    });
    return;
  }
  // Task #848 — query-param validation goes through the orval-generated
  // zod schema so the OpenAPI contract is the single source of truth for
  // what `workTypeId` / `siteLocationId` accept. Per-field error codes
  // are preserved (the partner UI keys off `code` in some places) by
  // inspecting which field failed first.
  const queryParse = GetDirectAwardCandidatesQueryParams.safeParse(req.query);
  if (!queryParse.success) {
    const issue = queryParse.error.issues[0];
    const path = issue?.path?.[0];
    if (path === "workTypeId") {
      res.status(400).json({
        code: "ticket.work_type_id_required",
        error: "work_type_id_required",
        message: "workTypeId query param required",
      });
      return;
    }
    if (path === "siteLocationId") {
      res.status(400).json({
        code: "ticket.site_location_id_required",
        error: "site_location_id_required",
        message: "siteLocationId query param required",
      });
      return;
    }
    res.status(400).json({
      code: "ticket.invalid_query",
      error: "invalid_query",
      message: issue?.message ?? "Invalid query parameters",
    });
    return;
  }
  const { workTypeId, siteLocationId } = queryParse.data;
  const partnerId = session.partnerId;

  // Resolve the site (must be partner-owned) — we need its lat/lng to
  // filter candidates by their published operating radius. Without this
  // the partner would see vendors who can't physically reach the site.
  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteLocationId))
    .limit(1);
  if (!site) {
    res.status(404).json({
      code: "site.not_found",
      error: "site_not_found",
      message: "Site location not found",
    });
    return;
  }
  if (site.partnerId !== partnerId) {
    res.status(403).json({
      code: "site.forbidden_not_owning_partner",
      error: "site_forbidden",
      message: "Site location does not belong to your partner",
    });
    return;
  }

  // Pull every onboarded vendor matching the work type + everything we
  // need to compute distance and the compliance floor in one round-trip.
  const rows = await db
    .selectDistinct({
      id: vendorsTable.id,
      name: vendorsTable.name,
      latitude: vendorsTable.latitude,
      longitude: vendorsTable.longitude,
      operatingRadiusMiles: vendorsTable.operatingRadiusMiles,
      coiDocumentUrl: vendorsTable.coiDocumentUrl,
      insuranceExpirationDate: vendorsTable.insuranceExpirationDate,
      federalTaxId: vendorsTable.federalTaxId,
    })
    .from(vendorsTable)
    .innerJoin(
      vendorWorkTypesTable,
      and(
        eq(vendorWorkTypesTable.vendorId, vendorsTable.id),
        eq(vendorWorkTypesTable.workTypeId, workTypeId),
      ),
    )
    .orderBy(vendorsTable.name);

  // Task #502 — Surface every onboarded vendor matching the work type,
  // not just those who pass the radius + compliance floor. Vendors who
  // fail either gate are returned with `eligible:false` and a structured
  // `ineligibleReason` so the partner UI can grey them out and show the
  // partner *why* they aren't pickable, instead of letting them click
  // through to a server-side rejection.
  //
  // The reason precedence matches the POST endpoint's check order:
  //   1. vendor has no published service area (lat/lng/radius missing)
  //   2. site is not geocoded
  //   3. vendor is out of radius
  //   4. compliance floor (COI / insurance / federal tax id)
  // so the partner sees the same first-failing reason the submit
  // endpoint would reject with.
  const today = new Date();
  type IneligibleReason =
    | "vendor_no_operating_area"
    | "site_not_geocoded"
    | "vendor_out_of_radius"
    | "missing_coi_document"
    | "missing_insurance_expiration"
    | "expired_insurance"
    | "missing_federal_tax_id";
  type Candidate = {
    id: number;
    name: string;
    tier: "pre_onboarded" | "unapproved" | "approved";
    distanceMiles: number | null;
    operatingRadiusMiles: number | null;
    inRadius: boolean;
    compliancePassed: boolean;
    eligible: boolean;
    ineligibleReason: IneligibleReason | null;
    ineligibleMessage: string | null;
  };
  // Task #849 — batch the per-vendor tier lookup. Previously each vendor
  // triggered two SELECTs (partner_vendor_relationships + vendor_work_types)
  // sequentially, so a partner with N in-radius vendors paid ~2N
  // round-trips before the response went out. `getVendorTiersBatch` does
  // the same work in two queries total and we resolve each tier from the
  // returned map in memory.
  const tierByVendorId = await getVendorTiersBatch(
    rows.map((v) => v.id),
    partnerId,
  );
  const candidates: Candidate[] = [];
  for (const v of rows) {
    const tier = tierByVendorId.get(v.id) ?? "pre_onboarded";
    const floor = checkComplianceFloor(
      {
        coiDocumentUrl: v.coiDocumentUrl,
        insuranceExpirationDate: v.insuranceExpirationDate,
        federalTaxId: v.federalTaxId,
      },
      today,
    );
    const compliancePassed = floor.eligible;

    let distanceMiles: number | null = null;
    let inRadius = false;
    let radiusReason: IneligibleReason | null = null;
    let radiusMessage: string | null = null;

    if (
      v.latitude == null ||
      v.longitude == null ||
      v.operatingRadiusMiles == null
    ) {
      radiusReason = "vendor_no_operating_area";
      radiusMessage = "Vendor has not published an operating area";
    } else if (site.latitude == null || site.longitude == null) {
      radiusReason = "site_not_geocoded";
      radiusMessage =
        "Site is not geocoded; vendor reachability cannot be verified";
    } else {
      const dist = radiusMilesBetween(
        site.latitude,
        site.longitude,
        v.latitude,
        v.longitude,
      );
      distanceMiles = Math.round(dist * 10) / 10;
      if (dist > v.operatingRadiusMiles) {
        radiusReason = "vendor_out_of_radius";
        radiusMessage = `Vendor's operating radius (${v.operatingRadiusMiles} mi) does not cover this site (${distanceMiles} mi away)`;
      } else {
        inRadius = true;
      }
    }

    let ineligibleReason: IneligibleReason | null = null;
    let ineligibleMessage: string | null = null;
    if (radiusReason) {
      ineligibleReason = radiusReason;
      ineligibleMessage = radiusMessage;
    } else if (!compliancePassed) {
      ineligibleReason = floor.reason as IneligibleReason;
      ineligibleMessage = floor.message;
    }

    candidates.push({
      id: v.id,
      name: v.name,
      tier,
      distanceMiles,
      operatingRadiusMiles: v.operatingRadiusMiles,
      inRadius,
      compliancePassed,
      eligible: inRadius && compliancePassed,
      ineligibleReason,
      ineligibleMessage,
    });
  }

  // Ordering rules:
  //   1. Eligible vendors first (so they sit at the top of the list).
  //   2. Within each eligibility bucket, partner-trusted tier wins
  //      (approved → unapproved → pre_onboarded) — preserves the prior
  //      grouping the partner UI renders ("Approved" / "Unapproved —
  //      Direct Award").
  //   3. Then in-radius before out-of-radius (in-radius vendors are
  //      closer to actually being awardable — only their compliance
  //      floor needs work).
  //   4. Then by distance ascending; vendors with no distance (no
  //      published operating area) sort last.
  //   5. Then by name as a stable tiebreaker.
  const tierRank: Record<Candidate["tier"], number> = {
    approved: 0,
    unapproved: 1,
    pre_onboarded: 2,
  };
  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (tierRank[a.tier] !== tierRank[b.tier]) {
      return tierRank[a.tier] - tierRank[b.tier];
    }
    if (a.inRadius !== b.inRadius) return a.inRadius ? -1 : 1;
    const ad = a.distanceMiles ?? Number.POSITIVE_INFINITY;
    const bd = b.distanceMiles ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name);
  });
  // Task #848 — validate the response against the OpenAPI-derived zod
  // schema so a future change to the Candidate shape on the server can't
  // silently drift from the contract the generated client hook depends
  // on. Compile-time check via Loose<T> in sendResponse catches missing
  // fields; runtime parse catches anything that slipped past the type
  // system (e.g. an unexpected ineligibleReason value).
  sendResponse(res, GetDirectAwardCandidatesResponse, candidates);
});

// Task #495 — Direct Award. Lets a partner skip the hotlist bid auction
// and hand-pick a vendor for an open hotlist job, even if that vendor is
// not yet "Approved" with the partner. The vendor still has to clear a
// minimum compliance floor (COI on file + non-expired insurance + federal
// tax id + matching work type) — see lib/vendor-tier.ts.
//
// The created ticket lands at `awaiting_acceptance` (intake_channel =
// partner_self_service) and follows the normal Vendor Accept/Deny flow
// from Task #494 — Direct Award is just a bid-bypass, not an Accept-bypass.
//
// Audit trail: ticket_status_history reason = `direct_award_from_hotlist:{jobId}`
// so analytics can later report on how often the override is used.
router.post("/tickets/direct-award", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      code: "auth.required",
      error: "auth_required",
      message: "Authentication required",
    });
    return;
  }
  if (session.role !== "partner" || session.partnerId == null) {
    res.status(403).json({
      code: "ticket.partner_role_required",
      error: "partner_role_required",
      message: "Only partners may direct-award a hotlist job",
    });
    return;
  }

  // Body shape — note: hotlist jobs do not carry siteLocationId or
  // workTypeId, so the partner must supply them at award time. This
  // expands on the spec's `{hotlistJobId, vendorId, scheduledDurationMinutes}`
  // body for the very pragmatic reason that the tickets table requires
  // both fields.
  const hotlistJobId = Number(req.body?.hotlistJobId);
  const vendorId = Number(req.body?.vendorId);
  const siteLocationId = Number(req.body?.siteLocationId);
  const workTypeId = Number(req.body?.workTypeId);
  const scheduledDurationMinutesRaw = req.body?.scheduledDurationMinutes;
  const scheduledStartAtRaw = req.body?.scheduledStartAt;
  if (!Number.isFinite(hotlistJobId) || hotlistJobId <= 0) {
    res.status(400).json({
      code: "ticket.hotlist_job_id_required",
      error: "hotlist_job_id_required",
      message: "hotlistJobId is required",
    });
    return;
  }
  if (!Number.isFinite(vendorId) || vendorId <= 0) {
    res.status(400).json({
      code: "ticket.vendor_id_required",
      error: "vendor_id_required",
      message: "vendorId is required",
    });
    return;
  }
  if (!Number.isFinite(siteLocationId) || siteLocationId <= 0) {
    res.status(400).json({
      code: "ticket.site_location_id_required",
      error: "site_location_id_required",
      message: "siteLocationId is required",
    });
    return;
  }
  if (!Number.isFinite(workTypeId) || workTypeId <= 0) {
    res.status(400).json({
      code: "ticket.work_type_id_required",
      error: "work_type_id_required",
      message: "workTypeId is required",
    });
    return;
  }
  let scheduledDurationMinutes: number | null = null;
  if (scheduledDurationMinutesRaw != null) {
    const n = Number(scheduledDurationMinutesRaw);
    if (!Number.isFinite(n) || n < 0) {
      res.status(400).json({
        code: "ticket.scheduled_duration_invalid",
        error: "scheduled_duration_invalid",
        message: "scheduledDurationMinutes must be a non-negative integer",
      });
      return;
    }
    scheduledDurationMinutes = Math.round(n);
  }
  let scheduledStartAt: Date | null = null;
  if (scheduledStartAtRaw) {
    const d = new Date(scheduledStartAtRaw);
    if (!Number.isFinite(d.getTime())) {
      res.status(400).json({
        code: "ticket.scheduled_start_invalid",
        error: "scheduled_start_invalid",
        message: "scheduledStartAt is not a valid date",
      });
      return;
    }
    scheduledStartAt = d;
  }

  // Hotlist job — must exist, be open, partner-owned, not deleted.
  const [job] = await db
    .select({
      id: hotlistJobsTable.id,
      partnerId: hotlistJobsTable.partnerId,
      status: hotlistJobsTable.status,
      title: hotlistJobsTable.title,
      deletedAt: hotlistJobsTable.deletedAt,
    })
    .from(hotlistJobsTable)
    .where(eq(hotlistJobsTable.id, hotlistJobId));
  if (!job || job.deletedAt) {
    res.status(404).json({
      code: "hotlist.not_found",
      error: "hotlist_job_not_found",
      message: "Hotlist job not found",
    });
    return;
  }
  if (job.partnerId !== session.partnerId) {
    res.status(403).json({
      code: "hotlist.forbidden_not_owning_partner",
      error: "forbidden_not_owning_partner",
      message: "Only the posting partner may direct-award this job",
    });
    return;
  }
  if (job.status !== "open") {
    res.status(409).json({
      code: "hotlist.not_open",
      error: "hotlist_job_not_open",
      message: `Hotlist job is ${job.status} and can no longer be awarded`,
    });
    return;
  }

  // Site — must exist and be partner-owned.
  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      name: siteLocationsTable.name,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteLocationId));
  if (!site) {
    res.status(404).json({
      code: "site.not_found",
      error: "site_not_found",
      message: "Site not found",
    });
    return;
  }
  if (site.partnerId !== session.partnerId) {
    res.status(403).json({
      code: "site.forbidden_not_owning_partner",
      error: "site_forbidden",
      message: "Site does not belong to your partner organization",
    });
    return;
  }

  // Work type — must exist.
  const [workType] = await db
    .select({ id: workTypesTable.id, name: workTypesTable.name })
    .from(workTypesTable)
    .where(eq(workTypesTable.id, workTypeId));
  if (!workType) {
    res.status(404).json({
      code: "work_type.not_found",
      error: "work_type_not_found",
      message: "Work type not found",
    });
    return;
  }

  // Vendor — must exist and have lat/lng/radius set; in-radius from site.
  const [vendor] = await db
    .select({
      id: vendorsTable.id,
      name: vendorsTable.name,
      latitude: vendorsTable.latitude,
      longitude: vendorsTable.longitude,
      operatingRadiusMiles: vendorsTable.operatingRadiusMiles,
    })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, vendorId));
  if (!vendor) {
    res.status(404).json({
      code: "vendor.not_found",
      error: "vendor_not_found",
      message: "Vendor not found",
    });
    return;
  }
  if (
    vendor.latitude == null ||
    vendor.longitude == null ||
    vendor.operatingRadiusMiles == null
  ) {
    res.status(400).json({
      code: "vendor.no_operating_area",
      error: "vendor_no_operating_area",
      message: "Vendor has not published an operating area",
    });
    return;
  }
  if (site.latitude == null || site.longitude == null) {
    res.status(400).json({
      code: "site.not_geocoded",
      error: "site_not_geocoded",
      message: "Site is not geocoded; cannot verify vendor radius",
    });
    return;
  }
  const dist = radiusMilesBetween(
    site.latitude,
    site.longitude,
    vendor.latitude,
    vendor.longitude,
  );
  if (dist > vendor.operatingRadiusMiles) {
    res.status(400).json({
      code: "vendor.out_of_radius",
      error: "vendor_out_of_radius",
      message: `Vendor's operating radius (${vendor.operatingRadiusMiles} mi) does not cover the site (${Math.round(dist)} mi away)`,
    });
    return;
  }

  // Compliance floor + work-type membership check (single helper call).
  const eligibility = await isDirectAwardEligible(vendorId, workTypeId);
  if (!eligibility.eligible) {
    res.status(400).json({
      code: `vendor.${eligibility.reason}`,
      error: eligibility.reason,
      message: eligibility.message,
    });
    return;
  }

  // Auto-create the site_work_assignment if missing — see /reinvite for the
  // same pattern. The partner is explicitly choosing this vendor for this
  // site/work type, so we bootstrap the relationship row.
  const result = await db.transaction(async (tx) => {
    const [existingAssignment] = await tx
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, siteLocationId),
          eq(siteWorkAssignmentsTable.vendorId, vendorId),
          eq(siteWorkAssignmentsTable.workTypeId, workTypeId),
        ),
      );
    if (!existingAssignment) {
      await tx.insert(siteWorkAssignmentsTable).values({
        siteLocationId,
        vendorId,
        workTypeId,
      });
    }

    const [t] = await tx
      .insert(ticketsTable)
      .values({
        siteLocationId,
        vendorId,
        workTypeId,
        status: "awaiting_acceptance",
        intakeChannel: "partner_self_service",
        lifecycleState: "pending_arrival",
        createdById: session.userId,
        scheduledStartAt,
        scheduledDurationMinutes,
        description: `Direct-award from Hotlist job: ${job.title}`,
      })
      .returning();

    await recordTicketTransition({
      tx,
      ticketId: t.id,
      fromStatus: null,
      toStatus: "awaiting_acceptance",
      actorUserId: session.userId,
      actorRole: session.role,
      reason: `direct_award_from_hotlist:${hotlistJobId}`,
    });

    // Compare-and-swap on the hotlist job — only flip from open → awarded if
    // it is still open. Prevents a race where two partner users direct-award
    // (or one direct-awards while another awards a bid) simultaneously.
    const [hotlistUpdated] = await tx
      .update(hotlistJobsTable)
      .set({
        status: "awarded",
        awardedVendorId: vendorId,
      })
      .where(
        and(
          eq(hotlistJobsTable.id, hotlistJobId),
          eq(hotlistJobsTable.status, "open"),
        ),
      )
      .returning();
    if (!hotlistUpdated) {
      throw new Error("hotlist_job_state_changed");
    }

    return t;
  }).catch((err: any) => {
    if (err?.message === "hotlist_job_state_changed") {
      return { __raceLost: true } as const;
    }
    throw err;
  });

  if ("__raceLost" in result && result.__raceLost) {
    res.status(409).json({
      code: "hotlist.state_changed",
      error: "hotlist_job_state_changed",
      message: "Hotlist job was awarded by someone else; refresh and try again",
    });
    return;
  }

  const ticket = result as { id: number };
  const [full] = await ticketQuery().where(eq(ticketsTable.id, ticket.id));

  // Notify the chosen vendor — same pattern as /tickets POST when
  // intakeChannel === partner_self_service, but with a more specific copy
  // so the vendor knows this came via Direct Award rather than a normal
  // partner-self-service ticket.
  try {
    const vendorUserIds = await findVendorUserIds(vendorId);
    const trackingNumber = String(ticket.id).padStart(8, "0");
    await notifyUsers(vendorUserIds, {
      type: "ticket_direct_award",
      title: "You were direct-awarded a Hotlist job",
      body: `${full?.partnerName ?? "A partner"} awarded you ticket #${trackingNumber} for "${job.title}". Accept or deny to proceed.`,
      link: `/tickets/${ticket.id}`,
    });
  } catch (e) {
    console.error("[tickets] failed to notify vendor of direct award", e);
  }

  sendResponseStatus(res, 201, GetTicketResponse, full);
});

// @no-accept-guard: admin-only role check below + an explicit status
// guard requiring "submitted" or "approved" before unlocking. Both states
// are post-accept by definition, so the pre-accept bypass cannot reach
// this endpoint. See Task #500 checklist at the top of this file.
router.post("/tickets/:id/unlock", async (req, res): Promise<void> => {
  const params = UnlockTicketParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const parsed = UnlockTicketBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }
  const reason = parsed.data.reason.trim();
  if (!reason) {
    res.status(400).json({
      code: "ticket.unlock_reason_required",
      error: "unlock_reason_required",
      message: "Reason is required",
    });
    return;
  }
  if (reason.length > 500) {
    res.status(400).json({
      code: "ticket.unlock_reason_too_long",
      error: "unlock_reason_too_long",
      message: "Reason must be 500 characters or fewer",
    });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({
      code: "auth.not_authenticated",
      error: "not_authenticated",
      message: "Not authenticated",
    });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({
      code: "ticket.forbidden_admin_only",
      error: "forbidden_admin_only",
      message: "Only admins can unlock a ticket",
    });
    return;
  }
  const [existing] = await db
    .select({ id: ticketsTable.id, status: ticketsTable.status, fieldEmployeeId: ticketsTable.fieldEmployeeId })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (existing.status !== "submitted" && existing.status !== "approved") {
    res.status(409).json({
      code: "ticket.not_unlockable",
      error: "ticket_not_unlockable",
      message: `Ticket is ${existing.status.replace(/_/g, " ")} and cannot be unlocked`,
    });
    return;
  }
  const previousStatus = existing.status;
  // Status flip + audit logs (note + ticket_unlocks + ticket_status_history)
  // all commit atomically; otherwise a partial failure could leave the
  // ticket in_progress without an unlock-audit row, which the legacy
  // dashboards rely on.
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(ticketsTable)
      .set({
        status: "in_progress",
        unlockedAt: new Date(),
        unlockedById: session.userId,
        unlockCount: sql`${ticketsTable.unlockCount} + 1`,
      })
      .where(eq(ticketsTable.id, params.data.id))
      .returning();
    if (!u) return undefined;
    await tx.insert(ticketNoteLogsTable).values({
      ticketId: u.id,
      content: `Ticket unlocked for editing by admin (was ${previousStatus.replace(/_/g, " ")}). Reason: ${reason}`,
      createdById: session.userId,
    });
    await tx.insert(ticketUnlocksTable).values({
      ticketId: u.id,
      unlockedById: session.userId,
      previousStatus,
      reason,
    });
    await recordTicketTransition({
      tx,
      ticketId: u.id,
      fromStatus: previousStatus,
      toStatus: "in_progress",
      actorUserId: session.userId,
      actorRole: session.role,
      reason: `unlock: ${reason}`,
    });
    return u;
  });
  if (!updated) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (updated.fieldEmployeeId) {
    void sendPushToFieldEmployee(updated.fieldEmployeeId, {
      title: "Tracking Unlocked",
      body: `Tracking #${String(updated.id).padStart(4, "0")} was unlocked for editing.`,
      data: { ticketId: updated.id, type: "ticket_unlocked" },
    });
  }
  const [result] = await ticketQuery().where(eq(ticketsTable.id, updated.id));
  sendResponse(res, UnlockTicketResponse, result);
});

router.get("/tickets/:id/unlocks", async (req, res): Promise<void> => {
  const params = GetTicketUnlocksParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  const rows = await db
    .select({
      id: ticketUnlocksTable.id,
      ticketId: ticketUnlocksTable.ticketId,
      unlockedAt: ticketUnlocksTable.unlockedAt,
      unlockedById: ticketUnlocksTable.unlockedById,
      unlockedByName: usersTable.displayName,
      previousStatus: ticketUnlocksTable.previousStatus,
      reason: ticketUnlocksTable.reason,
    })
    .from(ticketUnlocksTable)
    .leftJoin(usersTable, eq(ticketUnlocksTable.unlockedById, usersTable.id))
    .where(eq(ticketUnlocksTable.ticketId, params.data.id))
    .orderBy(desc(ticketUnlocksTable.unlockedAt));
  sendResponse(res, GetTicketUnlocksResponse, rows);
});

// Task #501: chronological audit trail of every status transition recorded
// in `ticket_status_history`. The list returned to the UI mirrors the rows
// inserted by `recordTicketTransition()` from accept/deny/reinvite/cancel/
// unlock/etc handlers, plus the `vendor #N` references emitted by the
// reinvite flow are resolved to vendor names server-side so partners see
// "reassigned from Acme Mechanical to Permian Welders" instead of opaque
// IDs. Access control matches the rest of the per-ticket detail surface:
// any role that can see the ticket detail page can see its audit trail.
router.get("/tickets/:id/transitions", async (req, res): Promise<void> => {
  const params = GetTicketTransitionsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  // Task #857: power-user filters mirror the Audit Trail filter chips on
  // the web ticket-detail page. Filtering happens in JS after the row
  // fetch (the per-ticket trail is bounded to a few dozen rows in
  // practice) so the same code path can produce JSON or CSV from the
  // identical row set.
  const filters: AuditTrailFilters = {
    kinds: parseKindFilter(req.query.kind),
    actorRoles: parseActorRoleFilter(req.query.actorRole),
    from: parseDateBound(req.query.from),
    to: parseDateBound(req.query.to),
  };
  const wantsCsv = String(req.query.format ?? "json").toLowerCase() === "csv";
  const rows = await db
    .select({
      id: ticketStatusHistoryTable.id,
      ticketId: ticketStatusHistoryTable.ticketId,
      fromStatus: ticketStatusHistoryTable.fromStatus,
      toStatus: ticketStatusHistoryTable.toStatus,
      actorUserId: ticketStatusHistoryTable.actorUserId,
      actorName: usersTable.displayName,
      actorRole: ticketStatusHistoryTable.actorRole,
      reason: ticketStatusHistoryTable.reason,
      createdAt: ticketStatusHistoryTable.createdAt,
    })
    .from(ticketStatusHistoryTable)
    .leftJoin(
      usersTable,
      eq(ticketStatusHistoryTable.actorUserId, usersTable.id),
    )
    .where(eq(ticketStatusHistoryTable.ticketId, params.data.id))
    .orderBy(
      asc(ticketStatusHistoryTable.createdAt),
      asc(ticketStatusHistoryTable.id),
    );

  // Collect every vendor ID referenced by the partner-self-service reinvite
  // reason format (`reassigned from vendor #X to vendor #Y`). One round-trip
  // resolves them all so we can rewrite the reason text and expose
  // structured `fromVendorName`/`toVendorName` fields.
  const reinvitePattern =
    /^reassigned from vendor #(\d+) to vendor #(\d+)$/i;
  const vendorIdSet = new Set<number>();
  for (const r of rows) {
    if (!r.reason) continue;
    const m = r.reason.match(reinvitePattern);
    if (m) {
      vendorIdSet.add(Number(m[1]));
      vendorIdSet.add(Number(m[2]));
    }
  }
  const vendorNamesById = new Map<number, string>();
  if (vendorIdSet.size > 0) {
    const vendorRows = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(
        sql`${vendorsTable.id} IN (${sql.join(
          Array.from(vendorIdSet).map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    for (const v of vendorRows) {
      vendorNamesById.set(v.id, v.name);
    }
  }

  const enriched = rows.map((r) => {
    let displayReason: string | null = r.reason;
    let fromVendorName: string | null = null;
    let toVendorName: string | null = null;
    if (r.reason) {
      const m = r.reason.match(reinvitePattern);
      if (m) {
        const fromId = Number(m[1]);
        const toId = Number(m[2]);
        fromVendorName = vendorNamesById.get(fromId) ?? `vendor #${fromId}`;
        toVendorName = vendorNamesById.get(toId) ?? `vendor #${toId}`;
        displayReason = `reassigned from ${fromVendorName} to ${toVendorName}`;
      }
    }
    return {
      ...r,
      displayReason,
      fromVendorName,
      toVendorName,
    };
  });

  const filtered = applyAuditTrailFilters(enriched, filters);

  if (wantsCsv) {
    const csv = auditTrailToCsv(filtered);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${auditTrailCsvFilename(["audit-trail", `ticket-${params.data.id}`])}"`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
    return;
  }

  sendResponse(res, GetTicketTransitionsResponse, filtered);
});

// Task #857: aggregate audit-trail export. Lets a partner ops lead pull
// every denial / reinvite / cancel across all of their tickets in the
// last 30 days for an SLA review (or an admin scrubbing a 1099 / safety
// audit) without scraping the per-ticket page row-by-row. Always returns
// CSV — there is no JSON variant because the only consumer is a download
// link in the web tickets list page. Tenant scope is enforced server-side
// (partner sessions are pinned to their own partnerId, vendor sessions to
// their own vendorId), so a request from a partner cannot exfiltrate
// another partner's history even if they hand-craft a `partnerId=` param.
router.get(
  "/tickets/audit-trail/export",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({
        message: "Authentication required",
        code: "auth.required",
      });
      return;
    }
    if (
      session.role !== "admin" &&
      session.role !== "partner" &&
      session.role !== "vendor"
    ) {
      res.status(403).json({
        message: "Audit-trail export is restricted to admin/partner/vendor",
        code: "audit_trail.export_forbidden",
      });
      return;
    }

    const filters: AuditTrailFilters = {
      kinds: parseKindFilter(req.query.kind),
      actorRoles: parseActorRoleFilter(req.query.actorRole),
      from: parseDateBound(req.query.from),
      to: parseDateBound(req.query.to),
    };

    const conditions: any[] = [];
    // Tenant scope: partners and vendors are pinned to their own org. The
    // request body's `partnerId`/`vendorId` are accepted for admins only;
    // for partner/vendor sessions they are ignored if they would widen
    // scope (we still apply the session's own scope filter).
    if (session.role === "partner" && session.partnerId != null) {
      conditions.push(eq(siteLocationsTable.partnerId, session.partnerId));
    } else if (session.role === "vendor" && session.vendorId != null) {
      conditions.push(eq(ticketsTable.vendorId, session.vendorId));
    } else if (session.role === "admin") {
      const partnerIdRaw = req.query.partnerId;
      const vendorIdRaw = req.query.vendorId;
      const partnerId =
        typeof partnerIdRaw === "string" && partnerIdRaw.length > 0
          ? Number(partnerIdRaw)
          : null;
      const vendorId =
        typeof vendorIdRaw === "string" && vendorIdRaw.length > 0
          ? Number(vendorIdRaw)
          : null;
      if (partnerId != null && Number.isFinite(partnerId)) {
        conditions.push(eq(siteLocationsTable.partnerId, partnerId));
      }
      if (vendorId != null && Number.isFinite(vendorId)) {
        conditions.push(eq(ticketsTable.vendorId, vendorId));
      }
    }

    if (filters.from != null) {
      conditions.push(
        sql`${ticketStatusHistoryTable.createdAt} >= ${filters.from.toISOString()}`,
      );
    }
    if (filters.to != null) {
      conditions.push(
        sql`${ticketStatusHistoryTable.createdAt} <= ${filters.to.toISOString()}`,
      );
    }

    const baseQuery = db
      .select({
        id: ticketStatusHistoryTable.id,
        ticketId: ticketStatusHistoryTable.ticketId,
        fromStatus: ticketStatusHistoryTable.fromStatus,
        toStatus: ticketStatusHistoryTable.toStatus,
        actorUserId: ticketStatusHistoryTable.actorUserId,
        actorName: usersTable.displayName,
        actorRole: ticketStatusHistoryTable.actorRole,
        reason: ticketStatusHistoryTable.reason,
        createdAt: ticketStatusHistoryTable.createdAt,
      })
      .from(ticketStatusHistoryTable)
      .innerJoin(
        ticketsTable,
        eq(ticketStatusHistoryTable.ticketId, ticketsTable.id),
      )
      .leftJoin(
        siteLocationsTable,
        eq(ticketsTable.siteLocationId, siteLocationsTable.id),
      )
      .leftJoin(
        usersTable,
        eq(ticketStatusHistoryTable.actorUserId, usersTable.id),
      );

    const rows = conditions.length > 0
      ? await baseQuery
          .where(and(...conditions))
          .orderBy(
            asc(ticketStatusHistoryTable.createdAt),
            asc(ticketStatusHistoryTable.id),
          )
      : await baseQuery.orderBy(
          asc(ticketStatusHistoryTable.createdAt),
          asc(ticketStatusHistoryTable.id),
        );

    // Resolve `vendor #N` → vendor names, same as the per-ticket route.
    const reinvitePattern =
      /^reassigned from vendor #(\d+) to vendor #(\d+)$/i;
    const vendorIdSet = new Set<number>();
    for (const r of rows) {
      if (!r.reason) continue;
      const m = r.reason.match(reinvitePattern);
      if (m) {
        vendorIdSet.add(Number(m[1]));
        vendorIdSet.add(Number(m[2]));
      }
    }
    const vendorNamesById = new Map<number, string>();
    if (vendorIdSet.size > 0) {
      const vendorRows = await db
        .select({ id: vendorsTable.id, name: vendorsTable.name })
        .from(vendorsTable)
        .where(
          sql`${vendorsTable.id} IN (${sql.join(
            Array.from(vendorIdSet).map((v) => sql`${v}`),
            sql`, `,
          )})`,
        );
      for (const v of vendorRows) {
        vendorNamesById.set(v.id, v.name);
      }
    }

    const enriched = rows.map((r) => {
      let displayReason: string | null = r.reason;
      let fromVendorName: string | null = null;
      let toVendorName: string | null = null;
      if (r.reason) {
        const m = r.reason.match(reinvitePattern);
        if (m) {
          const fromId = Number(m[1]);
          const toId = Number(m[2]);
          fromVendorName = vendorNamesById.get(fromId) ?? `vendor #${fromId}`;
          toVendorName = vendorNamesById.get(toId) ?? `vendor #${toId}`;
          displayReason = `reassigned from ${fromVendorName} to ${toVendorName}`;
        }
      }
      return {
        ...r,
        displayReason,
        fromVendorName,
        toVendorName,
      };
    });

    // Kind/actorRole filtering happens in JS — both depend on values
    // (derived kind, NULL actor → "system") that the SQL layer cannot
    // express ergonomically without leaking the taxonomy into the
    // database query.
    const filtered = applyAuditTrailFilters(enriched, filters);
    const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "csv";
    if (format === "pdf") {
      const { renderReportPdf } = await import("../lib/reports/pdf");
      const fmtTs = (d: Date | null) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) : "");
      const pdfRows = filtered.map((r) => [
        String(r.ticketId ?? ""),
        fmtTs(r.createdAt as Date | null),
        `${r.fromStatus ?? ""} → ${r.toStatus ?? ""}`,
        r.actorName ?? "system",
        r.actorRole ?? "",
        r.displayReason ?? "",
      ]);
      const buf = await renderReportPdf({
        title: "Ticket Audit Trail",
        subtitle: `${filtered.length} transition${filtered.length === 1 ? "" : "s"} — exported by ${session.role} #${session.userId}`,
        columns: [
          { header: "Ticket #", width: 0.9 },
          { header: "When (UTC)", width: 1.6 },
          { header: "Transition", width: 2.4 },
          { header: "Actor", width: 1.8 },
          { header: "Role", width: 1.0 },
          { header: "Reason", width: 3.0 },
        ],
        rows: pdfRows,
      });
      const baseName = auditTrailCsvFilename(["audit-trail", `${session.role}-${session.userId}`]).replace(/\.csv$/i, ".pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}"`);
      res.setHeader("Cache-Control", "no-store");
      res.end(buf);
      return;
    }
    const csv = auditTrailToCsv(filtered);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${auditTrailCsvFilename(["audit-trail", `${session.role}-${session.userId}`])}"`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  },
);

// Task #858 — vendor scorecard rollup. Surfaces top denial reasons and
// the accept rate computed from `ticket_status_history`. Mirrors the
// access rules of the legacy `/analytics/vendor/:vendorId` route:
// admins see any vendor; vendor users only their own.
router.get(
  "/tickets/transitions/aggregate/vendor/:vendorId",
  async (req, res): Promise<void> => {
    const params = GetVendorTransitionAggregateParams.safeParse(req.params);
    if (!params.success) {
      sendValidationFailed(res, params.error);
      return;
    }
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ message: "Authentication required", code: "auth.required" });
      return;
    }
    const vendorId = params.data.vendorId;
    if (session.role === "vendor") {
      if ((session.vendorId ?? null) !== vendorId) {
        res.status(403).json({ message: "Access denied", code: "vendor.no_access" });
        return;
      }
    } else if (session.role !== "admin") {
      res.status(403).json({ message: "Access denied", code: "vendor.no_access" });
      return;
    }
    const result = await aggregateVendorTransitions(vendorId);
    sendResponse(res, GetVendorTransitionAggregateResponse, result);
  },
);

// Task #858 — partner KPI rollup. Returns mean time-to-acceptance from
// `ticket_status_history` for tickets at the partner's sites. Same
// tenant scope as `/analytics/partner/:partnerId`: admins see any
// partner; partner users only their own.
router.get(
  "/tickets/transitions/aggregate/partner/:partnerId",
  async (req, res): Promise<void> => {
    const params = GetPartnerTransitionAggregateParams.safeParse(req.params);
    if (!params.success) {
      sendValidationFailed(res, params.error);
      return;
    }
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ message: "Authentication required", code: "auth.required" });
      return;
    }
    const partnerId = params.data.partnerId;
    if (session.role === "partner") {
      if ((session.partnerId ?? null) !== partnerId) {
        res.status(403).json({ message: "Access denied", code: "partner.no_access" });
        return;
      }
    } else if (session.role !== "admin") {
      res.status(403).json({ message: "Access denied", code: "partner.no_access" });
      return;
    }
    const result = await aggregatePartnerTransitions(partnerId);
    sendResponse(res, GetPartnerTransitionAggregateResponse, result);
  },
);

// Task #858 — admin "Reassignments" tile. Counts tickets that bounced
// through 2+ vendors plus a top-50 drilldown so the admin can click
// through to the per-ticket transitions page. Admin-only.
router.get(
  "/tickets/transitions/aggregate/admin/reassignments",
  async (req, res): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ message: "Authentication required", code: "auth.required" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ message: "Admin only", code: "admin.required" });
      return;
    }
    const result = await aggregateAdminReassignments();
    sendResponse(res, GetAdminReassignmentAggregateResponse, result);
  },
);

router.post("/tickets/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelTicketParams.safeParse(req.params);
  if (!params.success) {
    // Task #533: structured code matches the rest of the mutation surface.
    sendValidationFailed(res, params.error, { code: "ticket.invalid_id", error: "invalid_ticket_id" });
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  const [existing] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, params.data.id));
  if (!existing) {
    // Task #533: lift to the {code, error, message} shape so clients can
    // translate via `errors.ticket_not_found` instead of pattern-matching
    // the English string.
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  // Task #494: vendors and field employees must use /deny (not /cancel) to
  // opt out of an unaccepted invite. Only partners (the inviter) and admins
  // are allowed to retract a ticket that has not been accepted yet —
  // everyone else gets 409 ticket_not_accepted.
  const cancelSession = getSession(req);
  if (
    PRE_ACCEPT_STATUSES.has(existing.status) &&
    cancelSession?.role !== "admin" &&
    cancelSession?.role !== "partner"
  ) {
    res.status(409).json({
      code: "ticket.not_accepted",
      error: TICKET_NOT_ACCEPTED,
      message: "Use Deny to decline an unaccepted invite",
    });
    return;
  }
  if (existing.status === "cancelled") {
    const [result] = await ticketQuery().where(eq(ticketsTable.id, existing.id));
    sendResponse(res, CancelTicketResponse, result);
    return;
  }
  // Task #497: once a partner's AP team has dispersed funds the ticket is in
  // a financially terminal state. Cancelling it would orphan the payment
  // record and let the vendor lose their visibility into the payment, so we
  // block the transition entirely. Reactivation/refunds need a separate
  // accounting workflow we have not yet built.
  if (existing.status === "funds_dispersed") {
    // Task #533: align with the snake_case `error` + dotted legacy `code`
    // pattern used by /disperse-funds (ticket_not_approved /
    // ticket.not_approved) and /en-route. Mobile clients pre-#527 still
    // match on the dotted legacy form.
    res.status(409).json({
      code: "ticket.funds_dispersed",
      error: "ticket_funds_dispersed",
      message: "Ticket cannot be cancelled after funds have been dispersed",
    });
    return;
  }
  const session = getSession(req);
  await db.transaction(async (tx) => {
    await tx
      .update(ticketsTable)
      .set({
        status: "cancelled",
        preCancelStatus: existing.status,
        cancelledAt: new Date(),
        cancelledById: session?.userId ?? null,
      })
      .where(eq(ticketsTable.id, params.data.id));
    await recordTicketTransition({
      tx,
      ticketId: existing.id,
      fromStatus: existing.status,
      toStatus: "cancelled",
      actorUserId: session?.userId ?? null,
      actorRole: session?.role ?? null,
      reason: "ticket cancelled",
    });
  });
  const [result] = await ticketQuery().where(eq(ticketsTable.id, existing.id));
  sendResponse(res, CancelTicketResponse, result);
});

// @no-accept-guard: admin-only role check below + an explicit status
// guard requiring "cancelled" before reactivating. A pre-accept ticket
// must be cancelled first via /cancel (which already enforces the
// PRE_ACCEPT_STATUSES role policy), so the bypass cannot reach here.
// See Task #500 checklist at the top of this file.
router.post("/tickets/:id/reactivate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ code: "ticket.invalid_ticket_id", error: "invalid_ticket_id", message: "Invalid id" });
    return;
  }
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    res.status(403).json({
      code: "ticket.forbidden_admin_only",
      error: "forbidden_admin_only",
      message: "Admin only",
    });
    return;
  }
  const [existing] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!existing) {
    res.status(404).json({
      code: "ticket.not_found",
      error: "ticket_not_found",
      message: "Ticket not found",
    });
    return;
  }
  if (existing.status !== "cancelled") {
    res.status(400).json({
      code: "ticket.not_cancelled",
      error: "ticket_not_cancelled",
      message: "Ticket is not cancelled",
    });
    return;
  }
  // Fallback to the new lifecycle entry point if we somehow lost the prior
  // status (very old cancelled tickets pre-date pre_cancel_status). "open"
  // was the legacy fallback but is not a valid value in the lifecycle set
  // and would orphan the ticket from every status-aware reader.
  const restoredStatus = existing.preCancelStatus ?? "initiated";
  await db.transaction(async (tx) => {
    await tx
      .update(ticketsTable)
      .set({
        status: restoredStatus,
        preCancelStatus: null,
        cancelledAt: null,
        cancelledById: null,
      })
      .where(eq(ticketsTable.id, id));
    await recordTicketTransition({
      tx,
      ticketId: id,
      fromStatus: "cancelled",
      toStatus: restoredStatus,
      actorUserId: session.userId,
      actorRole: session.role,
      reason: "ticket reactivated",
    });
  });
  const [result] = await ticketQuery().where(eq(ticketsTable.id, id));
  sendResponse(res, CancelTicketResponse, result);
});

router.get("/tickets/:id/gps-logs", async (req, res): Promise<void> => {
  const params = GetTicketGpsLogsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  const logs = await db.select().from(gpsLogsTable).where(eq(gpsLogsTable.ticketId, params.data.id)).orderBy(gpsLogsTable.recordedAt);
  sendResponse(res, GetTicketGpsLogsResponse, logs);
});

router.get("/tickets/:id/note-logs", async (req, res): Promise<void> => {
  const params = GetTicketNoteLogsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  const logs = await db
    .select({
      id: ticketNoteLogsTable.id,
      ticketId: ticketNoteLogsTable.ticketId,
      content: ticketNoteLogsTable.content,
      createdAt: ticketNoteLogsTable.createdAt,
      createdById: ticketNoteLogsTable.createdById,
      createdByName: usersTable.displayName,
      createdByRole: usersTable.role,
    })
    .from(ticketNoteLogsTable)
    .leftJoin(usersTable, eq(ticketNoteLogsTable.createdById, usersTable.id))
    .where(eq(ticketNoteLogsTable.ticketId, params.data.id))
    .orderBy(desc(ticketNoteLogsTable.createdAt));
  sendResponse(res, GetTicketNoteLogsResponse, logs);
});

router.post("/tickets/:id/note-logs", async (req, res): Promise<void> => {
  const params = CreateTicketNoteLogParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  if (!(await ensureTicketMutable(req, res, params.data.id))) return;
  const parsed = CreateTicketNoteLogBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }
  const session = getSession(req);
  const [log] = await db
    .insert(ticketNoteLogsTable)
    .values({
      ticketId: params.data.id,
      content: parsed.data.content,
      createdById: session?.userId ?? null,
    })
    .returning();
  res.status(201).json(log);
});

// @no-accept-guard: Task #846 — soft-deletes a single row in
// ticketNoteLogsTable (only stamps `deletedAt` / `deletedById` on the
// note). It does not read or write `ticketsTable.status`, so it cannot
// drive a pre-accept ticket forward. Note creation IS guarded by
// `ensureTicketMutable` on POST /tickets/:id/note-logs; deletion of an
// existing note is intentionally allowed in any ticket state so audit
// history can be moderated post-acceptance. If this ever starts
// triggering a status transition, gate it with `ensureAccepted` and
// drop this opt-out.
router.delete("/tickets/:id/note-logs/:noteId", async (req, res): Promise<void> => {
  const params = DeleteTicketNoteLogParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  // Soft-delete to preserve audit/discussion history; the unified comments
  // model never hard-deletes ticket notes.
  const session = getSession(req);
  await db
    .update(ticketNoteLogsTable)
    .set({ deletedAt: new Date(), deletedById: session?.userId ?? null })
    .where(
      and(
        eq(ticketNoteLogsTable.id, params.data.noteId),
        eq(ticketNoteLogsTable.ticketId, params.data.id),
      ),
    );
  res.json({ success: true });
});

router.get("/tickets/:id/line-items", async (req, res): Promise<void> => {
  const params = GetTicketLineItemsParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  const items = await db
    .select()
    .from(ticketLineItemsTable)
    .where(eq(ticketLineItemsTable.ticketId, params.data.id))
    .orderBy(desc(ticketLineItemsTable.createdAt));
  res.json(items);
});

router.post("/tickets/:id/line-items", async (req, res): Promise<void> => {
  const params = CreateTicketLineItemParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  if (!(await ensureTicketMutable(req, res, params.data.id))) return;
  const parsed = CreateTicketLineItemBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error);
    return;
  }
  const [item] = await db
    .insert(ticketLineItemsTable)
    .values({ ticketId: params.data.id, ...parsed.data })
    .returning();
  res.status(201).json(item);
});

router.delete("/tickets/:id/line-items/:lineItemId", async (req, res): Promise<void> => {
  const params = DeleteTicketLineItemParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  if (!(await ensureFieldOwnership(req, res, params.data.id))) return;
  if (!(await ensureTicketMutable(req, res, params.data.id))) return;
  await db
    .delete(ticketLineItemsTable)
    .where(
      and(
        eq(ticketLineItemsTable.id, params.data.lineItemId),
        eq(ticketLineItemsTable.ticketId, params.data.id),
      ),
    );
  res.json({ success: true });
});

router.get("/tax-rates", async (_req, res): Promise<void> => {
  const rates = await db.select().from(taxRatesTable);
  res.json(rates);
});

router.get("/tax-rates/by-state/:state", async (req, res): Promise<void> => {
  const params = GetTaxRateByStateParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error);
    return;
  }
  const [rate] = await db
    .select()
    .from(taxRatesTable)
    .where(eq(taxRatesTable.state, params.data.state.toUpperCase()));
  if (!rate) {
    res.status(404).json({
      code: "tax_rate.not_found",
      error: "tax_rate_not_found",
      message: "Tax rate not found for state",
    });
    return;
  }
  res.json(rate);
});

export default router;
