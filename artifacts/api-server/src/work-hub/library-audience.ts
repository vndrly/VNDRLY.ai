import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  usersTable as users,
  userOrgMembershipsTable as memberships,
  workHubCrewsTable as groupsTable,
  workHubCrewMembersTable as groupMembers,
  workHubFilesTable as files,
  vendorPeopleTable as staffTable,
} from "@workspace/db";
import { LibraryAudienceSchema, type WorkHubOwner } from "@workspace/api-zod";
import {
  libraryAuthority,
  LibraryError,
  type LibraryActor,
  type LibraryTx,
} from "./library-core";
import {automaticLibraryAudiences,automaticAudienceMembers} from './automatic-library-audiences';
export async function libraryGroupMembers(reader:Pick<typeof db,'select'>,owner:WorkHubOwner,groupIds:string[],people:Awaited<ReturnType<typeof companyLibraryPeople>>){
 const ids=new Set<number>();
 const staff=owner.type==='vendor'&&groupIds.some(id=>id.startsWith('audience:'))?await reader.select().from(staffTable).where(and(eq(staffTable.vendorId,owner.id),eq(staffTable.isActive,true),isNull(staffTable.deletedAt))):[];
 for(const id of groupIds){
  if(id.startsWith('audience:')){automaticAudienceMembers(id,people,staff).forEach(userId=>ids.add(userId));continue;}
  if(id.startsWith('crew:'))throw new LibraryError('Choose a defined company group',400);
  const [group]=await reader.select().from(groupsTable).where(and(eq(groupsTable.id,id),eq(groupsTable.ownerOrgType,owner.type),eq(groupsTable.ownerOrgId,owner.id),eq(groupsTable.status,'active'))).limit(1);
  if(!group)throw new LibraryError('Company group not found',404);
  const members=await reader.select({userId:groupMembers.userId}).from(groupMembers).where(eq(groupMembers.crewId,id));
  members.forEach(member=>ids.add(member.userId));
 }
 return ids;
}
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
    .select({ id: groupsTable.id, name: groupsTable.name })
    .from(groupsTable)
    .where(
      and(
        eq(groupsTable.ownerOrgType, owner.type),
        eq(groupsTable.ownerOrgId, owner.id),
        eq(groupsTable.status, "active"),
      ),
    )
    .limit(100);
  return {
    people: await companyLibraryPeople(db, owner),
    groups: [...automaticLibraryAudiences,...groupRows],
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
  (await libraryGroupMembers(tx,owner,audience.groupIds,people)).forEach(id=>ids.add(id));
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
