import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  partnerContactsTable,
  partnersTable,
  ticketCrewTable,
  ticketNoteLogsTable,
  userOrgMembershipsTable,
  usersTable,
  vendorPeopleTable,
  vendorsTable,
} from "@workspace/db";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import {
  findPartnerUserIds,
  findVendorUserIds,
  notifyUsers,
} from "../routes/notifications";
import { ACCOUNTS_PAYABLE_ROLE } from "./ap-role";
import {
  fieldEmployeeCanAccessTicket,
  loadFieldTicketAccessRow,
  ticketParticipantUserIdsExpanded,
} from "./field-ticket-access";
import { formatSendToDetail, personHeadline } from "./send-to-display";

export type SendToGroup =
  | "on_ticket"
  | "vendor_poc_field"
  | "vendor_poc_office"
  | "vendor_office"
  | "partner_poc_operations"
  | "partner_poc_ap"
  | "partner_office"
  | "field_crew"
  | "vndrly_office";

export type SendToRecipient = {
  userId: number;
  displayName: string;
  email: string | null;
  group: SendToGroup;
  /** @deprecated use detail — kept for older clients */
  roleLabel: string;
  headline: string;
  detail: string;
};

export type SendToRecipientGroups = {
  id: SendToGroup;
  recipients: SendToRecipient[];
}[];

export type SendToActor = {
  userId: number;
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  displayName?: string | null;
  fieldEmployee?: { id: number; vendorId: number; userId: number } | null;
};

const GROUPS_BY_ROLE: Record<string, SendToGroup[]> = {
  admin: [
    "on_ticket",
    "vendor_poc_field",
    "vendor_poc_office",
    "vendor_office",
    "partner_poc_operations",
    "partner_poc_ap",
    "partner_office",
    "vndrly_office",
  ],
  partner: [
    "on_ticket",
    "vendor_poc_field",
    "vendor_poc_office",
    "partner_poc_operations",
    "partner_poc_ap",
    "partner_office",
  ],
  vendor: [
    "on_ticket",
    "vendor_poc_field",
    "partner_poc_operations",
    "partner_poc_ap",
    "vendor_office",
  ],
  field_employee: ["on_ticket", "vendor_poc_field", "vendor_poc_office", "field_crew"],
};

const GROUP_ORDER: SendToGroup[] = [
  "on_ticket",
  "vendor_poc_field",
  "vendor_poc_office",
  "vendor_office",
  "partner_poc_operations",
  "partner_poc_ap",
  "partner_office",
  "field_crew",
  "vndrly_office",
];

const PARTNER_OPS_ROLES = new Set([
  "Operations Manager",
  "Drilling / Completions Engineer",
  "Procurement / Supply Chain",
  "Hotlist Coordinator",
  "Field Superintendent",
  "Company Man / Site Representative",
  "HSE / Safety Officer",
  "Ticket Approver",
  "Account Owner / Executive Sponsor",
  "Visitor Notifications",
]);

const FIELD_VENDOR_ROLES = ["field", "foreman", "both"] as const;

export function allowedSendToGroups(role: string): SendToGroup[] {
  return GROUPS_BY_ROLE[role] ?? [];
}

export async function actorCanSendToTicket(
  ticketId: number,
  actor: SendToActor,
): Promise<boolean> {
  const ticket = await loadFieldTicketAccessRow(ticketId);
  if (!ticket?.vendorId) return false;
  if (actor.role === "admin") return true;
  if (actor.role === "vendor") {
    if (actor.vendorId != null && actor.vendorId === ticket.vendorId) return true;
    const vendorUserIds = await findVendorUserIds(ticket.vendorId);
    return vendorUserIds.includes(actor.userId);
  }
  if (actor.role === "partner") {
    if (ticket.partnerId == null) return false;
    if (actor.partnerId != null && actor.partnerId === ticket.partnerId) return true;
    const partnerUserIds = await findPartnerUserIds(ticket.partnerId);
    return partnerUserIds.includes(actor.userId);
  }
  if (actor.role === "field_employee") {
    if (actor.fieldEmployee) {
      return fieldEmployeeCanAccessTicket(ticketId, actor.fieldEmployee, ticket);
    }
    const [fe] = await db
      .select({
        id: vendorPeopleTable.id,
        vendorId: vendorPeopleTable.vendorId,
        userId: vendorPeopleTable.userId,
      })
      .from(vendorPeopleTable)
      .where(
        and(
          eq(vendorPeopleTable.userId, actor.userId),
          isNull(vendorPeopleTable.deletedAt),
        ),
      )
      .limit(1);
    if (!fe?.userId) return false;
    return fieldEmployeeCanAccessTicket(ticketId, fe, ticket);
  }
  return false;
}

async function loadUserProfiles(
  userIds: number[],
): Promise<Map<number, { displayName: string; email: string | null }>> {
  const map = new Map<number, { displayName: string; email: string | null }>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  for (const row of rows) {
    map.set(row.id, { displayName: row.displayName, email: row.email });
  }
  return map;
}

function emptyBuckets(allowed: SendToGroup[]): Record<SendToGroup, Map<number, SendToRecipient>> {
  const out = {} as Record<SendToGroup, Map<number, SendToRecipient>>;
  for (const g of allowed) out[g] = new Map();
  return out;
}

function pushRecipient(
  buckets: Record<SendToGroup, Map<number, SendToRecipient>>,
  group: SendToGroup,
  userId: number,
  profile: { displayName: string; email: string | null },
  headline: string,
  detail: string,
  excludeUserId: number,
) {
  if (userId === excludeUserId) return;
  const bucket = buckets[group];
  if (!bucket || bucket.has(userId)) return;
  bucket.set(userId, {
    userId,
    displayName: profile.displayName,
    email: profile.email,
    group,
    roleLabel: detail,
    headline,
    detail,
  });
}

async function loadOrgNames(vendorId: number | null, partnerId: number | null) {
  let vendorName: string | null = null;
  let partnerName: string | null = null;
  if (vendorId) {
    const [row] = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId));
    vendorName = row?.name ?? null;
  }
  if (partnerId) {
    const [row] = await db
      .select({ name: partnersTable.name })
      .from(partnersTable)
      .where(eq(partnersTable.id, partnerId));
    partnerName = row?.name ?? null;
  }
  return { vendorName, partnerName };
}

async function loadUserOrgSides(
  userIds: number[],
  vendorId: number | null,
  partnerId: number | null,
): Promise<Map<number, "vendor" | "partner" | "platform" | "unknown">> {
  const sides = new Map<number, "vendor" | "partner" | "platform" | "unknown">();
  if (!userIds.length) return sides;

  const rows = await db
    .select({
      userId: userOrgMembershipsTable.userId,
      orgType: userOrgMembershipsTable.orgType,
      vendorId: userOrgMembershipsTable.vendorId,
      partnerId: userOrgMembershipsTable.partnerId,
    })
    .from(userOrgMembershipsTable)
    .where(inArray(userOrgMembershipsTable.userId, userIds));

  for (const id of userIds) sides.set(id, "unknown");

  for (const row of rows) {
    if (row.orgType === "vendor" && vendorId != null && row.vendorId === vendorId) {
      sides.set(row.userId, "vendor");
    } else if (row.orgType === "partner" && partnerId != null && row.partnerId === partnerId) {
      sides.set(row.userId, "partner");
    }
  }

  const adminRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(inArray(usersTable.id, userIds), eq(usersTable.role, "admin")));
  for (const row of adminRows) {
    if (sides.get(row.id) === "unknown") sides.set(row.id, "platform");
  }

  return sides;
}

async function loadVendorPeopleHeadlines(
  vendorId: number,
  userIds: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!userIds.length) return map;
  const rows = await db
    .select({
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      jobTitle: vendorPeopleTable.jobTitle,
    })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendorId),
        inArray(vendorPeopleTable.userId, userIds),
        isNull(vendorPeopleTable.deletedAt),
      ),
    );
  for (const row of rows) {
    if (!row.userId) continue;
    const name =
      row.jobTitle?.trim() ||
      [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    if (name) map.set(row.userId, name);
  }
  return map;
}

function contactIsAp(roles: string[] | null | undefined): boolean {
  return (roles ?? []).includes(ACCOUNTS_PAYABLE_ROLE);
}

function contactIsOps(roles: string[] | null | undefined): boolean {
  const r = roles ?? [];
  if (contactIsAp(r)) return false;
  return r.some((role) => PARTNER_OPS_ROLES.has(role)) || r.length === 0;
}

function vendorRoleLabel(vendorRole: string | null, jobTitle: string | null): string {
  if (jobTitle?.trim()) return jobTitle.trim();
  if (vendorRole === "foreman" || vendorRole === "both") return "Foreman";
  if (vendorRole === "field") return "Field employee";
  return "Field crew";
}

async function loadTicketCrewFieldUsers(ticketId: number, vendorId: number) {
  return db
    .select({
      userId: vendorPeopleTable.userId,
      vendorRole: vendorPeopleTable.vendorRole,
      jobTitle: vendorPeopleTable.jobTitle,
    })
    .from(ticketCrewTable)
    .innerJoin(vendorPeopleTable, eq(ticketCrewTable.employeeId, vendorPeopleTable.id))
    .where(
      and(
        eq(ticketCrewTable.ticketId, ticketId),
        isNull(ticketCrewTable.removedAt),
        eq(vendorPeopleTable.vendorId, vendorId),
        isNull(vendorPeopleTable.deletedAt),
        inArray(vendorPeopleTable.vendorRole, [...FIELD_VENDOR_ROLES]),
      ),
    );
}

async function loadVendorFieldCrewUsers(vendorId: number) {
  return db
    .select({
      userId: vendorPeopleTable.userId,
      vendorRole: vendorPeopleTable.vendorRole,
      jobTitle: vendorPeopleTable.jobTitle,
    })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendorId),
        eq(vendorPeopleTable.isActive, true),
        isNull(vendorPeopleTable.deletedAt),
        inArray(vendorPeopleTable.vendorRole, [...FIELD_VENDOR_ROLES]),
        isNotNull(vendorPeopleTable.userId),
      ),
    );
}

export async function listSendToRecipients(
  ticketId: number,
  actor: SendToActor,
): Promise<SendToRecipientGroups> {
  const ticket = await loadFieldTicketAccessRow(ticketId);
  if (!ticket?.vendorId) return [];

  const allowed = allowedSendToGroups(actor.role);
  const buckets = emptyBuckets(allowed);
  const vendorId = ticket.vendorId;
  const partnerId = ticket.partnerId;
  const allUserIds = new Set<number>();

  const collectIds = (ids: Iterable<number | null | undefined>) => {
    for (const id of ids) {
      if (typeof id === "number" && id > 0) allUserIds.add(id);
    }
  };

  if (allowed.includes("on_ticket")) {
    collectIds((await ticketParticipantUserIdsExpanded(ticketId)).ids);
  }
  if (allowed.includes("vendor_office") && vendorId) {
    collectIds(await findVendorUserIds(vendorId));
  }
  if (allowed.includes("partner_office") && partnerId) {
    collectIds(await findPartnerUserIds(partnerId));
  }
  if (allowed.includes("vendor_poc_field") && vendorId) {
    collectIds([ticket.foremanUserId, ticket.actingForemanUserId]);
    collectIds((await loadTicketCrewFieldUsers(ticketId, vendorId)).map((r) => r.userId));
    if (ticket.fieldEmployeeId) {
      const [fe] = await db
        .select({ userId: vendorPeopleTable.userId })
        .from(vendorPeopleTable)
        .where(eq(vendorPeopleTable.id, ticket.fieldEmployeeId));
      collectIds([fe?.userId]);
    }
  }
  if (allowed.includes("vendor_poc_office") && vendorId) {
    const admins = await db
      .select({ userId: userOrgMembershipsTable.userId })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.orgType, "vendor"),
          eq(userOrgMembershipsTable.vendorId, vendorId),
          eq(userOrgMembershipsTable.role, "admin"),
        ),
      );
    collectIds(admins.map((r) => r.userId));
  }
  if (allowed.includes("field_crew") && vendorId) {
    collectIds((await loadVendorFieldCrewUsers(vendorId)).map((r) => r.userId));
  }
  if ((allowed.includes("partner_poc_operations") || allowed.includes("partner_poc_ap")) && partnerId) {
    const contacts = await db
      .select({ userId: partnerContactsTable.userId })
      .from(partnerContactsTable)
      .where(
        and(eq(partnerContactsTable.partnerId, partnerId), isNull(partnerContactsTable.deletedAt)),
      );
    collectIds(contacts.map((c) => c.userId));
    const partnerStaff = await db
      .select({ userId: userOrgMembershipsTable.userId })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.orgType, "partner"),
          eq(userOrgMembershipsTable.partnerId, partnerId),
        ),
      );
    collectIds(partnerStaff.map((r) => r.userId));
  }
  if (allowed.includes("vndrly_office")) {
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));
    collectIds(admins.map((r) => r.id));
  }

  const profiles = await loadUserProfiles([...allUserIds]);
  const { vendorName, partnerName } = await loadOrgNames(vendorId, partnerId);
  const participantIds = allowed.includes("on_ticket")
    ? (await ticketParticipantUserIdsExpanded(ticketId)).ids
    : [];
  const orgSides = await loadUserOrgSides(participantIds, vendorId, partnerId);
  const vendorPeopleHeadlines =
    vendorId != null
      ? await loadVendorPeopleHeadlines(vendorId, [...allUserIds])
      : new Map<number, string>();

  if (allowed.includes("on_ticket")) {
    for (const userId of participantIds) {
      const profile = profiles.get(userId);
      if (!profile) continue;
      const headline = personHeadline(
        profile,
        vendorPeopleHeadlines.get(userId) ?? null,
      );
      const detail = formatSendToDetail({
        group: "on_ticket",
        vendorName,
        partnerName,
        orgSide: orgSides.get(userId) ?? "unknown",
      });
      pushRecipient(buckets, "on_ticket", userId, profile, headline, detail, actor.userId);
    }
  }

  if (allowed.includes("vendor_poc_field") && vendorId) {
    if (ticket.foremanUserId) {
      const profile = profiles.get(ticket.foremanUserId);
      if (profile) {
        const foremanHeadline = personHeadline(
          profile,
          vendorPeopleHeadlines.get(ticket.foremanUserId) ?? "Foreman",
        );
        pushRecipient(
          buckets,
          "vendor_poc_field",
          ticket.foremanUserId,
          profile,
          foremanHeadline,
          formatSendToDetail({
            group: "vendor_poc_field",
            vendorName,
            pocRole: foremanHeadline,
          }),
          actor.userId,
        );
      }
    }
    if (ticket.actingForemanUserId && ticket.actingForemanUserId !== ticket.foremanUserId) {
      const profile = profiles.get(ticket.actingForemanUserId);
      if (profile) {
        const actingHeadline = personHeadline(
          profile,
          vendorPeopleHeadlines.get(ticket.actingForemanUserId) ?? "Acting foreman",
        );
        pushRecipient(
          buckets,
          "vendor_poc_field",
          ticket.actingForemanUserId,
          profile,
          actingHeadline,
          formatSendToDetail({
            group: "vendor_poc_field",
            vendorName,
            pocRole: actingHeadline,
          }),
          actor.userId,
        );
      }
    }
    if (ticket.fieldEmployeeId) {
      const [fe] = await db
        .select({
          userId: vendorPeopleTable.userId,
          vendorRole: vendorPeopleTable.vendorRole,
          jobTitle: vendorPeopleTable.jobTitle,
        })
        .from(vendorPeopleTable)
        .where(eq(vendorPeopleTable.id, ticket.fieldEmployeeId));
      if (fe?.userId) {
        const profile = profiles.get(fe.userId);
        if (profile) {
          const fieldHeadline = personHeadline(
            profile,
            vendorRoleLabel(fe.vendorRole, fe.jobTitle),
          );
          pushRecipient(
            buckets,
            "vendor_poc_field",
            fe.userId,
            profile,
            fieldHeadline,
            formatSendToDetail({
              group: "vendor_poc_field",
              vendorName,
              pocRole: fieldHeadline,
            }),
            actor.userId,
          );
        }
      }
    }
    for (const row of await loadTicketCrewFieldUsers(ticketId, vendorId)) {
      if (!row.userId) continue;
      const profile = profiles.get(row.userId);
      if (!profile) continue;
      const crewHeadline = personHeadline(
        profile,
        vendorRoleLabel(row.vendorRole, row.jobTitle),
      );
      pushRecipient(
        buckets,
        "vendor_poc_field",
        row.userId,
        profile,
        crewHeadline,
        formatSendToDetail({
          group: "vendor_poc_field",
          vendorName,
          pocRole: crewHeadline,
        }),
        actor.userId,
      );
    }
  }

  if (allowed.includes("vendor_poc_office") && vendorId) {
    const admins = await db
      .select({ userId: userOrgMembershipsTable.userId })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.orgType, "vendor"),
          eq(userOrgMembershipsTable.vendorId, vendorId),
          eq(userOrgMembershipsTable.role, "admin"),
        ),
      );
    for (const row of admins) {
      const profile = profiles.get(row.userId);
      if (!profile) continue;
      const adminHeadline = personHeadline(profile, "Vendor admin");
      pushRecipient(
        buckets,
        "vendor_poc_office",
        row.userId,
        profile,
        adminHeadline,
        formatSendToDetail({
          group: "vendor_poc_office",
          vendorName,
          pocRole: adminHeadline,
        }),
        actor.userId,
      );
    }
  }

  if (allowed.includes("vendor_office") && vendorId) {
    const memberships = await db
      .select({
        userId: userOrgMembershipsTable.userId,
        role: userOrgMembershipsTable.role,
      })
      .from(userOrgMembershipsTable)
      .where(
        and(
          eq(userOrgMembershipsTable.orgType, "vendor"),
          eq(userOrgMembershipsTable.vendorId, vendorId),
        ),
      );
    for (const row of memberships) {
      const profile = profiles.get(row.userId);
      if (!profile) continue;
      const membershipLabel =
        row.role === "admin" ? "Vendor admin" : "Vendor office";
      const headline = personHeadline(profile, membershipLabel);
      pushRecipient(
        buckets,
        "vendor_office",
        row.userId,
        profile,
        headline,
        formatSendToDetail({ group: "vendor_office", vendorName }),
        actor.userId,
      );
    }
  }

  if (partnerId) {
    if (allowed.includes("partner_poc_operations") || allowed.includes("partner_poc_ap")) {
      const contacts = await db
        .select({
          userId: partnerContactsTable.userId,
          jobTitle: partnerContactsTable.jobTitle,
          name: partnerContactsTable.name,
          roles: partnerContactsTable.roles,
        })
        .from(partnerContactsTable)
        .where(
          and(eq(partnerContactsTable.partnerId, partnerId), isNull(partnerContactsTable.deletedAt)),
        );
      for (const contact of contacts) {
        if (!contact.userId) continue;
        const profile = profiles.get(contact.userId);
        if (!profile) continue;
        const headline = personHeadline(profile, contact.jobTitle || contact.name);
        if (allowed.includes("partner_poc_ap") && contactIsAp(contact.roles)) {
          pushRecipient(
            buckets,
            "partner_poc_ap",
            contact.userId,
            profile,
            headline,
            formatSendToDetail({
              group: "partner_poc_ap",
              partnerName,
              pocRole: headline,
            }),
            actor.userId,
          );
        }
        if (allowed.includes("partner_poc_operations") && contactIsOps(contact.roles)) {
          pushRecipient(
            buckets,
            "partner_poc_operations",
            contact.userId,
            profile,
            headline,
            formatSendToDetail({
              group: "partner_poc_operations",
              partnerName,
              pocRole: headline,
            }),
            actor.userId,
          );
        }
      }
      const partnerStaff = await db
        .select({ userId: userOrgMembershipsTable.userId, role: userOrgMembershipsTable.role })
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.orgType, "partner"),
            eq(userOrgMembershipsTable.partnerId, partnerId),
          ),
        );
      for (const row of partnerStaff) {
        const profile = profiles.get(row.userId);
        if (!profile) continue;
        if (allowed.includes("partner_poc_ap") && row.role === "ap") {
          const headline = personHeadline(profile, "Partner AP");
          pushRecipient(
            buckets,
            "partner_poc_ap",
            row.userId,
            profile,
            headline,
            formatSendToDetail({
              group: "partner_poc_ap",
              partnerName,
              pocRole: headline,
            }),
            actor.userId,
          );
        }
        if (
          allowed.includes("partner_poc_operations") &&
          (row.role === "admin" || row.role === "member")
        ) {
          const headline = personHeadline(
            profile,
            row.role === "admin" ? "Partner admin" : "Partner operations",
          );
          pushRecipient(
            buckets,
            "partner_poc_operations",
            row.userId,
            profile,
            headline,
            formatSendToDetail({
              group: "partner_poc_operations",
              partnerName,
              pocRole: headline,
            }),
            actor.userId,
          );
        }
      }
    }

    if (allowed.includes("partner_office")) {
      const memberships = await db
        .select({
          userId: userOrgMembershipsTable.userId,
          role: userOrgMembershipsTable.role,
        })
        .from(userOrgMembershipsTable)
        .where(
          and(
            eq(userOrgMembershipsTable.orgType, "partner"),
            eq(userOrgMembershipsTable.partnerId, partnerId),
          ),
        );
      for (const row of memberships) {
        const profile = profiles.get(row.userId);
        if (!profile) continue;
        const membershipLabel =
          row.role === "ap"
            ? "Partner AP"
            : row.role === "admin"
              ? "Partner admin"
              : "Partner office";
        const headline = personHeadline(profile, membershipLabel);
        pushRecipient(
          buckets,
          "partner_office",
          row.userId,
          profile,
          headline,
          formatSendToDetail({ group: "partner_office", partnerName }),
          actor.userId,
        );
      }
    }
  }

  if (allowed.includes("field_crew") && vendorId) {
    for (const row of await loadVendorFieldCrewUsers(vendorId)) {
      if (!row.userId) continue;
      const profile = profiles.get(row.userId);
      if (!profile) continue;
      const crewHeadline = personHeadline(
        profile,
        vendorRoleLabel(row.vendorRole, row.jobTitle),
      );
      pushRecipient(
        buckets,
        "field_crew",
        row.userId,
        profile,
        crewHeadline,
        formatSendToDetail({
          group: "field_crew",
          vendorName,
          pocRole: crewHeadline,
        }),
        actor.userId,
      );
    }
  }

  if (allowed.includes("vndrly_office")) {
    const admins = await db
      .select({ id: usersTable.id, displayName: usersTable.displayName, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));
    for (const row of admins) {
      const profile = { displayName: row.displayName, email: row.email };
      const headline = personHeadline(profile, "VNDRLY staff");
      pushRecipient(
        buckets,
        "vndrly_office",
        row.id,
        profile,
        headline,
        formatSendToDetail({ group: "vndrly_office" }),
        actor.userId,
      );
    }
  }

  return GROUP_ORDER.filter((g) => allowed.includes(g))
    .map((id) => ({
      id,
      recipients: [...(buckets[id]?.values() ?? [])],
    }))
    .filter((g) => g.recipients.length > 0);
}

export async function validateSendToRecipients(
  ticketId: number,
  actor: SendToActor,
  recipientUserIds: number[],
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!recipientUserIds.length) {
    return { ok: false, code: "send_to.no_recipients", message: "Select at least one recipient" };
  }
  if (recipientUserIds.length > 25) {
    return { ok: false, code: "send_to.too_many", message: "Too many recipients (max 25)" };
  }

  const groups = await listSendToRecipients(ticketId, actor);
  const allowedIds = new Set<number>();
  for (const g of groups) {
    for (const r of g.recipients) allowedIds.add(r.userId);
  }

  for (const id of recipientUserIds) {
    if (!allowedIds.has(id)) {
      return {
        ok: false,
        code: "send_to.forbidden_recipient",
        message: "One or more recipients are not allowed for this ticket",
      };
    }
  }

  return { ok: true };
}

export type SendTicketForwardInput = {
  ticketId: number;
  actor: SendToActor;
  recipientUserIds: number[];
  message?: string | null;
  sourceTitle?: string | null;
  sourceBody?: string | null;
};

export type SendTicketForwardResult =
  | { ok: true; notifiedCount: number; trackingNumber: string }
  | { ok: false; code: string; message: string; retryAfterSeconds?: number };

export async function sendTicketForward(
  input: SendTicketForwardInput,
): Promise<SendTicketForwardResult> {
  const canAccess = await actorCanSendToTicket(input.ticketId, input.actor);
  if (!canAccess) {
    return { ok: false, code: "send_to.forbidden", message: "Not allowed to send from this ticket" };
  }

  const validation = await validateSendToRecipients(
    input.ticketId,
    input.actor,
    input.recipientUserIds,
  );
  if (!validation.ok) {
    return { ok: false, code: validation.code, message: validation.message };
  }

  const trackingNumber = formatTicketTrackingNumber(input.ticketId);
  const actorName = input.actor.displayName?.trim() || "Someone";
  const note =
    typeof input.message === "string" && input.message.trim()
      ? input.message.trim().slice(0, 500)
      : null;

  const bodyLines = [
    note ? `${actorName}: ${note}` : null,
    input.sourceBody ?? null,
    `Tracking ${trackingNumber}. Each vendor maintains a separate ticket for cooperating jobs.`,
  ].filter(Boolean);

  const title = `${actorName} sent you a ticket update — ${trackingNumber}`;
  const body = bodyLines.join("\n\n").slice(0, 2000);
  const link = `/tickets/${input.ticketId}`;
  const dedupeBase = Date.now();

  const notifiedCount = await notifyUsers(input.recipientUserIds, {
    type: "ticket_forwarded",
    title,
    body,
    link,
    dedupeKey: `ticket_forward:${input.ticketId}:${input.actor.userId}:${dedupeBase}`,
    pushData: { ticketId: input.ticketId, type: "ticket_forwarded" },
  });

  const recipientProfiles = await loadUserProfiles(input.recipientUserIds);
  const recipientNames = input.recipientUserIds
    .map((id) => recipientProfiles.get(id)?.displayName ?? `User #${id}`)
    .join(", ");

  await db.insert(ticketNoteLogsTable).values({
    ticketId: input.ticketId,
    content: `[Sent to] ${actorName} forwarded an update to ${recipientNames}${note ? `: ${note}` : ""}`,
    attachments: [],
    createdById: input.actor.userId,
  });

  return { ok: true, notifiedCount, trackingNumber };
}
