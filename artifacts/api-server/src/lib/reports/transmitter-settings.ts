// Resolver for the IRS FIRE transmitter info written into the T record.
//
// The 1099 e-file generator used to read transmitter info exclusively
// from `IRS_FIRE_*` environment variables, then briefly merged the DB
// row with those env vars on a per-field basis for backward
// compatibility. The env-var fallback was removed in Task #826: the
// `fire_transmitter_settings` singleton row is now the only source of
// truth so an unused / typo'd env var can never silently leak into a
// real submission. Admins manage the row from the IRS FIRE settings
// page (see `routes/fireTransmitterSettings.ts`).
//
// Validation (required fields + parseable address) lives here so the
// FIRE download route and the admin settings save route enforce the
// exact same rules — a successful PUT means a real (non-test) FIRE
// file will build immediately, with no second-guessing.

import { eq } from "drizzle-orm";
import {
  db,
  fireTransmitterSettingsTable,
  type FireTransmitterSettings,
} from "@workspace/db";
import { parseAddress, type FireTransmitterInfo } from "./fire";

// id=1 singleton — see schema comment for rationale.
export const FIRE_TRANSMITTER_SETTINGS_ID = 1 as const;

// Field names used in API responses' `missing` array AND in the
// validator below. Keep this list — and the property names on
// `EffectiveTransmitter` — in lockstep with the
// UpdateFireTransmitterSettingsBody schema so the UI can highlight the
// exact field that needs attention.
export const TRANSMITTER_FIELDS = [
  "tcc",
  "ein",
  "name",
  "address",
  "contactName",
  "contactEmail",
  "contactPhone",
] as const;

export type TransmitterField = (typeof TRANSMITTER_FIELDS)[number];

/** The seven raw values, each either a real string or "" if the DB
 *  row supplies no value. The DB row is the only source — there is no
 *  env-var fallback (removed in Task #826). */
export interface EffectiveTransmitter {
  tcc: string;
  ein: string;
  name: string;
  address: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

/** Read the singleton row (or null if it has never been saved). Kept
 *  small + uncached so the read-after-write semantics on the admin
 *  settings page are obvious. */
export async function readFireTransmitterRow(): Promise<FireTransmitterSettings | null> {
  const [row] = await db
    .select()
    .from(fireTransmitterSettingsTable)
    .where(eq(fireTransmitterSettingsTable.id, FIRE_TRANSMITTER_SETTINGS_ID));
  return row ?? null;
}

/** Compose the effective seven values from the singleton row, trimming
 *  each one. Returns "" for any field that is unset on the row — the
 *  caller decides whether that's an error. */
export function effectiveFromRow(
  row: FireTransmitterSettings | null,
): EffectiveTransmitter {
  const fromRow = (v: string | null | undefined): string => (v ?? "").trim();
  return {
    tcc: fromRow(row?.tcc),
    ein: fromRow(row?.ein),
    name: fromRow(row?.name),
    address: fromRow(row?.address),
    contactName: fromRow(row?.contactName),
    contactEmail: fromRow(row?.contactEmail),
    contactPhone: fromRow(row?.contactPhone),
  };
}

/**
 * Validation result — either a complete-and-parseable transmitter
 * (`ok:true`) or a list of field names the operator needs to fix
 * (`missing`). The address counts as "missing" when it can't be
 * parsed into city/state/zip, since that produces an invalid T
 * record (city padded with spaces, zip blank) the IRS would reject.
 */
export type TransmitterValidation =
  | { ok: true; missing: never[] }
  | { ok: false; missing: TransmitterField[] };

export function validateEffective(
  effective: EffectiveTransmitter,
): TransmitterValidation {
  const missing: TransmitterField[] = [];
  for (const f of TRANSMITTER_FIELDS) {
    if (effective[f].trim() === "") missing.push(f);
  }
  if (!missing.includes("address")) {
    const a = parseAddress(effective.address);
    if (a.city === "" || a.state === "" || a.zip === "") {
      missing.push("address");
    }
  }
  if (missing.length === 0) return { ok: true, missing: [] };
  return { ok: false, missing };
}

/** Translate the seven effective values into the wire shape the FIRE
 *  T record builder expects. `testFile` mirrors the existing
 *  resolveTransmitter behavior. */
export function effectiveToFireTransmitter(
  effective: EffectiveTransmitter,
  opts: { test: boolean },
): FireTransmitterInfo {
  const addr = parseAddress(effective.address);
  return {
    tcc: effective.tcc,
    ein: effective.ein,
    name: effective.name,
    companyName: effective.name,
    mailingAddress: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    contactName: effective.contactName,
    contactPhone: effective.contactPhone,
    contactEmail: effective.contactEmail,
    testFile: opts.test,
  };
}
