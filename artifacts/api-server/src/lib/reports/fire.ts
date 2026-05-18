// IRS FIRE (Filing Information Returns Electronically) text-file generator.
//
// References:
//   - IRS Publication 1220 (2024) — record layouts
//   - IRS FIRE production system: https://fire.irs.gov
//
// FIRE files are fixed-width 750-byte records. Each record is terminated
// by CRLF. The required record sequence is:
//
//   T  Transmitter (one per file)
//   A  Issuer / Payer (one per payer)
//   B  Payee (one per recipient — repeated)
//   C  End of payer (totals for the preceding A)
//   K  State totals (only for combined federal/state filing — not emitted)
//   F  End of file (totals across all A records)
//
// The B record contains form-specific amount fields. We emit:
//   1099-NEC: Box 1 NEC compensation
//   1099-MISC: Box 1 (rents), Box 2 (royalties), Box 3 (other), Box 6
//             (medical), Box 10 (gross proceeds to attorney)
//   1099-K:   Box 1a (gross), Box 3 (transactions), Box 5a-5l (monthly)
//
// IMPORTANT: The transmitter control code (TCC), payer EIN, and
// recipient TINs must be valid for the IRS to accept this file. The
// generator pulls TCC from configuration; addresses are best-effort
// parsed from the single-line billing address on the partner/vendor
// record.

import {
  type Misc1099Row,
} from "./misc1099";
import { type K1099Row } from "./k1099";
import { type Nec1099Row } from "./nec1099";

export const FIRE_RECORD_LENGTH = 750;
const CRLF = "\r\n";

export type FireFormType = "NEC" | "MISC" | "K";

export interface FireTransmitterInfo {
  /** 5-character Transmitter Control Code (assigned by IRS). */
  tcc: string;
  /** Transmitter EIN (9 digits, no dashes). */
  ein: string;
  name: string;
  name2?: string | null;
  companyName?: string | null;
  mailingAddress: string;
  city: string;
  state: string;
  zip: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** True for IRS test environment, false for production. */
  testFile?: boolean;
  /** When true, transmitter is the same as issuer ("Vendor" indicator). */
  isVendor?: boolean;
}

export interface FirePayerInfo {
  /** Payer EIN (9 digits, no dashes). */
  ein: string;
  name: string;
  name2?: string | null;
  mailingAddress: string;
  city: string;
  state: string;
  zip: string;
  /** Phone for payer's contact, e.g. AP department. */
  contactPhone?: string | null;
}

/** Pub 1220 corrected-return indicator written into B record position
 * 6 (and A record position 7 for the surrounding payer block).
 *   "G" = one-step correction (amount/code/payee-indicator was wrong)
 *   "C" = two-step correction (TIN, name, money + identifier wrong)
 *   " " (or undefined) = original return
 * Per Pub 1220, all B records sharing an A block must agree on this
 * indicator — buildFirePayload enforces that by emitting one A block
 * per correction bucket.
 */
export type FireCorrectionIndicator = " " | "G" | "C";

export interface FireBPayee {
  /** Recipient TIN (9 digits, no dashes — SSN, EIN, or ITIN). */
  tin: string;
  /** "1" = EIN, "2" = SSN/ITIN. Defaults to "2" when unknown. */
  tinType?: "1" | "2";
  /** First 4 chars of last name (or first 4 chars of business name). */
  nameControl?: string | null;
  /** Recipient name (40 chars, truncated). */
  name: string;
  name2?: string | null;
  mailingAddress: string;
  city: string;
  state: string;
  zip: string;
  accountNumber?: string | null;
  /** Form-specific amount values (key = box number, value = numeric string). */
  amounts: Record<string, string>;
  /** 1099-K: number of transactions (Box 3). */
  numberOfTransactions?: number;
  /** 1099-K: 12 monthly totals (Jan…Dec). */
  monthlyAmounts?: string[];
  /** Pub 1220 corrected-return indicator (B record position 6). */
  correctionIndicator?: FireCorrectionIndicator;
}

/**
 * Wire-level snapshot of the *original* payee B-record fields captured at
 * filing time. Replayed (with all amount slots zeroed) as the back-out B
 * record that Pub 1220 §F.5 two-step ("C") corrections require to precede
 * the corrected B record. The shape mirrors the relevant subset of
 * FireBPayee. The schema-side `FirePayeeSnapshot` interface in
 * `lib/db/src/schema/tax1099Filings.ts` is structurally compatible with
 * this type.
 */
export interface FirePayeeSnapshotLike {
  tin: string;
  tinType?: "1" | "2";
  nameControl?: string | null;
  name: string;
  name2?: string | null;
  mailingAddress: string;
  city: string;
  state: string;
  zip: string;
  accountNumber?: string | null;
  amounts: Record<string, string>;
  numberOfTransactions?: number;
  monthlyAmounts?: string[];
}

/**
 * Build the zero-dollar back-out B record for a Pub 1220 §F.5 two-step
 * ("C") correction. All amount slots, monthly amounts, and the K
 * transaction count are zeroed; identifiers (TIN, name, address,
 * account number) are preserved verbatim so the IRS can match this
 * back-out against the row originally filed.
 */
export function snapshotToZeroDollarPayee(
  snap: FirePayeeSnapshotLike,
): FireBPayee {
  const zeroedAmounts: Record<string, string> = {};
  for (const k of Object.keys(snap.amounts)) zeroedAmounts[k] = "0";
  return {
    tin: snap.tin,
    tinType: snap.tinType,
    nameControl: snap.nameControl ?? null,
    name: snap.name,
    name2: snap.name2 ?? null,
    mailingAddress: snap.mailingAddress,
    city: snap.city,
    state: snap.state,
    zip: snap.zip,
    accountNumber: snap.accountNumber ?? null,
    amounts: zeroedAmounts,
    numberOfTransactions:
      snap.numberOfTransactions != null ? 0 : undefined,
    monthlyAmounts: snap.monthlyAmounts
      ? snap.monthlyAmounts.map(() => "0")
      : undefined,
    correctionIndicator: "C",
  };
}

/**
 * Bucket payees by Pub 1220 corrected-return indicator (" ", "G", "C")
 * for FIRE export. The IRS rejects files that mix originals and
 * corrections under one A record, so each bucket becomes its own A
 * block. For the "C" bucket, every payee is preceded by a zero-dollar
 * back-out B record built from `snapshotByVendor` (when present) —
 * this is the §F.5 two-step requirement. When a "C" row has no
 * snapshot (legacy rows filed before snapshot capture existed), only
 * the corrected record is emitted.
 *
 * Pure function: takes parallel arrays `payees`/`vendorIds` plus the
 * lookup maps and returns the three buckets. No DB / I/O.
 */
export function bucketFirePayeesByCorrection(args: {
  payees: FireBPayee[];
  vendorIds: number[];
  corrByVendor: Map<number, FireCorrectionIndicator>;
  snapshotByVendor: Map<number, FirePayeeSnapshotLike>;
}): Record<FireCorrectionIndicator, FireBPayee[]> {
  const buckets: Record<FireCorrectionIndicator, FireBPayee[]> = {
    " ": [],
    G: [],
    C: [],
  };
  for (let i = 0; i < args.payees.length; i++) {
    const ind = args.corrByVendor.get(args.vendorIds[i]) ?? " ";
    if (ind === " ") {
      buckets[" "].push(args.payees[i]);
    } else if (ind === "C") {
      const snap = args.snapshotByVendor.get(args.vendorIds[i]);
      if (snap) {
        buckets.C.push(snapshotToZeroDollarPayee(snap));
      }
      buckets.C.push({ ...args.payees[i], correctionIndicator: "C" });
    } else {
      buckets[ind].push({ ...args.payees[i], correctionIndicator: ind });
    }
  }
  return buckets;
}

export interface FirePayerBlock {
  payer: FirePayerInfo;
  payees: FireBPayee[];
  /**
   * Pub 1220 corrected-return indicator for the A record (position 7).
   * Should match the indicator on every B record in `payees` — IRS will
   * reject a file that mixes original and corrected B records under one
   * A record. Defaults to " " (original).
   */
  correctionIndicator?: FireCorrectionIndicator;
}

export interface FireFileSpec {
  taxYear: number;
  formType: FireFormType;
  transmitter: FireTransmitterInfo;
  payers: FirePayerBlock[];
}

interface RecordCounter {
  seq: number;
}

/** Render a complete FIRE TXT file as a Buffer. */
export function renderFireFile(spec: FireFileSpec): Buffer {
  const counter: RecordCounter = { seq: 0 };
  const lines: string[] = [];

  lines.push(buildTRecord(spec, counter));

  let totalPayees = 0;
  for (const block of spec.payers) {
    const blockIndicator: FireCorrectionIndicator =
      block.correctionIndicator ?? " ";
    lines.push(
      buildARecord(spec, block.payer, block.payees, blockIndicator, counter),
    );
    let payerPayeeCount = 0;
    // 18 standard amount-code slots, one running total each (in cents).
    const slotTotalsCents = new Array<number>(18).fill(0);
    // 1099-K extension totals: monthly Sep–Dec + total transaction count.
    const kExt: KExtensionCents = {
      sep: 0,
      oct: 0,
      nov: 0,
      dec: 0,
      txnCount: 0,
    };
    for (const payee of block.payees) {
      lines.push(buildBRecord(spec, payee, counter));
      payerPayeeCount++;
      const slots = payeeBoxCents(spec.formType, payee);
      for (let i = 0; i < slots.length; i++) slotTotalsCents[i] += slots[i];
      if (spec.formType === "K") {
        const ext = payeeKExtensionCents(payee);
        kExt.sep += ext.sep;
        kExt.oct += ext.oct;
        kExt.nov += ext.nov;
        kExt.dec += ext.dec;
        kExt.txnCount += ext.txnCount;
      }
    }
    lines.push(
      buildCRecord(
        spec.formType,
        payerPayeeCount,
        slotTotalsCents,
        spec.formType === "K" ? kExt : null,
        counter,
      ),
    );
    totalPayees += payerPayeeCount;
  }

  lines.push(buildFRecord(spec.payers.length, totalPayees, counter));

  return Buffer.from(lines.join(CRLF) + CRLF, "ascii");
}

interface KExtensionCents {
  sep: number;
  oct: number;
  nov: number;
  dec: number;
  txnCount: number;
}

/**
 * Per-form mapping from payee.amounts/monthlyAmounts → the 18-slot
 * "Payment Amount" array (Pub 1220 amount codes 1..9, A, B, C, then 6
 * unused slots that remain zero so the C-record stays a flat 18 totals).
 * Values are returned in cents so summation stays integer-clean.
 */
function payeeBoxCents(form: FireFormType, p: FireBPayee): number[] {
  const slots = new Array<number>(18).fill(0);
  if (form === "NEC") {
    slots[0] = toCents(p.amounts["1"]);
  } else if (form === "MISC") {
    slots[0] = toCents(p.amounts["1"]);  // Box 1  Rents
    slots[1] = toCents(p.amounts["2"]);  // Box 2  Royalties
    slots[2] = toCents(p.amounts["3"]);  // Box 3  Other income
    slots[5] = toCents(p.amounts["6"]);  // Box 6  Medical
    slots[9] = toCents(p.amounts["10"]); // Box 10 Attorney (Amount Code A)
  } else if (form === "K") {
    slots[0] = toCents(p.amounts["1A"]); // Box 1a Gross
    // Pub 1220 1099-K layout: amount codes 5..9 + A,B,C carry the first
    // eight months Jan..Aug. Sep–Dec live in form-specific extension
    // fields written by buildBRecord and totalled in buildCRecord.
    if (p.monthlyAmounts) {
      for (let i = 0; i < 8; i++) {
        slots[4 + i] = toCents(p.monthlyAmounts[i]);
      }
    }
  }
  return slots;
}

function payeeKExtensionCents(p: FireBPayee): KExtensionCents {
  return {
    sep: toCents(p.monthlyAmounts?.[8]),
    oct: toCents(p.monthlyAmounts?.[9]),
    nov: toCents(p.monthlyAmounts?.[10]),
    dec: toCents(p.monthlyAmounts?.[11]),
    txnCount: p.numberOfTransactions ?? 0,
  };
}

function toCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  return Math.max(0, Math.round(Number(value) * 100));
}

// ─── Field helpers ─────────────────────────────────────────────────

/** Pad with trailing spaces to width, truncate if longer. ASCII safe. */
function padRight(value: string | null | undefined, width: number): string {
  const v = sanitize(value);
  if (v.length >= width) return v.slice(0, width);
  return v + " ".repeat(width - v.length);
}

/** Right-aligned numeric field, zero-filled. */
function padNum(value: number | string, width: number): string {
  const s = String(value).replace(/[^0-9]/g, "");
  if (s.length >= width) return s.slice(s.length - width);
  return "0".repeat(width - s.length) + s;
}

/** Strip non-ASCII, control chars, CR/LF — IIF/FIRE both ban embedded newlines. */
function sanitize(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .toUpperCase();
}

/** EIN/TIN: strip non-digits, pad-left to 9. Returns "000000000" if blank. */
export function normalizeTin(tin: string | null | undefined): string {
  const digits = (tin ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 0) return "000000000";
  if (digits.length >= 9) return digits.slice(0, 9);
  return "0".repeat(9 - digits.length) + digits;
}

/** Zip: strip non-digits, pad to 9 with trailing zeros. */
export function normalizeZip(zip: string | null | undefined): string {
  const digits = (zip ?? "").replace(/[^0-9]/g, "");
  if (digits.length >= 9) return digits.slice(0, 9);
  return digits + "0".repeat(9 - digits.length);
}

/** State: 2-letter, uppercase, padded with spaces. */
export function normalizeState(state: string | null | undefined): string {
  const s = sanitize(state).slice(0, 2);
  return s.length === 2 ? s : padRight(s, 2);
}

/**
 * Best-effort parse of "Street, City, ST 12345" into structured parts.
 * Falls back to putting the whole address on the street line.
 */
export function parseAddress(raw: string | null | undefined): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const text = (raw ?? "").trim();
  const empty = { street: "", city: "", state: "", zip: "" };
  if (!text) return empty;

  // Match trailing "City, ST 12345[-1234]"
  const m = text.match(
    /^(.*?)[,\s]+([A-Za-z .'-]+)[,\s]+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/,
  );
  if (m) {
    return {
      street: m[1].trim().replace(/,$/, ""),
      city: m[2].trim(),
      state: m[3].trim().toUpperCase(),
      zip: m[4].trim(),
    };
  }
  return { street: text, city: "", state: "", zip: "" };
}

/** Derive the 4-char "name control" used in FIRE B records. */
export function nameControl(name: string): string {
  const cleaned = sanitize(name).replace(/[^A-Z0-9 &-]/g, "").trim();
  // Use last word for individuals, first significant word for businesses
  // (heuristic: presence of comma → "Last, First").
  const word = cleaned.includes(",")
    ? cleaned.split(",")[0].trim()
    : cleaned.split(/\s+/)[0] ?? "";
  return padRight(word, 4);
}

// ─── Record builders ───────────────────────────────────────────────

function nextSeq(c: RecordCounter): number {
  c.seq++;
  return c.seq;
}

function buildTRecord(spec: FireFileSpec, c: RecordCounter): string {
  const t = spec.transmitter;
  const r =
    "T" +
    padNum(spec.taxYear, 4) +
    " " + // 6: prior year indicator
    normalizeTin(t.ein) + // 7-15
    padRight(t.tcc, 5) + // 16-20
    padRight("", 7) + // 21-27 blank
    (t.testFile ? "T" : " ") + // 28 test file indicator
    " " + // 29 foreign entity indicator
    padRight(t.name, 40) + // 30-69
    padRight(t.name2 ?? "", 40) + // 70-109
    padRight(t.companyName ?? t.name, 40) + // 110-149
    padRight("", 40) + // 150-189 company name 2
    padRight(t.mailingAddress, 40) + // 190-229
    padRight(t.city, 40) + // 230-269
    normalizeState(t.state) + // 270-271
    normalizeZip(t.zip) + // 272-280
    padNum(0, 8) + // 281-288 total payees on file (filled in F)
    padRight(t.contactName, 40) + // 289-328
    padRight(t.contactPhone, 15) + // 329-343
    padRight(t.contactEmail, 50) + // 344-393
    padRight("", 91) + // 394-484 reserved
    padNum(nextSeq(c), 8) + // 485-492 record sequence number
    padRight("", 10) + // 493-502 reserved
    (t.isVendor ? "V" : " ") + // 503 vendor indicator
    padRight("", 230) + // 504-733 vendor block (we are not a software vendor)
    padRight("", 17); // 734-750 reserved
  return ensureWidth(r);
}

function buildARecord(
  spec: FireFileSpec,
  p: FirePayerInfo,
  payees: FireBPayee[],
  correctionIndicator: FireCorrectionIndicator,
  c: RecordCounter,
): string {
  const formCode = formAmountCode(spec.formType, payees);
  const r =
    "A" +
    padNum(spec.taxYear, 4) +
    " " + // 6: combined federal/state filer (blank = federal only)
    correctionIndicator + // 7: corrected return indicator (G/C/space)
    padRight("", 5) + // 8-12 reserved
    normalizeTin(p.ein) + // 13-21
    padRight("", 4) + // 22-25 payer name control
    " " + // 26 last filing indicator
    formCode.typeOfReturn + // 27-28 type of return ('NE' for NEC, 'A ' for MISC, 'MA' for K)
    formCode.amountIndicators + // 29-44 amount indicators (16 chars)
    " " + // 45 foreign entity
    " " + // 46 first filing indicator
    padRight("", 1) + // 47 type of TIN (blank for A)
    padRight(p.name, 40) + // 48-87
    padRight("", 40) + // 88-127 transfer agent name (none)
    padRight(p.mailingAddress, 40) + // 128-167
    padRight(p.city, 40) + // 168-207
    normalizeState(p.state) + // 208-209
    normalizeZip(p.zip) + // 210-218
    padRight(p.contactPhone ?? "", 15) + // 219-233
    padRight("", 260) + // 234-493 reserved
    padNum(nextSeq(c), 8) + // 494-501 record sequence number
    padRight("", 249); // 502-750 reserved
  return ensureWidth(r);
}

// Form-specific extension field positions in the 1099-K B record (Pub
// 1220, Section 7). Values past the standard amount-code area (>= 199)
// are form-specific; for 1099-K we use the conventional positions:
//   547-558  Box 5i  September
//   559-570  Box 5j  October
//   571-582  Box 5k  November
//   583-594  Box 5l  December
//   595-606  Box 3   Number of payment transactions (integer, zero-filled)
// The same offsets are used in the C record (×18-char wide totals) so
// the per-payer extension totals line up with the per-payee values.
const K_B_EXT_START = 546; // 0-indexed start position; first ext field is pos 547
const K_C_EXT_START = 539; // first C-record ext field is pos 540 (18-char wide)

function buildBRecord(
  spec: FireFileSpec,
  payee: FireBPayee,
  c: RecordCounter,
): string {
  const tin = normalizeTin(payee.tin);
  const tinType = payee.tinType ?? "2";
  const nc = payee.nameControl
    ? padRight(payee.nameControl.toUpperCase(), 4)
    : nameControl(payee.name);

  // First 12 fields up through Payment Amount Fields are common to all forms.
  let r =
    "B" +
    padNum(spec.taxYear, 4) + // 2-5
    (payee.correctionIndicator ?? " ") + // 6 corrected return indicator
    nc + // 7-10 name control
    tinType + // 11 type of TIN
    tin + // 12-20 TIN
    padRight(payee.accountNumber ?? "", 20) + // 21-40 account number
    padRight("", 4) + // 41-44 office code (blank)
    padRight("", 10); // 45-54 reserved

  // Payment amount fields: 12 boxes × 12 chars = 144 chars (positions 55-198).
  // We map per form. Order = box numbers 1..C (1099 spec lettered).
  r += buildAmountFields(spec.formType, payee); // exactly 144 chars → pos 198

  // Positions 199-247: foreign country indicator + first payee name + name 2
  r +=
    " " + // 199 foreign country indicator
    padRight(payee.name, 40) + // 200-239 first payee name line
    padRight(payee.name2 ?? "", 40); // 240-279 second payee name line

  // 280-319 mailing address, 320-359 city, 360-361 state, 362-370 zip
  r +=
    padRight(payee.mailingAddress, 40) +
    padRight(payee.city, 40) +
    normalizeState(payee.state) +
    normalizeZip(payee.zip);
  // r.length === 370 here

  // Pad reserved through position K_B_EXT_START, then write K extensions.
  r += padRight("", K_B_EXT_START - r.length); // → pos 546
  if (spec.formType === "K") {
    const ext = payeeKExtensionCents(payee);
    r += padCents(ext.sep, 12); // 547-558
    r += padCents(ext.oct, 12); // 559-570
    r += padCents(ext.nov, 12); // 571-582
    r += padCents(ext.dec, 12); // 583-594
    r += padNum(ext.txnCount, 12); // 595-606
  } else {
    r += padRight("", 60); // 547-606 reserved for non-K
  }

  // Pad reserved through pos 742, then 8-char record sequence number
  // ends the 750-byte record.
  r += padRight("", FIRE_RECORD_LENGTH - 8 - r.length);
  r += padNum(nextSeq(c), 8);
  return ensureWidth(r);
}

function buildCRecord(
  formType: FireFormType,
  payeeCount: number,
  slotTotalsCents: number[],
  kExtensionTotals: KExtensionCents | null,
  c: RecordCounter,
): string {
  let r =
    "C" +
    padNum(payeeCount, 8) + // 2-9 number of payees
    padRight("", 6); // 10-15 blank
  // 16-339 payment amount totals: 18 box totals × 18 chars = 324 chars
  for (let i = 0; i < 18; i++) {
    r += padCents(slotTotalsCents[i] ?? 0, 18);
  }
  // r.length === 339 here

  // Pad reserved through pos K_C_EXT_START, then write K extension totals.
  r += padRight("", K_C_EXT_START - r.length); // → pos 539
  if (formType === "K" && kExtensionTotals) {
    r += padCents(kExtensionTotals.sep, 18); // 540-557
    r += padCents(kExtensionTotals.oct, 18); // 558-575
    r += padCents(kExtensionTotals.nov, 18); // 576-593
    r += padCents(kExtensionTotals.dec, 18); // 594-611
    r += padNum(kExtensionTotals.txnCount, 18); // 612-629
  } else {
    r += padRight("", 18 * 5); // 540-629 reserved for non-K
  }

  // Pad reserved through pos 742, then 8-char record sequence number
  // ends the 750-byte record.
  r += padRight("", FIRE_RECORD_LENGTH - 8 - r.length);
  r += padNum(nextSeq(c), 8);
  return ensureWidth(r);
}

function buildFRecord(
  payerCount: number,
  totalPayees: number,
  c: RecordCounter,
): string {
  const r =
    "F" +
    padNum(payerCount, 8) + // 2-9 number of A records
    padRight("", 21) + // 10-30 reserved (zeros)
    padNum(totalPayees, 8) + // 31-38 total payees on file
    padRight("", 451) + // 39-489 reserved
    padNum(nextSeq(c), 8) + // 490-497 record sequence number
    padRight("", FIRE_RECORD_LENGTH - 1 - 8 - 21 - 8 - 451 - 8);
  return ensureWidth(r);
}

interface FormAmountCode {
  typeOfReturn: string;       // 2 chars in A record
  amountIndicators: string;   // 16 chars
}

function formAmountCode(
  form: FireFormType,
  payees: FireBPayee[],
): FormAmountCode {
  // Pub 1220 type-of-return codes:
  //   1099-NEC = "NE", 1099-MISC = "A ", 1099-K = "MC"
  // Amount indicators are 16-char strings; "1" enables that box. The
  // 16 positions correspond to amount codes 1, 2, …, 9, A, B, C, D, E,
  // F, G in order — the same slot order used by payeeBoxCents.
  switch (form) {
    case "NEC":
      return { typeOfReturn: "NE", amountIndicators: "1000000000000000" };
    case "MISC":
      // Boxes 1, 2, 3, 6, A (10). Slot positions in the 16-char mask are
      // 0,1,2 (codes 1,2,3) + 5 (code 6) + 9 (code A = Box 10 Attorney) —
      // matching exactly the slots payeeBoxCents writes to. The previous
      // value flagged slot 10 (code B), one position off from where the
      // renderer actually puts the attorney amount; the A/B drift guard
      // test catches that kind of off-by-one.
      return { typeOfReturn: "A ", amountIndicators: "1110010001000000" };
    case "K": {
      // Box 1A (gross) is always populated. The Jan–Aug monthly boxes
      // are amount codes 5..9 + A,B,C → indicator slots 4..11. Sep–Dec
      // live in the form-specific extension area, not in the standard
      // amount-code mask, so they don't get indicator bits here. Per
      // Pub 1220 §7, the A-record indicator must flag every amount
      // code that any following B record actually populates — otherwise
      // the IRS may not pick up the monthly breakouts.
      const mask = ["1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
      const anyMonthly = payees.some(
        (p) =>
          Array.isArray(p.monthlyAmounts) &&
          p.monthlyAmounts.slice(0, 8).some((v) => toCents(v) > 0),
      );
      if (anyMonthly) {
        for (let i = 4; i < 12; i++) mask[i] = "1";
      }
      return { typeOfReturn: "MC", amountIndicators: mask.join("") };
    }
  }
}

function buildAmountFields(form: FireFormType, p: FireBPayee): string {
  // 12 boxes × 12 chars each = 144 chars. Each field is right-justified
  // dollars in cents, zero-filled, no decimal point. Source-of-truth for
  // the slot mapping is payeeBoxCents — keeping a single function avoids
  // any drift between the per-payee record and the per-payer C totals.
  const slots = payeeBoxCents(form, p);
  let out = "";
  for (let i = 0; i < 12; i++) out += padCents(slots[i] ?? 0, 12);
  return out;
}

/**
 * Render an integer-cent value as a right-justified, zero-filled
 * fixed-width string. Negative or NaN clamps to zero — IRS does not
 * accept signed amounts on 1099 information returns.
 */
function padCents(cents: number, width: number): string {
  const safe = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
  const s = String(safe);
  if (s.length >= width) return s.slice(s.length - width);
  return "0".repeat(width - s.length) + s;
}

function ensureWidth(record: string): string {
  if (record.length === FIRE_RECORD_LENGTH) return record;
  if (record.length > FIRE_RECORD_LENGTH)
    return record.slice(0, FIRE_RECORD_LENGTH);
  return record + " ".repeat(FIRE_RECORD_LENGTH - record.length);
}

// ─── Adapters from aggregation rows → FIRE payee records ──────────

export function necRowsToPayees(rows: Nec1099Row[]): FireBPayee[] {
  return rows.map((r) => {
    const a = parseAddress(r.vendorAddress);
    return {
      tin: r.federalTaxId ?? "",
      tinType: "2",
      name: r.vendorName,
      mailingAddress: a.street,
      city: a.city,
      state: a.state,
      zip: a.zip,
      amounts: { "1": r.totalPaid },
    };
  });
}

export function miscRowsToPayees(rows: Misc1099Row[]): FireBPayee[] {
  return rows.map((r) => {
    const a = parseAddress(r.vendorAddress);
    return {
      tin: r.federalTaxId ?? "",
      tinType: "2",
      name: r.vendorName,
      mailingAddress: a.street,
      city: a.city,
      state: a.state,
      zip: a.zip,
      amounts: {
        "1": r.box1Rents,
        "2": r.box2Royalties,
        "3": (Number(r.box3OtherIncome) + Number(r.box3PrizesAwards)).toFixed(2),
        "6": r.box6MedicalHealth,
        "10": r.box10Attorney,
      },
    };
  });
}

export function kRowsToPayees(rows: K1099Row[]): FireBPayee[] {
  return rows.map((r) => {
    const a = parseAddress(r.vendorAddress);
    return {
      tin: r.federalTaxId ?? "",
      tinType: "2",
      name: r.vendorName,
      mailingAddress: a.street,
      city: a.city,
      state: a.state,
      zip: a.zip,
      amounts: { "1A": r.grossAmount },
      numberOfTransactions: r.transactionCount,
      monthlyAmounts: r.monthly,
    };
  });
}
