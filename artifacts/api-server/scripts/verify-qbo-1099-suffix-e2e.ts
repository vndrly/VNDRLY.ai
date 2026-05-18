// End-to-end verification that the `[1099: <label>]` per-line description
// suffix survives a real push into an Intuit QuickBooks Online sandbox
// company. Complements the mocked unit test in
// src/lib/accounting/qbo.test.ts ("descriptionWith1099Tag") by exercising
// the live HTTP path: it pushes a multi-line invoice with one
// `misc_attorney` and one `misc_rents` line, then reads each invoice line
// back from the QBO sandbox API and asserts the suffix is intact.
//
// Usage:
//   QBO_SANDBOX_ACCESS_TOKEN=... \
//   QBO_SANDBOX_REALM_ID=... \
//   tsx artifacts/api-server/scripts/verify-qbo-1099-suffix-e2e.ts
//
// Optional env:
//   QBO_SANDBOX_PARTNER_NAME   default "VNDRLY E2E Partner"
//   QBO_SANDBOX_INVOICE_PREFIX default "VNDRLY-E2E-"  (a timestamp is appended
//                              to keep DocNumbers unique across runs)
//
// The script exits 0 on a clean reconciliation and non-zero on any
// mismatch / push warning so it can be wired into a manual smoke step.
//
// See docs/qbo-1099-suffix-sandbox-verification.md for the runbook
// (including how to obtain a sandbox access token).

import { incomeCategoryLabel } from "@workspace/db";
import { pushBundleToQbo } from "../src/lib/accounting/qbo";
import type { QboPushBundle } from "../src/lib/accounting/qbo";

const accessToken = process.env["QBO_SANDBOX_ACCESS_TOKEN"];
const realmId = process.env["QBO_SANDBOX_REALM_ID"];
if (!accessToken || !realmId) {
  console.error(
    "Missing QBO_SANDBOX_ACCESS_TOKEN and/or QBO_SANDBOX_REALM_ID. " +
      "See docs/qbo-1099-suffix-sandbox-verification.md for how to obtain " +
      "a sandbox access token from the Intuit OAuth Playground.",
  );
  process.exit(2);
}

const partnerName =
  process.env["QBO_SANDBOX_PARTNER_NAME"] ?? "VNDRLY E2E Partner";
const invoicePrefix =
  process.env["QBO_SANDBOX_INVOICE_PREFIX"] ?? "VNDRLY-E2E-";
// QBO DocNumbers must be unique within a company; append a timestamp so
// repeated runs don't collide with each other.
const invoiceNumber = `${invoicePrefix}${Date.now()}`;

const bundle: QboPushBundle = {
  invoices: [
    {
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: null,
      total: "1750.00",
      subtotal: "1750.00",
      taxTotal: "0.00",
      memo: "1099 suffix sandbox verification",
      partnerName,
      vendorName: "VNDRLY E2E Vendor",
    },
  ],
  lines: [
    {
      invoiceNumber,
      description: "Legal review of MSA",
      amount: "750.00",
      taxAmount: "0.00",
      lineType: "Labor",
      incomeCategory: "misc_attorney",
    },
    {
      invoiceNumber,
      description: "Yard rental — March",
      amount: "1000.00",
      taxAmount: "0.00",
      lineType: "Rental",
      incomeCategory: "misc_rents",
    },
  ],
  partners: [{ name: partnerName, email: null, address: null }],
  vendors: [],
};

console.log(
  `Pushing invoice ${invoiceNumber} into QBO sandbox realm ${realmId} ...`,
);
const pushResult = await pushBundleToQbo(bundle, {
  accessToken,
  realmId,
  environment: "sandbox",
});
console.log("Push result:", JSON.stringify(pushResult, null, 2));

if (pushResult.warnings.length > 0) {
  console.error(
    `Push reported ${pushResult.warnings.length} warning(s); aborting.`,
  );
  process.exit(1);
}
if (!pushResult.invoicesPushed.includes(invoiceNumber)) {
  console.error(`Invoice ${invoiceNumber} was not reported as pushed.`);
  process.exit(1);
}

// Read the just-created invoice back from the sandbox and assert the
// per-line Description still carries `[1099: <label>]`.
const apiBase = "https://sandbox-quickbooks.api.intuit.com";
const sql = `SELECT Id, DocNumber, Line FROM Invoice WHERE DocNumber = '${invoiceNumber.replace(/'/g, "''")}'`;
const queryUrl = `${apiBase}/v3/company/${realmId}/query?minorversion=70&query=${encodeURIComponent(sql)}`;
const queryRes = await fetch(queryUrl, {
  headers: {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
});
if (!queryRes.ok) {
  console.error(
    `Read-back failed: HTTP ${queryRes.status} ${await queryRes.text()}`,
  );
  process.exit(1);
}
interface QboInvoiceLine {
  DetailType?: string;
  Description?: string;
  Amount?: number;
}
interface QboInvoice {
  Id: string;
  DocNumber?: string;
  Line?: QboInvoiceLine[];
}
const queryJson = (await queryRes.json()) as {
  QueryResponse?: { Invoice?: QboInvoice[] };
};
const remoteInvoice = queryJson.QueryResponse?.Invoice?.[0];
if (!remoteInvoice) {
  console.error(`Invoice ${invoiceNumber} not found when reading back.`);
  process.exit(1);
}
console.log(
  `Read-back invoice Id=${remoteInvoice.Id}, DocNumber=${remoteInvoice.DocNumber}`,
);

const expectedSuffixes: Record<string, string> = {
  "Legal review of MSA": `[1099: ${incomeCategoryLabel("misc_attorney")}]`,
  "Yard rental — March": `[1099: ${incomeCategoryLabel("misc_rents")}]`,
};
// Each expected line must match exactly one SalesItemLineDetail line in
// the QBO read-back. Tracking remaining matches strictly catches both
// "QBO truncated/altered the description so the prefix no longer
// matches" and "QBO dropped a line entirely" — either of which would
// silently lose the 1099 box.
const remainingExpected = new Set(Object.keys(expectedSuffixes));
let failures = 0;
const salesLines = (remoteInvoice.Line ?? []).filter(
  (l) => l.DetailType === "SalesItemLineDetail",
);

if (salesLines.length !== Object.keys(expectedSuffixes).length) {
  console.error(
    `  ✗ Expected ${Object.keys(expectedSuffixes).length} SalesItemLineDetail line(s) on the read-back invoice, ` +
      `got ${salesLines.length}. QBO may have dropped or merged lines.`,
  );
  failures += 1;
}

for (const line of salesLines) {
  const desc = line.Description ?? "";
  const matchedKey = [...remainingExpected].find((k) => desc.startsWith(k));
  if (!matchedKey) {
    console.error(
      `  ✗ Unrecognized or duplicate read-back line description: ${JSON.stringify(desc)}. ` +
        `Expected one of: ${[...remainingExpected].map((k) => JSON.stringify(k)).join(", ") || "(none remaining)"}.`,
    );
    failures += 1;
    continue;
  }
  remainingExpected.delete(matchedKey);
  const expected = expectedSuffixes[matchedKey]!;
  if (desc.includes(expected)) {
    console.log(`  ✓ ${matchedKey}: suffix preserved (${expected})`);
  } else {
    console.error(
      `  ✗ ${matchedKey}: expected suffix ${expected} not found in QBO Description ${JSON.stringify(desc)}`,
    );
    failures += 1;
  }
}

for (const missing of remainingExpected) {
  console.error(
    `  ✗ Expected line "${missing}" was not found on the read-back invoice. ` +
      `QBO appears to have dropped or renamed it.`,
  );
  failures += 1;
}

if (failures > 0) {
  console.error(
    `\n${failures} line(s) lost the [1099: ...] suffix in QuickBooks. ` +
      `If QBO has truncated or stripped the field, file a follow-up to move ` +
      `the tag onto a custom field instead of the line Description.`,
  );
  process.exit(1);
}

console.log(
  `\nAll [1099: ...] suffixes survived the sandbox round-trip for ${invoiceNumber}.`,
);
console.log(
  `Manual step: open QBO sandbox → Reports → 1099 Detail (or Vendor → ${partnerName}) ` +
    `and confirm the bracketed tags appear on each line. ` +
    `If they do NOT appear in the 1099 Detail report, log a follow-up to use ` +
    `a Custom Field instead of the line Description.`,
);
