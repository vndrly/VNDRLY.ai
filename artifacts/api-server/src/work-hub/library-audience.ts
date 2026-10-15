import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  usersTable as users,
  userOrgMembershipsTable as memberships,
  workHubChannelsTable as channels,
  workHubChannelMembersTable as channelMembers,
  vendorCrewPresetsTable as crews,
  workHubFilesTable as files,
} from "@workspace/db";
import { LibraryAudienceSchema, type WorkHubOwner } from "@workspace/api-zod";
import {
  libraryAuthority,
  LibraryError,
  type LibraryActor,
  type LibraryTx,
} from "./library-core";
import { resolveChannelAccess } from "./queries";
export async function companyLibraryPeople(
  reader: Pick<typeof db, "select">,
  owner: WorkHubOwner,
  lock = false,
) {
  const query = reader
    .select({
      userId: users.id,
      name: users.displayName,
      email: users.email,
      membershipId: memberships.id,
      role: memberships.role,
      joinedAt: memberships.createdAt,
      vendorPeopleId: memberships.vendorPeopleId,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgType, owner.type),
        owner.type === "vendor"
          ? eq(memberships.vendorId, owner.id)
          : eq(memberships.partnerId, owner.id),
        isNull(users.suspendedAt),
      ),
    )
    .limit(5001);
  const result = await (lock ? query.for("share") : query);
  if (result.length > 5000)
    throw new LibraryError(
      "Audience exceeds 5000; select a smaller batch",
      400,
    );
  return result;
}
export async function libraryOptions(actor: LibraryActor) {
  const { owner } = await libraryAuthority(db, actor, true);
  const groupRows = await db
    .select({ id: channels.id, name: channels.name })
    .from(channels)
    .where(
      and(
        eq(channels.ownerOrgType, owner.type),
        eq(channels.ownerOrgId, owner.id),
        eq(channels.status, "active"),
      ),
    )
    .limit(100);
  const groups = [];
  for (const group of groupRows) {
    try {
      await resolveChannelAccess(actor, group.id, "channel.read");
      groups.push(group);
    } catch {}
  }
  if (owner.type === "vendor") {
    const preset = await db
      .select({ id: crews.id, name: crews.name })
      .from(crews)
      .where(eq(crews.vendorId, owner.id))
      .limit(100);
    groups.push(...preset.map((c) => ({ id: `crew:${c.id}`, name: c.name })));
  }
  return {
    people: await companyLibraryPeople(db, owner),
    groups,
    files: await db
      .select({ id: files.id, fileName: files.fileName })
      .from(files)
      .where(
        and(
          eq(files.ownerOrgType, owner.type),
          eq(files.ownerOrgId, owner.id),
          eq(files.state, "finalized"),
          isNull(files.channelId),
        ),
      )
      .limit(100),
  };
}
export async function expandLibraryAudience(
  tx: LibraryTx,
  actor: LibraryActor,
  input: unknown,
) {
  const audience = LibraryAudienceSchema.parse(input),
    { owner } = await libraryAuthority(tx, actor, true, true),
    people = await companyLibraryPeople(tx, owner, true);
  const ids = new Set(audience.userIds);
  for (const id of audience.groupIds) {
    if (id.startsWith("crew:")) {
      if (owner.type !== "vendor")
        throw new LibraryError("Crew is outside this company", 403);
      const [crew] = await tx
        .select()
        .from(crews)
        .where(
          and(eq(crews.id, Number(id.slice(5))), eq(crews.vendorId, owner.id)),
        )
        .limit(1)
        .for("share");
      if (!crew) throw new LibraryError("Company crew not found", 404);
      const memberIds = Array.isArray(crew.memberEmployeeIds)
        ? crew.memberEmployeeIds
        : [];
      people
        .filter(
          (p) =>
            p.vendorPeopleId !== null && memberIds.includes(p.vendorPeopleId),
        )
        .forEach((p) => ids.add(p.userId));
    } else {
      const [channel] = await tx
        .select()
        .from(channels)
        .where(
          and(
            eq(channels.id, id),
            eq(channels.ownerOrgType, owner.type),
            eq(channels.ownerOrgId, owner.id),
            eq(channels.status, "active"),
          ),
        )
        .limit(1)
        .for("share");
      if (!channel) throw new LibraryError("Company group not found", 404);
      await resolveChannelAccess(actor, id, "channel.read");
      const members = await tx
        .select({ userId: channelMembers.userId })
        .from(channelMembers)
        .where(eq(channelMembers.channelId, id))
        .for("share");
      members.forEach((m) => ids.add(m.userId));
    }
  }
  const eligible =
    audience.mode === "all_active"
      ? people
      : people.filter((p) => ids.has(p.userId));
  if (!eligible.length)
    throw new LibraryError("Choose eligible company recipients", 400);
  return {
    owner,
    people: eligible,
    excluded: [...ids].filter((id) => !people.some((p) => p.userId === id)),
  };
}
