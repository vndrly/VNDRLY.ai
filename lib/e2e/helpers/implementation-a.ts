import type pg from "pg";
import {
  createVendor,
  createUser,
  createUserOrgMembership,
  setActiveMembership,
} from "./fixtures";
import { hashPassword, makeStamp } from "./db";

export type VendorActorFixture = {
  vendorId: number;
  userId: number;
  username: string;
  password: string;
};

export async function createVendorActor(
  pool: pg.Pool,
  label: string,
  role: "admin" | "member" = "admin",
): Promise<VendorActorFixture> {
  const stamp = makeStamp();
  const password = "ImplementationAFixture-2026!";
  const vendor = await createVendor(pool, {
    name: `${label} ${stamp}`,
    contactName: `${label} Administrator`,
    contactEmail: `${label.toLowerCase().replaceAll(" ", "-")}-${stamp}@example.invalid`,
  });
  const username = `${label.toLowerCase().replaceAll(" ", "-")}-user-${stamp}@example.invalid`;
  const user = await createUser(pool, {
    username,
    email: username,
    passwordHash: hashPassword(password),
    role: role === "admin" ? "vendor" : "field_employee",
    displayName: `${label} User`,
  });
  const membership = await createUserOrgMembership(pool, {
    userId: user.id,
    orgType: "vendor",
    vendorId: vendor.id,
    role,
  });
  await setActiveMembership(pool, {
    userId: user.id,
    membershipId: membership.id,
  });
  await pool.query(
    "INSERT INTO platform_settings (id, work_hub_enabled) VALUES (1,true) ON CONFLICT (id) DO UPDATE SET work_hub_enabled=true",
  );
  return { vendorId: vendor.id, userId: user.id, username, password };
}

export async function createVendorMember(
  pool: pg.Pool,
  vendorId: number,
  label: string,
): Promise<VendorActorFixture> {
  const stamp = makeStamp();
  const password = "ImplementationAFixture-2026!";
  const username = `${label.toLowerCase().replaceAll(" ", "-")}-${stamp}@example.invalid`;
  const user = await createUser(pool, {
    username,
    email: username,
    passwordHash: hashPassword(password),
    role: "field_employee",
    displayName: label,
  });
  const membership = await createUserOrgMembership(pool, {
    userId: user.id,
    orgType: "vendor",
    vendorId,
    role: "member",
  });
  await setActiveMembership(pool, {
    userId: user.id,
    membershipId: membership.id,
  });
  return { vendorId, userId: user.id, username, password };
}

export function expectNoSecretFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/rawToken|tokenHash|temporaryPassword|passwordHash/i.test(serialized)) {
    throw new Error(
      "A password or activation-token secret crossed the public API boundary",
    );
  }
}
