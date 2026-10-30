import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, usersTable, vendorsTable, vendorPeopleTable, userOrgMembershipsTable, managedSubcontractorWorkerSponsorshipsTable, accountInvitationsTable, platformSettingsTable } from "@workspace/db";
import { addMembership } from "../lib/membership-sync";
import { membershipRoleForVendorPerson, sessionUserRoleForVendorPerson } from "../lib/vendor-people-management";
import { getAppOrigin } from "../lib/appOrigin";
import { renderStaffEnrollmentEmail, sendStaffEnrollmentEmail } from "../lib/staff-enrollment-email";

type Enrollment = { state?: string; userId?: number; email?: string; sentAt?: string; acceptedAt?: string; expiresAt?: string; attemptId?: string; issuedByUserId?: number };
export type EnrollmentStatus = { state: "unsent" | "sent" | "accepted" | "revoked"; email: string; expired: boolean; sentAt?: string; acceptedAt?: string; hasLogin: boolean; targetKey?: string };
export class StaffEnrollmentError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/\.(invalid|test)$/i.test(email);
function enrollmentOrigin() {
  const origin = getAppOrigin();
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname) ? "https://vndrly.ai" : origin;
}
export function enrollmentStatus(value: Enrollment | null, email: string, hasLogin: boolean, revoked: boolean, now = Date.now()): EnrollmentStatus {
  const state = revoked || value?.state === "revoked" ? "revoked" : value?.acceptedAt ? "accepted" : value?.sentAt ? "sent" : "unsent";
  return { state, email: validEmail(email) ? email : "", hasLogin, expired: state === "sent" && !!value?.expiresAt && Date.parse(value.expiresAt) <= now, ...(value?.sentAt ? { sentAt: value.sentAt } : {}), ...(value?.acceptedAt ? { acceptedAt: value.acceptedAt } : {}) };
}
export function enrollmentPassword(): string {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%"];
  const chars = groups.map(group => group[randomInt(group.length)]);
  const alphabet = groups.join("");
  while (chars.length < 8) chars.push(alphabet[randomInt(alphabet.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

export async function listStaffEnrollments(vendorId: number) {
  const [people, members, workers] = await Promise.all([
    db.select({ person: vendorPeopleTable, account: usersTable }).from(vendorPeopleTable).leftJoin(usersTable, eq(usersTable.id, vendorPeopleTable.userId)).where(eq(vendorPeopleTable.vendorId, vendorId)),
    db.select({ member: userOrgMembershipsTable, account: usersTable }).from(userOrgMembershipsTable).leftJoin(usersTable, eq(usersTable.id, userOrgMembershipsTable.userId)).where(and(eq(userOrgMembershipsTable.vendorId, vendorId), eq(userOrgMembershipsTable.orgType, "vendor"))),
    db.select({ worker: managedSubcontractorWorkerSponsorshipsTable, account: usersTable }).from(managedSubcontractorWorkerSponsorshipsTable).leftJoin(usersTable, eq(usersTable.id, managedSubcontractorWorkerSponsorshipsTable.workerUserId)).where(eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, vendorId)),
  ]);
  const entries: Record<string, EnrollmentStatus> = {};
  for (const { person, account } of people) {
    const enrollment = person.staffEnrollment || members.find(row => row.member.userId === person.userId)?.member.staffEnrollment || null;
    entries[`person:${person.id}`] = enrollmentStatus(enrollment, account?.email || person.email, !!account, !person.isActive || !!person.deletedAt || !!account?.suspendedAt || !!enrollment && !account);
  }
  for (const { member, account } of members) {
    const person = people.find(row => row.person.userId === member.userId);
    entries[`account:${member.userId}`] = person ? { ...entries[`person:${person.person.id}`], targetKey: `person:${person.person.id}` } : enrollmentStatus(member.staffEnrollment, account?.email || account?.username || "", !!account, !account || !!account.suspendedAt);
  }
  for (const { worker, account } of workers) {
    entries[`worker:${worker.id}`] = enrollmentStatus(worker.staffEnrollment, account?.email || account?.username || "", !!account && !/@unenrolled\.invalid$/i.test(account.email || account.username), worker.status !== "active" || !account || !!account.suspendedAt);
  }
  return { entries };
}

async function emailBrand(vendorId: number) {
  const [[vendor], [platform]] = await Promise.all([
    db.select({ name: vendorsTable.name, logo: vendorsTable.logoSquareUrl, fallbackLogo: vendorsTable.logoUrl, color: vendorsTable.brandPrimaryColor }).from(vendorsTable).where(eq(vendorsTable.id, vendorId)).limit(1),
    db.select({ logo: platformSettingsTable.logoSquareUrl, fallbackLogo: platformSettingsTable.logoUrl }).from(platformSettingsTable).where(eq(platformSettingsTable.id, 1)).limit(1),
  ]);
  if (!vendor) throw new StaffEnrollmentError("Company not found", 404);
  const asset = (value?: string | null) => value ? new URL(value, enrollmentOrigin()).toString() : undefined;
  const platformLogo = platform?.logo || platform?.fallbackLogo;
  return { vendorName: vendor.name, vendorLogoUrl: asset(vendor.logo || vendor.fallbackLogo), platformLogoUrl: asset(!platformLogo || /-preview\./i.test(platformLogo) ? "/favicon.png" : platformLogo), brandColor: vendor.color || undefined };
}

export async function previewStaffEnrollment(vendorId: number, name = "Your employee") {
  return renderStaffEnrollmentEmail({ ...(await emailBrand(vendorId)), displayName: name, to: "employee@example.com", inviteUrl: `${enrollmentOrigin()}/login`, temporaryPassword: "Demo8!pX", preview: true }).html;
}

export async function sendStaffEnrollment(vendorId: number, actorUserId: number, key: string, rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!validEmail(email)) throw new StaffEnrollmentError("Enter and verify a deliverable email address.");
  const brand = await emailBrand(vendorId);
  const [kind, id] = key.split(":");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`staff-enrollment:${vendorId}:${key}`},0))`);
    let userId: number | null = null, displayName = "", old: Enrollment | null = null;
    let person: typeof vendorPeopleTable.$inferSelect | undefined;
    let membership: typeof userOrgMembershipsTable.$inferSelect | undefined;
    let worker: typeof managedSubcontractorWorkerSponsorshipsTable.$inferSelect | undefined;
    if (kind === "person" && /^\d+$/.test(id)) {
      [person] = await tx.select().from(vendorPeopleTable).where(and(eq(vendorPeopleTable.id, Number(id)), eq(vendorPeopleTable.vendorId, vendorId), isNull(vendorPeopleTable.deletedAt))).limit(1).for("update");
      if (!person || !person.isActive) throw new StaffEnrollmentError("Active employee not found", 404);
      userId = person.userId; displayName = `${person.firstName} ${person.lastName}`.trim(); old = person.staffEnrollment;
    } else if (kind === "account" && /^\d+$/.test(id)) {
      [membership] = await tx.select().from(userOrgMembershipsTable).where(and(eq(userOrgMembershipsTable.userId, Number(id)), eq(userOrgMembershipsTable.vendorId, vendorId), eq(userOrgMembershipsTable.orgType, "vendor"))).limit(1).for("update");
      if (!membership) throw new StaffEnrollmentError("Company member not found", 404);
      const [linkedPerson] = await tx.select({ id: vendorPeopleTable.id }).from(vendorPeopleTable).where(and(eq(vendorPeopleTable.userId, membership.userId), eq(vendorPeopleTable.vendorId, vendorId))).limit(1);
      if (linkedPerson) throw new StaffEnrollmentError("Use the employee's shared profile invitation control.", 409);
      userId = membership.userId; old = membership.staffEnrollment;
    } else if (kind === "worker") {
      [worker] = await tx.select().from(managedSubcontractorWorkerSponsorshipsTable).where(and(eq(managedSubcontractorWorkerSponsorshipsTable.id, id), eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, vendorId))).limit(1).for("update");
      if (!worker || worker.status !== "active") throw new StaffEnrollmentError("Active contracted employee not found", 404);
      userId = worker.workerUserId; old = worker.staffEnrollment;
      [membership] = await tx.select().from(userOrgMembershipsTable).where(and(eq(userOrgMembershipsTable.userId, userId), eq(userOrgMembershipsTable.vendorId, vendorId))).limit(1);
      if (!membership) throw new StaffEnrollmentError("This contractor has no active company access. Restore access before inviting.", 409);
    } else throw new StaffEnrollmentError("Invalid employee reference");
    const persist = async (value: Enrollment) => {
      if (person) await tx.update(vendorPeopleTable).set({ staffEnrollment: value }).where(eq(vendorPeopleTable.id, person.id));
      else if (worker) await tx.update(managedSubcontractorWorkerSponsorshipsTable).set({ staffEnrollment: value }).where(eq(managedSubcontractorWorkerSponsorshipsTable.id, worker.id));
      else if (membership) await tx.update(userOrgMembershipsTable).set({ staffEnrollment: value }).where(eq(userOrgMembershipsTable.id, membership.id));
    };
    if (old?.acceptedAt || old?.state === "revoked") throw new StaffEnrollmentError("This enrollment is already accepted or revoked.", 409);
    if (old?.sentAt && old.email === email && old.expiresAt && Date.parse(old.expiresAt) > Date.now()) return { state: "sent", alreadySent: true };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`staff-login:${email}`},0))`);
    let account = userId ? (await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1).for("update"))[0] : undefined;
    if (account?.suspendedAt) throw new StaffEnrollmentError("This login is revoked. Reactivate it separately before inviting.", 409);
    let temporaryPassword: string | undefined;
    if (!account) {
      if (!person || person.userId) throw new StaffEnrollmentError("Linked login not found", 409);
      const [conflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(sql`lower(${usersTable.username}) = ${email} or lower(${usersTable.email}) = ${email}`).limit(1);
      if (conflict) throw new StaffEnrollmentError("This email already has an account. Link its existing company membership instead of creating another login.", 409);
      temporaryPassword = enrollmentPassword();
      const fieldLogin = ["gatekeeper", "gate_supervisor", "field", "field_employee", "foreman", "both", "driver"].includes(person.vendorRole);
      [account] = await tx.insert(usersTable).values({ username: email, email, displayName, passwordHash: await bcrypt.hash(temporaryPassword, 10), role: fieldLogin ? "field_employee" : sessionUserRoleForVendorPerson(person.vendorRole), mustChangePassword: true }).returning();
      userId = account.id;
      await tx.update(vendorPeopleTable).set({ userId, email }).where(eq(vendorPeopleTable.id, person.id));
      await addMembership({ userId, orgType: "vendor", orgId: vendorId, role: fieldLogin ? "field_employee" : membershipRoleForVendorPerson(person.vendorRole), vendorPeopleId: person.id }, tx);
    } else {
      const currentEmail = (account.email || account.username).toLowerCase();
      // A manually added contracted worker has an unusable, never-issued password.
      const [unissued] = worker && !old?.sentAt ? await tx.select({ id: accountInvitationsTable.id }).from(accountInvitationsTable).where(and(eq(accountInvitationsTable.userId, account.id), eq(accountInvitationsTable.sponsorVendorId, vendorId), eq(accountInvitationsTable.state, "pending"), isNull(accountInvitationsTable.deliveredAt), isNull(accountInvitationsTable.claimedAt))).limit(1) : [];
      if (unissued && !account.emailVerifiedAt && /@unenrolled\.invalid$/i.test(currentEmail)) {
        const [conflict] = await tx.select({ id: usersTable.id }).from(usersTable).where(sql`(lower(${usersTable.username}) = ${email} or lower(${usersTable.email}) = ${email}) and ${usersTable.id} <> ${account.id}`).limit(1);
        if (conflict) throw new StaffEnrollmentError("This email already belongs to another account.", 409);
        temporaryPassword = enrollmentPassword();
        await tx.update(usersTable).set({ email, username: email, passwordHash: await bcrypt.hash(temporaryPassword, 10), mustChangePassword: true }).where(eq(usersTable.id, account.id));
        await tx.update(accountInvitationsTable).set({ state: "revoked", revokedAt: new Date(), updatedAt: new Date() }).where(eq(accountInvitationsTable.id, unissued.id));
      } else if (currentEmail !== email) throw new StaffEnrollmentError("Verify the existing login email. Change account identity separately before sending an invitation.", 409);
      // Never rotate an existing employee's or canonical demo password.
      if (person) {
        const [member] = await tx.select({ id: userOrgMembershipsTable.id }).from(userOrgMembershipsTable).where(and(eq(userOrgMembershipsTable.userId, account.id), eq(userOrgMembershipsTable.vendorId, vendorId))).limit(1);
        if (!member) throw new StaffEnrollmentError("This login has no active company membership. Restore access separately.", 409);
      }
    }
    const now = new Date();
    if (/^(1|true|yes)$/i.test(process.env.SENDGRID_SANDBOX_MODE?.trim() || "")) throw new StaffEnrollmentError("Email is in sandbox mode; no real invitation was sent.", 503);
    await sendStaffEnrollmentEmail({ ...brand, displayName: displayName || account.displayName, to: email, inviteUrl: `${enrollmentOrigin()}/login`, temporaryPassword });
    await persist({ state: "sent", userId: account.id, email, sentAt: now.toISOString(), expiresAt: new Date(+now + 86400000).toISOString(), attemptId: randomUUID(), issuedByUserId: actorUserId });
    return { state: "sent", alreadySent: false };
  });
}

/** Called only after successful login, or after the required new password is saved. */
export async function acceptStaffEnrollment(userId: number, vendorId: number | null | undefined) {
  if (!vendorId) return;
  const acceptedAt = new Date().toISOString();
  const update = sql`staff_enrollment || jsonb_build_object('state','accepted','acceptedAt',${acceptedAt}::text)`;
  await db.transaction(async tx => {
    await tx.update(vendorPeopleTable).set({ staffEnrollment: update }).where(and(eq(vendorPeopleTable.userId, userId), eq(vendorPeopleTable.vendorId, vendorId), eq(vendorPeopleTable.isActive, true), isNull(vendorPeopleTable.deletedAt), sql`staff_enrollment->>'state' = 'sent'`));
    await tx.update(userOrgMembershipsTable).set({ staffEnrollment: update }).where(and(eq(userOrgMembershipsTable.userId, userId), eq(userOrgMembershipsTable.vendorId, vendorId), sql`staff_enrollment->>'state' = 'sent'`));
    await tx.update(managedSubcontractorWorkerSponsorshipsTable).set({ staffEnrollment: update }).where(and(eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, userId), eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, vendorId), eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"), sql`staff_enrollment->>'state' = 'sent'`));
  });
}
