import { describe, expect, it } from "vitest";
import {
  renderFireFile,
  normalizeTin,
  normalizeZip,
  normalizeState,
  parseAddress,
  nameControl,
  necRowsToPayees,
  miscRowsToPayees,
  kRowsToPayees,
  bucketFirePayeesByCorrection,
  snapshotToZeroDollarPayee,
  FIRE_RECORD_LENGTH,
  type FireTransmitterInfo,
  type FireBPayee,
  type FireCorrectionIndicator,
  type FirePayeeSnapshotLike,
} from "./fire";

const transmitter: FireTransmitterInfo = {
  tcc: "12345",
  ein: "987654321",
  name: "VNDRLY INC",
  companyName: "VNDRLY INC",
  mailingAddress: "100 Big Ave",
  city: "Houston",
  state: "TX",
  zip: "770010000",
  contactName: "Tax Ops",
  contactPhone: "5550001111",
  contactEmail: "tax@vndrly.example",
  testFile: false,
};

const payee: FireBPayee = {
  tin: "111223333",
  tinType: "1",
  name: "Acme Drilling LLC",
  mailingAddress: "1 Main St",
  city: "Midland",
  state: "TX",
  zip: "797010000",
  amounts: { "1": "1500.00" },
};

describe("FIRE field normalizers", () => {
  it("normalizeTin strips dashes and pads to 9", () => {
    expect(normalizeTin("12-3456789")).toBe("123456789");
    expect(normalizeTin("123")).toBe("000000123");
    expect(normalizeTin(null)).toBe("000000000");
    expect(normalizeTin("123456789012")).toHaveLength(9);
  });

  it("normalizeZip pads to 9 digits with trailing zeros", () => {
    expect(normalizeZip("77001")).toBe("770010000");
    expect(normalizeZip("77001-0000")).toBe("770010000");
    expect(normalizeZip(null)).toBe("000000000");
  });

  it("normalizeState yields exactly 2 uppercase chars", () => {
    expect(normalizeState("tx")).toBe("TX");
    expect(normalizeState("CA")).toBe("CA");
    expect(normalizeState(null)).toHaveLength(2);
  });

  it("parseAddress splits 'Street, City, ST 12345' style addresses", () => {
    const a = parseAddress("123 Main St, Midland, TX 79701");
    expect(a.street).toBe("123 Main St");
    expect(a.city).toBe("Midland");
    expect(a.state).toBe("TX");
    expect(a.zip).toBe("79701");
  });

  it("parseAddress falls back to street-only when unparseable", () => {
    const a = parseAddress("just some text");
    expect(a.street.length).toBeGreaterThan(0);
  });

  it("nameControl returns first 4 chars uppercased", () => {
    expect(nameControl("Acme Drilling LLC")).toBe("ACME");
    expect(nameControl("Z").length).toBeLessThanOrEqual(4);
  });
});

describe("renderFireFile — record structure", () => {
  it("emits T, A, B, C, F records of exactly 750 bytes each", () => {
    const buf = renderFireFile({
      transmitter,
      formType: "NEC",
      taxYear: 2026,
      payers: [
        {
          payer: {
            ein: "987654321",
            name: "Energy Corp",
            mailingAddress: "200 Big Ave",
            city: "Houston",
            state: "TX",
            zip: "770010000",
          },
          payees: [payee],
        },
      ],
    });
    const text = buf.toString("ascii");
    const lines = text.split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(5); // T A B C F
    for (const line of lines) {
      expect(line.length).toBe(FIRE_RECORD_LENGTH);
    }
    expect(lines[0][0]).toBe("T");
    expect(lines[1][0]).toBe("A");
    expect(lines[2][0]).toBe("B");
    expect(lines[3][0]).toBe("C");
    expect(lines[4][0]).toBe("F");
  });

  it("encodes the tax year in the T record", () => {
    const buf = renderFireFile({
      transmitter,
      formType: "NEC",
      taxYear: 2026,
      payers: [],
    });
    const t = buf.toString("ascii").split("\r\n")[0];
    // Per FIRE spec, payment year occupies positions 2-5 (1-indexed).
    expect(t.slice(1, 5)).toBe("2026");
  });

  it("flags the test indicator when testFile=true", () => {
    const buf = renderFireFile({
      transmitter: { ...transmitter, testFile: true },
      formType: "NEC",
      taxYear: 2026,
      payers: [],
    });
    const t = buf.toString("ascii").split("\r\n")[0];
    // Position 28 (1-indexed) is the test indicator field.
    expect(t[27]).toBe("T");
  });

  it("supports MISC and K form types", () => {
    for (const formType of ["MISC", "K"] as const) {
      const buf = renderFireFile({
        transmitter,
        formType,
        taxYear: 2026,
        payers: [
          {
            payer: {
              ein: "987654321",
              name: "Issuer",
              mailingAddress: "1 St",
              city: "City",
              state: "TX",
              zip: "770010000",
            },
            payees: [
              formType === "K"
                ? {
                    ...payee,
                    amounts: { "1A": "5000.00" },
                    numberOfTransactions: 12,
                    monthlyAmounts: Array(12).fill("416.67"),
                  }
                : { ...payee, amounts: { "1": "1500.00" } },
            ],
          },
        ],
      });
      const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
      expect(lines).toHaveLength(5);
      for (const line of lines) expect(line.length).toBe(FIRE_RECORD_LENGTH);
    }
  });
});

describe("renderFireFile — T record (byte-position spec)", () => {
  // Pub 1220 (2024) Section 7 — Transmitter "T" Record.
  // Field positions are 1-indexed in the spec, so a slice(start-1, end)
  // here lifts exactly the bytes the IRS reads. A wrong TCC, EIN, or
  // contact field at the wrong byte will reject the entire submission
  // before the IRS ever opens an A or B record, so each field gets an
  // explicit assertion against a realistic transmitter config.
  const richTransmitter: FireTransmitterInfo = {
    tcc: "1A2B3",
    ein: "123456789",
    name: "VNDRLY INC",
    name2: "DBA Field Ops",
    companyName: "VNDRLY HOLDINGS",
    mailingAddress: "100 Big Ave",
    city: "Houston",
    state: "TX",
    zip: "770010000",
    contactName: "Tax Ops",
    contactPhone: "5550001111",
    contactEmail: "tax@vndrly.example",
    testFile: false,
  };

  function tRecord(
    overrides: Partial<FireTransmitterInfo> = {},
    taxYear = 2026,
  ): string {
    const buf = renderFireFile({
      transmitter: { ...richTransmitter, ...overrides },
      formType: "NEC",
      taxYear,
      payers: [],
    });
    return buf.toString("ascii").split("\r\n")[0];
  }

  it("places every transmitter field at its IRS Pub 1220 byte position", () => {
    const t = tRecord();
    expect(t.length).toBe(FIRE_RECORD_LENGTH);
    // pos 1: record type
    expect(t.slice(0, 1)).toBe("T");
    // pos 2-5: payment year
    expect(t.slice(1, 5)).toBe("2026");
    // pos 6: prior-year indicator (blank for current-year filings)
    expect(t.slice(5, 6)).toBe(" ");
    // pos 7-15: transmitter TIN (EIN), 9 digits, no separators
    expect(t.slice(6, 15)).toBe("123456789");
    // pos 16-20: TCC (5 chars). sanitize() upper-cases; alphanumeric TCCs
    // are valid per IRS so this also proves we don't strip letters.
    expect(t.slice(15, 20)).toBe("1A2B3");
    // pos 21-27: 7 reserved blanks
    expect(t.slice(20, 27)).toBe(" ".repeat(7));
    // pos 28: test-file indicator (blank when production)
    expect(t.slice(27, 28)).toBe(" ");
    // pos 29: foreign-entity indicator (blank — domestic transmitter)
    expect(t.slice(28, 29)).toBe(" ");
    // pos 30-69: transmitter name (40 chars, ASCII-uppercased, padded)
    expect(t.slice(29, 69)).toBe("VNDRLY INC".padEnd(40, " "));
    // pos 70-109: transmitter name continuation
    expect(t.slice(69, 109)).toBe("DBA FIELD OPS".padEnd(40, " "));
    // pos 110-149: company name (separate field — distinct from transmitter
    // name even when they happen to be the same legal entity)
    expect(t.slice(109, 149)).toBe("VNDRLY HOLDINGS".padEnd(40, " "));
    // pos 150-189: company name 2 (blank — we don't expose a second line)
    expect(t.slice(149, 189)).toBe(" ".repeat(40));
    // pos 190-229: mailing address
    expect(t.slice(189, 229)).toBe("100 BIG AVE".padEnd(40, " "));
    // pos 230-269: city
    expect(t.slice(229, 269)).toBe("HOUSTON".padEnd(40, " "));
    // pos 270-271: state (exactly 2 upper-case letters)
    expect(t.slice(269, 271)).toBe("TX");
    // pos 272-280: ZIP — 9 digits, trailing zeros for ZIP+4 padding
    expect(t.slice(271, 280)).toBe("770010000");
    // pos 281-288: total payees on file. Always zero on the T record;
    // populated on the F record at end-of-file.
    expect(t.slice(280, 288)).toBe("00000000");
    // pos 289-328: contact name
    expect(t.slice(288, 328)).toBe("TAX OPS".padEnd(40, " "));
    // pos 329-343: contact phone (15 chars, no separators required)
    expect(t.slice(328, 343)).toBe("5550001111".padEnd(15, " "));
    // pos 344-393: contact email (50 chars, sanitize() upper-cases ASCII)
    expect(t.slice(343, 393)).toBe("TAX@VNDRLY.EXAMPLE".padEnd(50, " "));
    // pos 394-484: 91 reserved blanks
    expect(t.slice(393, 484)).toBe(" ".repeat(91));
    // pos 485-492: record sequence number — T is always the first record
    expect(t.slice(484, 492)).toBe("00000001");
    // pos 503: vendor indicator (blank when not a software vendor)
    expect(t.slice(502, 503)).toBe(" ");
  });

  it("flips the test-file byte to 'T' and the vendor byte to 'V' when toggled", () => {
    const t = tRecord({ testFile: true, isVendor: true });
    // pos 28: testFile=true → "T"
    expect(t.slice(27, 28)).toBe("T");
    // pos 503: isVendor=true → "V"
    expect(t.slice(502, 503)).toBe("V");
  });

  it("normalizes a short EIN/ZIP and a lowercase state into spec width", () => {
    // A typo'd config (e.g. EIN missing the leading zero, ZIP without the
    // +4) must not silently leave the field short — the IRS would either
    // reject the file or, worse, mis-index the surrounding fields.
    const t = tRecord({ ein: "12-345", zip: "77001", state: "tx" });
    // EIN: normalizeTin strips '-' (→ "12345") then left-pads with zeros.
    expect(t.slice(6, 15)).toBe("000012345");
    expect(t.slice(269, 271)).toBe("TX");
    expect(t.slice(271, 280)).toBe("770010000");
  });
});

describe("renderFireFile — A record amount indicators", () => {
  // The 16-character "Amount Indicators" string on the A record tells the
  // IRS which Payment Amount slots on each B record carry meaningful
  // values for the chosen form. A typo here would either mask real
  // amounts (IRS sees blanks) or invent ones that aren't there. The
  // type-of-return code (positions 27-28) lives on the same record and
  // is asserted alongside, since a swap of the two would be just as bad.
  const transmitterMin: FireTransmitterInfo = transmitter;
  const minPayer = {
    ein: "987654321",
    name: "Issuer",
    mailingAddress: "1 St",
    city: "City",
    state: "TX",
    zip: "770010000",
  };

  function aRecord(
    formType: "NEC" | "MISC" | "K",
    overrides?: Partial<FireBPayee>,
  ): string {
    const samplePayee: FireBPayee = {
      ...payee,
      amounts:
        formType === "NEC"
          ? { "1": "1500.00" }
          : formType === "MISC"
            ? { "1": "1500.00" }
            : { "1A": "5000.00" },
      ...overrides,
    };
    const buf = renderFireFile({
      transmitter: transmitterMin,
      formType,
      taxYear: 2026,
      payers: [{ payer: minPayer, payees: [samplePayee] }],
    });
    const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
    const a = lines.find((l) => l[0] === "A");
    if (!a) throw new Error("no A record emitted");
    return a;
  }

  it("emits NEC type-of-return 'NE' with amount indicator at slot 1 only", () => {
    const a = aRecord("NEC");
    // pos 27-28: type of return — "NE" for 1099-NEC.
    expect(a.slice(26, 28)).toBe("NE");
    // pos 29-44: 16-char amount-indicator mask. Box 1 (NEC) only.
    expect(a.slice(28, 44)).toBe("1000000000000000");
  });

  it("emits MISC type-of-return 'A ' with indicators at boxes 1, 2, 3, 6, 10", () => {
    const a = aRecord("MISC");
    // pos 27-28: type of return — "A " (with trailing space) for 1099-MISC.
    expect(a.slice(26, 28)).toBe("A ");
    // Indicators '1' at positions 0,1,2 (boxes 1,2,3), 5 (box 6), 9 (box 10).
    // Any change to which boxes the renderer fills must be matched here.
    expect(a.slice(28, 44)).toBe("1110010001000000");
  });

  it("emits K type-of-return 'MC' with the Box 1A amount indicator", () => {
    const a = aRecord("K");
    // pos 27-28: type of return — "MC" for 1099-K.
    expect(a.slice(26, 28)).toBe("MC");
    // No monthly breakouts → only Box 1A (slot 0) is flagged.
    expect(a.slice(28, 44)).toBe("1000000000000000");
  });

  it("indicator mask matches populated B-record amount slots on every form", () => {
    // Guard against silent A/B drift: per Pub 1220 §7, the 16-char A-record
    // amount-indicator mask must have a '1' at exactly the slots where the
    // following B record actually populates a payment-amount field. If the
    // renderer ever fills a new box without enabling its bit (or vice versa)
    // the IRS will silently drop or invent amounts. A hand-written test
    // exists per form for the headline cases — this guard walks every form
    // with a representative payee so any future drift fails CI on every form
    // automatically, not just the one someone remembered to test.
    //
    // B-record payment-amount fields live at positions 55-198 (1-indexed):
    // 12 fields × 12 chars each, right-justified zero-padded cents. The
    // 16-char indicator mask covers amount codes 1-9 + A,B,C,D,E,F,G; only
    // the first 12 slots have a corresponding B-record amount field, so
    // slots 12-15 must always be '0'.
    const B_AMOUNT_START = 54; // 0-indexed start of pos 55
    const B_AMOUNT_WIDTH = 12;
    const B_AMOUNT_COUNT = 12;
    const cases: Array<{
      formType: "NEC" | "MISC" | "K";
      payeeOverride: Partial<FireBPayee>;
    }> = [
      {
        formType: "NEC",
        payeeOverride: { amounts: { "1": "1500.00" } },
      },
      {
        formType: "MISC",
        // Populate every box the MISC renderer knows how to fill — that
        // way each '1' in the mask gets a corresponding non-zero B-record
        // slot, and the bidirectional invariant has something to verify.
        payeeOverride: {
          amounts: {
            "1": "1000.00",
            "2": "200.00",
            "3": "50.00",
            "6": "75.00",
            "10": "300.00",
          },
        },
      },
      {
        formType: "K",
        // Gross + all 12 monthly amounts populated. Jan–Aug land in the
        // standard mask; Sep–Dec live in the K-extension area and don't
        // get bits in the 16-char mask (and are checked elsewhere).
        payeeOverride: {
          amounts: { "1A": "12000.00" },
          monthlyAmounts: Array(12).fill("1000.00"),
          numberOfTransactions: 12,
        },
      },
    ];

    for (const { formType, payeeOverride } of cases) {
      const samplePayee: FireBPayee = { ...payee, ...payeeOverride };
      const buf = renderFireFile({
        transmitter: transmitterMin,
        formType,
        taxYear: 2026,
        payers: [{ payer: minPayer, payees: [samplePayee] }],
      });
      const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
      const a = lines.find((l) => l[0] === "A");
      const b = lines.find((l) => l[0] === "B");
      if (!a || !b) throw new Error(`${formType}: missing A or B record`);
      const mask = a.slice(28, 44);
      expect(mask, `${formType} mask wrong length`).toHaveLength(16);

      for (let i = 0; i < 16; i++) {
        let bAmountField = "";
        let actualBitFromB: "0" | "1";
        if (i < B_AMOUNT_COUNT) {
          bAmountField = b.slice(
            B_AMOUNT_START + i * B_AMOUNT_WIDTH,
            B_AMOUNT_START + (i + 1) * B_AMOUNT_WIDTH,
          );
          // Field is zero-padded cents; Number() of "000000000000" is 0.
          actualBitFromB = Number(bAmountField) > 0 ? "1" : "0";
        } else {
          // No B-record amount slot exists for indicator positions 12-15
          // (amount codes D, E, F, G), so the indicator must be '0'.
          actualBitFromB = "0";
        }
        expect(
          mask[i],
          `${formType} slot ${i}: indicator='${mask[i]}' but B-record amount field='${bAmountField || "<no slot>"}'`,
        ).toBe(actualBitFromB);
      }
    }
  });

  it("flags every Jan–Aug monthly box on K when monthlyAmounts is populated", () => {
    // When the renderer writes Jan–Aug monthly amounts into payment-amount
    // slots 4–11 (amount codes 5..9 + A,B,C), the A-record indicator mask
    // must turn those bits on too — otherwise the IRS treats the slots as
    // empty and the monthly breakout disappears from the submission. Sep–
    // Dec live in the K-extension area, not in the 16-char standard mask,
    // so they don't get bits here.
    const a = aRecord("K", {
      amounts: { "1A": "12000.00" },
      monthlyAmounts: [
        "1000.00", "1000.00", "1000.00", "1000.00",
        "1000.00", "1000.00", "1000.00", "1000.00",
        "1000.00", "1000.00", "1000.00", "1000.00",
      ],
      numberOfTransactions: 12,
    });
    expect(a.slice(26, 28)).toBe("MC");
    expect(a.slice(28, 44)).toBe("1000111111110000");
  });
});

describe("renderFireFile — 1099-K extension totals (B/C drift guard)", () => {
  // The standard A/B drift guard above covers the 16-slot amount-indicator
  // mask, which protects most 1099-NEC/MISC/K boxes. But 1099-K has form-
  // specific extension fields living outside the standard mask: September
  // through December monthly totals, plus the payment-transaction count.
  // Those sit at fixed byte offsets in the B record (positions 547–606,
  // 12 chars each) and have matching totals in the C record (positions
  // 540–629, 18 chars each). There is no IRS header bit to cross-check
  // them, but the per-payer C-record totals must equal the sum of the
  // per-payee B-record extension fields — otherwise the IRS sees a payer-
  // summary mismatch and rejects the file. If the B-extension layout ever
  // drifts apart from the C-extension layout (or someone tweaks one
  // without the other), this test fails on every form-K render in CI.
  const transmitterMin: FireTransmitterInfo = transmitter;
  const minPayer = {
    ein: "987654321",
    name: "Issuer",
    mailingAddress: "1 St",
    city: "City",
    state: "TX",
    zip: "770010000",
  };

  // 0-indexed slice ranges for the K-extension fields. Sourced from the
  // K_B_EXT_START / K_C_EXT_START constants in fire.ts; if those move, the
  // expected slice ranges here must move with them or the test will fail —
  // which is exactly the drift signal we want.
  const B_EXT_FIELDS = [
    { name: "sep", start: 546, end: 558 },
    { name: "oct", start: 558, end: 570 },
    { name: "nov", start: 570, end: 582 },
    { name: "dec", start: 582, end: 594 },
    { name: "txnCount", start: 594, end: 606 },
  ] as const;
  const C_EXT_FIELDS = [
    { name: "sep", start: 539, end: 557 },
    { name: "oct", start: 557, end: 575 },
    { name: "nov", start: 575, end: 593 },
    { name: "dec", start: 593, end: 611 },
    { name: "txnCount", start: 611, end: 629 },
  ] as const;

  it("each C-record Sep–Dec/txn total equals sum of B-record extension fields", () => {
    // Three payees with deliberately distinct Sep–Dec amounts and txn
    // counts so a swap between adjacent fields (e.g. Sep ↔ Oct) would
    // change every total and fail the assertion, not silently cancel
    // out. Jan–Aug values vary too, but those flow through the standard-
    // mask path and are covered by the other drift guard.
    const payees: FireBPayee[] = [
      {
        ...payee,
        tin: "111223333",
        name: "Acme Drilling LLC",
        amounts: { "1A": "12000.00" },
        monthlyAmounts: [
          "100.00", "200.00", "300.00", "400.00",
          "500.00", "600.00", "700.00", "800.00",
          "900.11", "1000.22", "1100.33", "1200.44",
        ],
        numberOfTransactions: 17,
      },
      {
        ...payee,
        tin: "222334444",
        name: "Beta Services Inc",
        amounts: { "1A": "9500.50" },
        monthlyAmounts: [
          "50.00", "60.00", "70.00", "80.00",
          "90.00", "100.00", "110.00", "120.00",
          "131.55", "142.66", "153.77", "164.88",
        ],
        numberOfTransactions: 9,
      },
      {
        ...payee,
        tin: "333445555",
        name: "Gamma Logistics LP",
        amounts: { "1A": "7777.77" },
        monthlyAmounts: [
          "11.11", "22.22", "33.33", "44.44",
          "55.55", "66.66", "77.77", "88.88",
          "99.99", "111.11", "122.22", "133.33",
        ],
        numberOfTransactions: 23,
      },
    ];

    const buf = renderFireFile({
      transmitter: transmitterMin,
      formType: "K",
      taxYear: 2026,
      payers: [{ payer: minPayer, payees }],
    });
    const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
    const bRecords = lines.filter((l) => l[0] === "B");
    const cRecord = lines.find((l) => l[0] === "C");
    expect(bRecords, "expected one B record per payee").toHaveLength(
      payees.length,
    );
    if (!cRecord) throw new Error("no C record emitted");

    // For each of the five extension fields, sum the per-B-record values
    // at the documented byte range and compare to the per-C-record total
    // at its own (wider) byte range. Both fields are zero-padded integer
    // strings — the B-fields hold cents for amounts and a raw integer
    // for the txn count, and the C-field holds the same units in a
    // wider 18-char column, so a numeric Number() comparison is clean.
    for (let i = 0; i < B_EXT_FIELDS.length; i++) {
      const bField = B_EXT_FIELDS[i];
      const cField = C_EXT_FIELDS[i];
      expect(
        bField.name,
        "B/C extension fields must line up by name",
      ).toBe(cField.name);

      let bSum = 0;
      for (const b of bRecords) {
        const slice = b.slice(bField.start, bField.end);
        expect(
          slice,
          `B ${bField.name} field wrong width`,
        ).toHaveLength(bField.end - bField.start);
        // All-digits, zero-padded — anything else means a layout shift
        // pushed a non-numeric byte into this slot.
        expect(
          /^\d+$/.test(slice),
          `B ${bField.name} field is not all digits: '${slice}'`,
        ).toBe(true);
        bSum += Number(slice);
      }

      const cSlice = cRecord.slice(cField.start, cField.end);
      expect(
        cSlice,
        `C ${cField.name} field wrong width`,
      ).toHaveLength(cField.end - cField.start);
      expect(
        /^\d+$/.test(cSlice),
        `C ${cField.name} field is not all digits: '${cSlice}'`,
      ).toBe(true);
      const cTotal = Number(cSlice);

      expect(
        cTotal,
        `${cField.name}: C-record total ${cTotal} != sum of B-record fields ${bSum}`,
      ).toBe(bSum);
      // Sanity check: with the deliberately distinct per-payee values
      // above, every extension total should be non-zero. A zero here
      // means the renderer wrote blank/zero into both sides, which the
      // equality check would otherwise pass trivially.
      expect(
        cTotal,
        `${cField.name}: total unexpectedly zero — fixture should populate this field`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("FIRE adapters", () => {
  it("necRowsToPayees maps a NEC row to a B-record payee", () => {
    const out = necRowsToPayees([
      {
        vendorId: 1,
        vendorName: "Acme",
        federalTaxId: "12-3456789",
        vendorAddress: "1 Main St, Midland, TX 79701",
        payerPartnerId: 10,
        payerPartnerName: "Energy",
        payerEin: "98-7654321",
        payerAddress: "100 Big Ave, Houston, TX 77001",
        totalPaid: "1500.00",
        sharedEinWarning: false,
      },
    ]);
    expect(out).toHaveLength(1);
    // Adapters pass the raw EIN through; FIRE B-record encoder normalizes.
    expect(out[0].tin).toBe("12-3456789");
    expect(out[0].amounts["1"]).toBe("1500.00");
  });

  it("kRowsToPayees populates monthly amounts and txn count", () => {
    const out = kRowsToPayees([
      {
        vendorId: 1,
        vendorName: "Acme",
        federalTaxId: "12-3456789",
        vendorAddress: "1 Main St, Midland, TX 79701",
        payerPartnerId: 10,
        payerPartnerName: "TPSO",
        payerEin: "98-7654321",
        payerAddress: "100 Big Ave, Houston, TX 77001",
        grossAmount: "5000.00",
        transactionCount: 24,
        monthly: Array(12).fill("416.67"),
        crossedAtMonthIdx: 1,
        sharedEinWarning: false,
      },
    ]);
    expect(out[0].numberOfTransactions).toBe(24);
    expect(out[0].monthlyAmounts).toHaveLength(12);
    expect(out[0].amounts["1A"]).toBeDefined();
  });

  // Pub 1220 §F.5: a corrected return is signaled by a single character
  // at A-record position 7 ("G" = one-step, "C" = two-step) and an
  // identical character at B-record position 6. Every B record under
  // an A must share the same indicator — buildFirePayload guarantees
  // that by emitting one A block per indicator bucket, so here we just
  // verify the field placement when an indicator is supplied.
  it("writes the corrected-return indicator at A-pos-7 and B-pos-6", () => {
    for (const ind of ["G", "C"] as const) {
      const buf = renderFireFile({
        transmitter,
        formType: "NEC",
        taxYear: 2026,
        payers: [
          {
            payer: {
              ein: "987654321",
              name: "Energy Corp",
              mailingAddress: "200 Big Ave",
              city: "Houston",
              state: "TX",
              zip: "770010000",
            },
            correctionIndicator: ind,
            payees: [{ ...payee, correctionIndicator: ind }],
          },
        ],
      });
      const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
      const a = lines.find((l) => l[0] === "A")!;
      const b = lines.find((l) => l[0] === "B")!;
      // 1-indexed positions per Pub 1220.
      expect(a[6]).toBe(ind); // A position 7
      expect(b[5]).toBe(ind); // B position 6
    }
  });

  // Pub 1220 §F.5: a two-step ("C") correction must be transmitted as
  // *two* B records inside the same A block — first a zero-dollar back-
  // out copy of the *original* payee identifiers, then the corrected B
  // record carrying the new identifiers and the new amounts. The
  // back-out tells the IRS "delete what we filed last time", and the
  // corrected record then lands fresh. If we ever emit only one of
  // the two, or in the wrong order, or with non-zero amounts on the
  // back-out, the IRS will either double-count, leave the bad record
  // in place, or reject the file. Each invariant is explicitly
  // asserted below so a regression in any one fails CI loudly.
  it("emits a zero-dollar back-out B before the corrected B for two-step C corrections", () => {
    // Original payee block as it would have been snapshotted at filing
    // time: full TIN/name/address/amount. The "corrected" payee in the
    // current export uses a *different* TIN and name (which is the
    // whole point of a two-step correction) plus a different amount —
    // that way the back-out record is clearly distinguishable from the
    // corrected record by content, not just by amount value.
    const originalSnapshot: FireBPayee = {
      tin: "111223333",
      tinType: "1",
      name: "Acme Drilling LLC",
      mailingAddress: "1 Main St",
      city: "Midland",
      state: "TX",
      zip: "797010000",
      amounts: { "1": "1500.00" },
      correctionIndicator: "C",
    };
    const backOut: FireBPayee = {
      ...originalSnapshot,
      // Zero-dollar back-out: identifiers verbatim, every amount slot
      // wiped to "0" so the C-record total only reflects the new
      // (corrected) amount and not double-counts the old one.
      amounts: { "1": "0" },
    };
    const corrected: FireBPayee = {
      tin: "999887777",
      tinType: "1",
      name: "Acme Drilling Inc",
      mailingAddress: "1 Main St",
      city: "Midland",
      state: "TX",
      zip: "797010000",
      amounts: { "1": "2000.00" },
      correctionIndicator: "C",
    };

    const buf = renderFireFile({
      transmitter,
      formType: "NEC",
      taxYear: 2026,
      payers: [
        {
          payer: {
            ein: "987654321",
            name: "Energy Corp",
            mailingAddress: "200 Big Ave",
            city: "Houston",
            state: "TX",
            zip: "770010000",
          },
          correctionIndicator: "C",
          payees: [backOut, corrected],
        },
      ],
    });
    const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
    // T, A, B(back-out), B(corrected), C, F → 6 lines.
    expect(lines).toHaveLength(6);
    const aRecords = lines.filter((l) => l[0] === "A");
    const bRecords = lines.filter((l) => l[0] === "B");
    const cRecord = lines.find((l) => l[0] === "C");
    expect(aRecords).toHaveLength(1);
    expect(bRecords).toHaveLength(2);
    if (!cRecord) throw new Error("no C record emitted");

    // Both B records must sit under the same A block with the "C"
    // indicator at A position 7 and B position 6 — the IRS rejects a
    // file that mixes original and corrected B records under one A.
    expect(aRecords[0][6]).toBe("C");
    expect(bRecords[0][5]).toBe("C");
    expect(bRecords[1][5]).toBe("C");

    // Back-out record comes first and carries the *original* TIN with
    // a zero-dollar Box 1 amount. TIN sits at B positions 12-20
    // (0-indexed slice 11..20). Box 1 NEC amount sits at the first
    // 12-char payment-amount slot starting at position 55 (0-indexed
    // 54..66). Zero-padded cents → "000000000000".
    expect(bRecords[0].slice(11, 20)).toBe("111223333");
    expect(bRecords[0].slice(54, 66)).toBe("000000000000");

    // Corrected record comes second with the *new* TIN and the new
    // amount in cents ($2000.00 → 200000 → "000000200000").
    expect(bRecords[1].slice(11, 20)).toBe("999887777");
    expect(bRecords[1].slice(54, 66)).toBe("000000200000");

    // C-record total for amount slot 1 (Box 1 NEC) sits at positions
    // 16..33 (0-indexed 15..33), 18 chars wide. It must equal
    // back-out (0) + corrected (200000) = 200000 cents — proof that
    // the back-out really is zero-dollar and isn't silently inflating
    // the per-payer total.
    const slot1Total = cRecord.slice(15, 33);
    expect(slot1Total).toBe("000000200000".padStart(18, "0"));
    expect(Number(slot1Total)).toBe(200000);
  });

  it("leaves the corrected indicator blank for original returns", () => {
    const buf = renderFireFile({
      transmitter,
      formType: "NEC",
      taxYear: 2026,
      payers: [
        {
          payer: {
            ein: "987654321",
            name: "Energy Corp",
            mailingAddress: "200 Big Ave",
            city: "Houston",
            state: "TX",
            zip: "770010000",
          },
          payees: [payee],
        },
      ],
    });
    const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
    const a = lines.find((l) => l[0] === "A")!;
    const b = lines.find((l) => l[0] === "B")!;
    expect(a[6]).toBe(" ");
    expect(b[5]).toBe(" ");
  });

  // Pub 1220 §F.5 — coverage for the route-level bucketing logic that
  // sits between the dashboard's filing rows and the FIRE renderer.
  // `buildFirePayload` in `routes/reports.ts` (a) loads
  // `correctedStatus` + `originalPayeeSnapshot` for every (partner,
  // vendor, form, year), then (b) calls
  // `bucketFirePayeesByCorrection` to split payees into the three
  // A-block buckets. Step (a) is a thin DB read; step (b) is the
  // business logic that has to get the back-out-then-corrected order
  // right under the "C" bucket. We test (b) directly here so the C
  // flow is exercised end-to-end through the renderer without
  // requiring a DB.
  describe("bucketFirePayeesByCorrection (Pub 1220 §F.5 C-flow)", () => {
    const originalSnap: FirePayeeSnapshotLike = {
      tin: "111223333",
      tinType: "1",
      name: "Acme Drilling LLC",
      mailingAddress: "1 Main St",
      city: "Midland",
      state: "TX",
      zip: "797010000",
      amounts: { "1": "1500.00" },
    };
    const correctedPayee: FireBPayee = {
      tin: "999887777",
      tinType: "1",
      name: "Acme Drilling Inc",
      mailingAddress: "1 Main St",
      city: "Midland",
      state: "TX",
      zip: "797010000",
      amounts: { "1": "2000.00" },
    };
    const originalPayee: FireBPayee = {
      tin: "222334444",
      tinType: "1",
      name: "Beta Hauling LLC",
      mailingAddress: "2 Elm St",
      city: "Odessa",
      state: "TX",
      zip: "797600000",
      amounts: { "1": "800.00" },
    };

    it("places vendors with correctedStatus='c' + snapshot into the C bucket as [back-out, corrected]", () => {
      const buckets = bucketFirePayeesByCorrection({
        payees: [originalPayee, correctedPayee],
        vendorIds: [10, 20],
        corrByVendor: new Map<number, FireCorrectionIndicator>([[20, "C"]]),
        snapshotByVendor: new Map([[20, originalSnap]]),
      });
      expect(buckets[" "]).toHaveLength(1);
      expect(buckets[" "][0].tin).toBe("222334444");
      expect(buckets.G).toHaveLength(0);
      expect(buckets.C).toHaveLength(2);
      // Back-out first: original TIN, every amount slot zeroed.
      expect(buckets.C[0].tin).toBe(originalSnap.tin);
      expect(buckets.C[0].amounts["1"]).toBe("0");
      expect(buckets.C[0].correctionIndicator).toBe("C");
      // Corrected second: new TIN, new amount, "C" indicator.
      expect(buckets.C[1].tin).toBe(correctedPayee.tin);
      expect(buckets.C[1].amounts["1"]).toBe("2000.00");
      expect(buckets.C[1].correctionIndicator).toBe("C");
    });

    it("end-to-end: rendered FIRE file emits back-out then corrected B under one 'C' A block", () => {
      const buckets = bucketFirePayeesByCorrection({
        payees: [correctedPayee],
        vendorIds: [20],
        corrByVendor: new Map<number, FireCorrectionIndicator>([[20, "C"]]),
        snapshotByVendor: new Map([[20, originalSnap]]),
      });
      const buf = renderFireFile({
        transmitter,
        formType: "NEC",
        taxYear: 2026,
        payers: [
          {
            payer: {
              ein: "987654321",
              name: "Energy Corp",
              mailingAddress: "200 Big Ave",
              city: "Houston",
              state: "TX",
              zip: "770010000",
            },
            correctionIndicator: "C",
            payees: buckets.C,
          },
        ],
      });
      const lines = buf.toString("ascii").split("\r\n").filter(Boolean);
      const aRecords = lines.filter((l) => l[0] === "A");
      const bRecords = lines.filter((l) => l[0] === "B");
      const cRecord = lines.find((l) => l[0] === "C")!;
      expect(aRecords).toHaveLength(1);
      expect(aRecords[0][6]).toBe("C");
      expect(bRecords).toHaveLength(2);
      // First B = back-out: original TIN, zero Box-1 amount.
      expect(bRecords[0][5]).toBe("C");
      expect(bRecords[0].slice(11, 20)).toBe("111223333");
      expect(bRecords[0].slice(54, 66)).toBe("000000000000");
      // Second B = corrected: new TIN, new amount.
      expect(bRecords[1][5]).toBe("C");
      expect(bRecords[1].slice(11, 20)).toBe("999887777");
      expect(bRecords[1].slice(54, 66)).toBe("000000200000");
      // C-record per-payer total reflects only the corrected amount.
      expect(Number(cRecord.slice(15, 33))).toBe(200000);
    });

    it("falls back to corrected-only when a 'c' row has no snapshot (legacy rows pre-snapshot column)", () => {
      const buckets = bucketFirePayeesByCorrection({
        payees: [correctedPayee],
        vendorIds: [20],
        corrByVendor: new Map<number, FireCorrectionIndicator>([[20, "C"]]),
        snapshotByVendor: new Map(),
      });
      expect(buckets.C).toHaveLength(1);
      expect(buckets.C[0].tin).toBe(correctedPayee.tin);
      expect(buckets.C[0].correctionIndicator).toBe("C");
    });

    it("routes 'g' (one-step) to the G bucket without any back-out record", () => {
      const buckets = bucketFirePayeesByCorrection({
        payees: [correctedPayee],
        vendorIds: [20],
        corrByVendor: new Map<number, FireCorrectionIndicator>([[20, "G"]]),
        snapshotByVendor: new Map([[20, originalSnap]]),
      });
      expect(buckets.G).toHaveLength(1);
      expect(buckets.G[0].correctionIndicator).toBe("G");
      expect(buckets.C).toHaveLength(0);
    });

    it("snapshotToZeroDollarPayee zeros K monthly amounts + txn count while preserving identifiers", () => {
      const kSnap: FirePayeeSnapshotLike = {
        ...originalSnap,
        amounts: { "1A": "12000.00" },
        numberOfTransactions: 47,
        monthlyAmounts: ["1000.00", "1000.00", "1000.00", "1000.00",
          "1000.00", "1000.00", "1000.00", "1000.00",
          "1000.00", "1000.00", "1000.00", "1000.00"],
      };
      const back = snapshotToZeroDollarPayee(kSnap);
      expect(back.tin).toBe(kSnap.tin);
      expect(back.amounts["1A"]).toBe("0");
      expect(back.numberOfTransactions).toBe(0);
      expect(back.monthlyAmounts).toEqual(Array(12).fill("0"));
      expect(back.correctionIndicator).toBe("C");
    });
  });

  it("miscRowsToPayees maps non-zero boxes only", () => {
    const out = miscRowsToPayees([
      {
        vendorId: 1,
        vendorName: "Acme",
        federalTaxId: "12-3456789",
        vendorAddress: "1 Main St, Midland, TX 79701",
        payerPartnerId: 10,
        payerPartnerName: "Energy",
        payerEin: "98-7654321",
        payerAddress: "100 Big Ave, Houston, TX 77001",
        box1Rents: "1000.00",
        box2Royalties: "0.00",
        box3OtherIncome: "0.00",
        box3PrizesAwards: "0.00",
        box6MedicalHealth: "0.00",
        box10Attorney: "0.00",
        totalReportable: "1000.00",
        sharedEinWarning: false,
      },
    ]);
    expect(out[0].amounts["1"]).toBeDefined();
  });
});
