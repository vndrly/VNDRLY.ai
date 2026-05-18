// Smoke test for the invoice generator: invokes the generator directly on a
// supplied ticket id and prints the resulting invoice + lines. Run with:
//   tsx artifacts/api-server/scripts/smoke-invoice.ts <ticketId>
import { db, invoicesTable, invoiceLinesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateInvoiceForTicket } from "../src/lib/invoice-generator";

const ticketId = Number(process.argv[2] ?? 0);
if (!ticketId) {
  console.error("Usage: tsx scripts/smoke-invoice.ts <ticketId>");
  process.exit(1);
}

const result = await generateInvoiceForTicket(ticketId);
console.log("Result:", result);

if (result.ok) {
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, result.invoiceId));
  const lines = await db
    .select()
    .from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, result.invoiceId));
  console.log("Invoice:", JSON.stringify(inv, null, 2));
  console.log(`Lines (${lines.length}):`);
  for (const l of lines) {
    console.log(
      `  [${l.lineType}] ${l.description}: qty=${l.quantity} unit=${l.unitPrice} amt=${l.amount} tax=${l.taxAmount} (override=${l.isManualOverride})`,
    );
  }
}

process.exit(0);
