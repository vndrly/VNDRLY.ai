import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  workHubFileLibraryTable as records,
  vendorPeopleTable as staff,
  workHubCrewsTable as groups,
  workHubCrewMembersTable as members,
  vendorsTable as vendors,
} from "@workspace/db";
import {
  folderPermission,
  FolderGrantSchema,
  type WorkHubOwner,
} from "@workspace/api-zod";
import {
  libraryAuthority,
  type LibraryActor,
  type LibraryTx,
  LibraryError,
} from "./library-core";
import { companyLibraryPeople, libraryGroupMembers } from "./library-audience";
async function getVendorStaffRoleCatalog(
  reader: Pick<typeof db, "select">,
  id: number,
) {
  const [vendor] = await reader
    .select({ catalog: vendors.staffRoleCatalog })
    .from(vendors)
    .where(eq(vendors.id, id))
    .limit(1);
  return vendor?.catalog?.entries ?? [];
}
import {
  automaticLibraryAudiences,
  automaticAudienceMembers,
} from "./automatic-library-audiences";
import { trainingPositionIds } from "../lib/safety-training-position";
type Reader = Pick<typeof db, "select">;
export const repositoryScope = (owner: WorkHubOwner) =>
  and(eq(records.orgType, owner.type), eq(records.orgId, owner.id));
export async function repositoryContext(reader: Reader, actor: LibraryActor) {
  const { owner, member } = await libraryAuthority(reader, actor);
  const [person] =
    owner.type === "vendor"
      ? await reader
          .select()
          .from(staff)
          .where(
            and(
              eq(staff.vendorId, owner.id),
              eq(staff.isActive, true),
              isNull(staff.deletedAt),
              member.vendorPeopleId
                ? eq(staff.id, member.vendorPeopleId)
                : eq(staff.userId, actor.userId),
            ),
          )
          .limit(1)
      : [];
  const positions =
    owner.type === "vendor"
      ? await getVendorStaffRoleCatalog(reader, owner.id)
      : [];
  const roleIds = person
    ? trainingPositionIds({ ...person, membershipRole: member.role }, positions)
    : [];
  const groupRows = await reader
    .select({ id: groups.id })
    .from(groups)
    .innerJoin(members, eq(members.crewId, groups.id))
    .where(
      and(
        eq(groups.ownerOrgType, owner.type),
        eq(groups.ownerOrgId, owner.id),
        eq(groups.status, "active"),
        eq(members.userId, actor.userId),
      ),
    );
  const office =
    !!person &&
    [person.vendorRole, ...person.roles].some((r) =>
      ["office", "office_staff", "both"].includes(r),
    );
  const grants = await reader
    .select()
    .from(records)
    .where(
      and(repositoryScope(owner), eq(records.kind, "repository_travel_grant")),
    );
  return {
    owner,
    member,
    person,
    admin: member.role === "admin",
    office,
    canAssignTravel:
      member.role === "admin" ||
      (office &&
        grants.some((g) =>
          ((g.data.userIds as number[]) ?? []).includes(actor.userId),
        )),
    identity: {
      userId: actor.userId,
      roles: [member.role, ...roleIds],
      groups: [
        ...groupRows.map((g) => g.id),
        ...automaticLibraryAudiences
          .filter((a) =>
            automaticAudienceMembers(
              a.id,
              [
                {
                  userId: actor.userId,
                  role: member.role,
                  vendorPeopleId: member.vendorPeopleId,
                },
              ],
              person ? [person] : [],
            ).includes(actor.userId),
          )
          .map((a) => a.id),
      ],
    },
  };
}
export async function repositoryFolder(
  reader: Reader,
  actor: LibraryActor,
  id: string,
  permission: "read" | "write" | "edit",
) {
  const ctx = await repositoryContext(reader, actor);
  const [folder] = await reader
    .select()
    .from(records)
    .where(
      and(
        repositoryScope(ctx.owner),
        eq(records.kind, "repository_folder"),
        eq(records.id, id),
      ),
    )
    .limit(1);
  if (!folder) throw new LibraryError("Folder not found", 404);
  const grants = FolderGrantSchema.array().parse(folder.data.grants ?? []);
  if (
    !ctx.admin &&
    !(folder.recordKey === "travel" && ctx.canAssignTravel) &&
    !folderPermission(grants, ctx.identity, permission)
  )
    throw new LibraryError("Folder permission required", 403);
  return { folder, ctx };
}
export async function requireRepositoryDocumentAccess(
  reader: Reader,
  actor: LibraryActor,
  doc: { data: Record<string, unknown>; orgType: string; orgId: number },
  permission: "read" | "write" | "edit",
) {
  // Classification must not replace the original personal/channel audience.
  if (doc.data.scope !== "company") return;
  if (typeof doc.data.folderId !== "string" && !doc.data.tripId) return;
  const ctx = await repositoryContext(reader, actor);
  if (doc.orgType !== ctx.owner.type || doc.orgId !== ctx.owner.id)
    throw new LibraryError("File not found", 404);
  if (typeof doc.data.tripId === "string") {
    const [trip] = await reader
      .select()
      .from(records)
      .where(
        and(
          repositoryScope(ctx.owner),
          eq(records.id, doc.data.tripId),
          eq(records.kind, "travel_trip"),
        ),
      )
      .limit(1);
    if (
      !trip ||
      (!ctx.canAssignTravel && trip.data.travelerId !== actor.userId)
    )
      throw new LibraryError("Trip not found", 404);
    if (
      permission !== "read" &&
      !["authorized", "returned"].includes(String(trip.data.status))
    )
      throw new LibraryError("Reopen the trip before editing", 409);
    return;
  }
  await repositoryFolder(reader, actor, String(doc.data.folderId), permission);
}
export async function repositoryAudience(
  reader: Reader,
  actor: LibraryActor,
  input: { userIds: number[]; groupIds: string[]; roles: string[] },
) {
  const { owner } = await repositoryContext(reader, actor);
  const people = await companyLibraryPeople(reader, owner);
  const ids = new Set(input.userIds);
  (await libraryGroupMembers(reader, owner, input.groupIds, people)).forEach(
    (id) => ids.add(id),
  );
  if (input.roles.length && owner.type === "vendor") {
    const roster = await reader
      .select()
      .from(staff)
      .where(
        and(
          eq(staff.vendorId, owner.id),
          eq(staff.isActive, true),
          isNull(staff.deletedAt),
        ),
      );
    const catalog = await getVendorStaffRoleCatalog(reader, owner.id);
    for (const p of people) {
      const employee = roster.find(
        (v) => v.id === p.vendorPeopleId || v.userId === p.userId,
      );
      if (
        employee &&
        trainingPositionIds(
          { ...employee, membershipRole: p.role },
          catalog,
        ).some((r) => input.roles.includes(r))
      )
        ids.add(p.userId);
    }
  }
  if ([...ids].some((id) => !people.some((p) => p.userId === id)))
    throw new LibraryError("Choose current company individuals", 400);
  return people.filter((p) => ids.has(p.userId));
}
export async function repositoryOptions(reader: Reader, actor: LibraryActor) {
  const ctx = await repositoryContext(reader, actor);
  const people = await companyLibraryPeople(reader, ctx.owner);
  const groupRows = await reader
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(
      and(
        eq(groups.ownerOrgType, ctx.owner.type),
        eq(groups.ownerOrgId, ctx.owner.id),
        eq(groups.status, "active"),
      ),
    );
  const catalog =
    ctx.owner.type === "vendor"
      ? await getVendorStaffRoleCatalog(reader, ctx.owner.id)
      : [];
  const roster =
    ctx.owner.type === "vendor"
      ? await reader
          .select()
          .from(staff)
          .where(
            and(
              eq(staff.vendorId, ctx.owner.id),
              eq(staff.isActive, true),
              isNull(staff.deletedAt),
            ),
          )
      : [];
  return {
    people: people.map((p) => ({
      ...p,
      canAssignTravelRole:
        p.role === "admin" ||
        roster.some(
          (v) =>
            (v.id === p.vendorPeopleId || v.userId === p.userId) &&
            [v.vendorRole, ...v.roles].some((r) =>
              ["office", "office_staff", "both"].includes(r),
            ),
        ),
    })),
    groups: [
      ...automaticLibraryAudiences.filter((a) => a.id === "audience:all-hands"),
      ...automaticLibraryAudiences.filter((a) => a.id !== "audience:all-hands"),
      ...groupRows,
    ],
    positions: catalog.map((p) => ({ id: `staff:${p.id}`, name: p.label })),
    accountTypes: [
      { id: "account:admin", name: "Admin" },
      { id: "account:office_staff", name: "Office Staff" },
      { id: "account:gate_supervisor", name: "Gate Supervisor" },
      { id: "account:gatekeeper", name: "Gatekeeper" },
    ],
  };
}
export async function repositoryRecord(
  tx: Reader,
  owner: WorkHubOwner,
  id: string,
  kind: string,
) {
  const [row] = await tx
    .select()
    .from(records)
    .where(
      and(repositoryScope(owner), eq(records.id, id), eq(records.kind, kind)),
    )
    .limit(1);
  if (!row) throw new LibraryError("Item not found", 404);
  return row;
}
export async function updateRepositoryRecord(
  tx: LibraryTx,
  row: typeof records.$inferSelect,
  version: number | null,
  data: Record<string, unknown>,
) {
  if (Number(row.data.version ?? 1) !== version)
    throw new LibraryError("This item changed; reopen before saving", 409);
  await tx
    .update(records)
    .set({
      data: { ...data, version: Number(row.data.version ?? 1) + 1 },
      updatedAt: new Date(),
    })
    .where(eq(records.id, row.id));
  return { id: row.id, version: Number(row.data.version ?? 1) + 1 };
}

// Assignment checks evaluate a recipient's current ACL, never an invented login session.
export async function repositoryRecipientCanRead(
  reader: Reader,
  owner: WorkHubOwner,
  doc: { orgType: string; orgId: number; data: Record<string, any> },
  userId: number,
) {
  if (
    doc.orgType !== owner.type ||
    doc.orgId !== owner.id ||
    doc.data.scope !== "company" ||
    doc.data.state !== "active"
  )
    return false;
  const person = (await companyLibraryPeople(reader, owner)).find(
    (p) => p.userId === userId,
  );
  if (!person) return false;
  if (person.role === "admin") return true;
  if (doc.data.tripId) {
    const trip = await repositoryRecord(
      reader,
      owner,
      doc.data.tripId,
      "travel_trip",
    );
    return trip.data.travelerId === userId;
  }
  if (!doc.data.folderId) return true;
  const roster =
    owner.type === "vendor"
      ? await reader
          .select()
          .from(staff)
          .where(
            and(
              eq(staff.vendorId, owner.id),
              eq(staff.isActive, true),
              isNull(staff.deletedAt),
            ),
          )
      : [];
  const employee = roster.find(
    (p) => p.id === person.vendorPeopleId || p.userId === userId,
  );
  const catalog =
    owner.type === "vendor"
      ? await getVendorStaffRoleCatalog(reader, owner.id)
      : [];
  const ownGroups = await reader
    .select({ id: groups.id })
    .from(groups)
    .innerJoin(members, eq(members.crewId, groups.id))
    .where(
      and(
        eq(groups.ownerOrgType, owner.type),
        eq(groups.ownerOrgId, owner.id),
        eq(groups.status, "active"),
        eq(members.userId, userId),
      ),
    );
  const identity = {
    userId,
    roles: employee
      ? trainingPositionIds(
          { ...employee, membershipRole: person.role },
          catalog,
        )
      : [],
    groups: [
      ...ownGroups.map((g) => g.id),
      ...automaticLibraryAudiences
        .filter((a) =>
          automaticAudienceMembers(
            a.id,
            [person],
            employee ? [employee] : [],
          ).includes(userId),
        )
        .map((a) => a.id),
    ],
  };
  const folder = await repositoryRecord(
    reader,
    owner,
    doc.data.folderId,
    "repository_folder",
  );
  return folderPermission(
    FolderGrantSchema.array().parse(folder.data.grants ?? []),
    identity,
    "read",
  );
}
