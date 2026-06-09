/**
 * Give every active field employee EVERY certification name known in the
 * system (work types + catalog + any name ever used in employee_certifications).
 *
 * All expiration dates are in the future so schedule checks pass; dates and
 * cert numbers are still varied per employee.
 *
 * Optional: set SEED_CERTS_VENDOR=Winchester to limit to one vendor.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-winchester-certifications.ts
 */

import { and, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import {

  db,

  employeeCertificationsTable,

  fieldEmployeesTable,

  vendorsTable,

  workTypesTable,

} from "@workspace/db";



const VENDOR_FILTER = process.env.SEED_CERTS_VENDOR?.trim() || null;



const ISSUERS: Record<string, string> = {

  PEC: "PEC Safety",

  "Pump Mechanic": "NCCER",

  "Field Mechanic": "NCCER",

  "H2S Awareness": "PEC Safety",

  "Cementing Tech": "API",

  "OSHA 10": "OSHA Outreach",

  "H2S Clear": "PEC Safety",

  "Excavating Tech": "NCCER",

};



function pad(n: number, len = 6) {

  return String(n).padStart(len, "0");

}



function randomInt(min: number, max: number) {

  return Math.floor(Math.random() * (max - min + 1)) + min;

}



function addDays(base: Date, days: number) {

  const d = new Date(base);

  d.setUTCDate(d.getUTCDate() + days);

  return d;

}



function toDateString(d: Date) {

  return d.toISOString().slice(0, 10);

}



function certNumberFor(name: string, employeeId: number, index: number) {

  const slug = name.replace(/[^A-Za-z0-9]+/g, "").slice(0, 4).toUpperCase() || "CERT";

  const year = 2024 + randomInt(0, 2);

  const serial = pad(employeeId * 97 + index * 13 + randomInt(100, 9999), 5);

  return `${slug}-${year}-${serial}`;

}



/** Future expirations only — varied from 45 days to ~3 years. */

function expirationDateFor(index: number) {

  const today = new Date();

  today.setUTCHours(0, 0, 0, 0);

  const bucket = index % 4;

  if (bucket === 0) return toDateString(addDays(today, randomInt(45, 90)));

  if (bucket === 1) return toDateString(addDays(today, randomInt(120, 365)));

  if (bucket === 2) return toDateString(addDays(today, randomInt(366, 730)));

  return toDateString(addDays(today, randomInt(731, 1095)));

}



function issuedDateFor(expiration: string) {

  const exp = new Date(`${expiration}T00:00:00Z`);

  const yearsValid = randomInt(1, 3);

  const issued = new Date(exp);

  issued.setUTCFullYear(issued.getUTCFullYear() - yearsValid);

  issued.setUTCDate(issued.getUTCDate() - randomInt(0, 90));

  return toDateString(issued);

}



async function collectAllCertificationNames(): Promise<string[]> {

  const workTypes = await db

    .select({

      requiredCertifications: workTypesTable.requiredCertifications,

      blockingCertifications: workTypesTable.blockingCertifications,

    })

    .from(workTypesTable);



  const names = new Set<string>([

    "PEC",

    "Pump Mechanic",

    "Field Mechanic",

    "H2S Awareness",

    "H2S Clear",

    "Cementing Tech",

    "OSHA 10",

    "Excavating Tech",

    "Drilling Operator",

    "HazWoper 40",

    "Hot Oil Operator",

    "Perforating Specialist",

    "Wellhead Tech II",

    "Wireline Operator",

  ]);



  for (const wt of workTypes) {

    for (const n of [...(wt.requiredCertifications ?? []), ...(wt.blockingCertifications ?? [])]) {

      const t = n?.trim();

      if (t) names.add(t);

    }

  }



  const existing = await db

    .select({ name: employeeCertificationsTable.name })

    .from(employeeCertificationsTable)

    .where(isNull(employeeCertificationsTable.deletedAt));

  for (const row of existing) {

    const t = row.name?.trim();

    if (t) names.add(t);

  }



  return Array.from(names).sort((a, b) => a.localeCompare(b));

}



async function main() {
  let vendorFilter: { id: number; name: string } | null = null;
  if (VENDOR_FILTER) {
    const [vendor] = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(ilike(vendorsTable.name, `%${VENDOR_FILTER}%`))
      .limit(1);
    if (!vendor) throw new Error(`Vendor "${VENDOR_FILTER}" not found`);
    vendorFilter = vendor;
  }

  const employees = await db
    .select({
      id: fieldEmployeesTable.id,
      firstName: fieldEmployeesTable.firstName,
      lastName: fieldEmployeesTable.lastName,
    })
    .from(fieldEmployeesTable)
    .where(
      vendorFilter
        ? and(
            eq(fieldEmployeesTable.vendorId, vendorFilter.id),
            isNull(fieldEmployeesTable.deletedAt),
          )
        : isNull(fieldEmployeesTable.deletedAt),
    );

  if (employees.length === 0) {
    throw new Error(
      vendorFilter
        ? `No active field employees for ${vendorFilter.name} (id ${vendorFilter.id})`
        : "No active field employees found",
    );
  }



  const employeeIds = employees.map((e) => e.id);

  const certNames = await collectAllCertificationNames();



  const cleared = await db

    .update(employeeCertificationsTable)

    .set({

      deletedAt: sql`now()`,

      deletedBy: "seed-winchester-certifications",

    })

    .where(

      and(

        inArray(employeeCertificationsTable.employeeId, employeeIds),

        isNull(employeeCertificationsTable.deletedAt),

      ),

    )

    .returning({ id: employeeCertificationsTable.id });



  const rows: Array<typeof employeeCertificationsTable.$inferInsert> = [];

  const pecByEmployee = new Map<number, string>();



  for (const emp of employees) {

    certNames.forEach((name, idx) => {

      const expirationDate = expirationDateFor(emp.id + idx);

      if (name === "PEC") {

        pecByEmployee.set(emp.id, expirationDate);

      }

      rows.push({

        employeeId: emp.id,

        name,

        issuer: ISSUERS[name] ?? "VNDRLY Seed",

        certNumber: certNumberFor(name, emp.id, idx),

        issuedDate: issuedDateFor(expirationDate),

        expirationDate,

        vendorVerifiedAt: new Date(),

      });

    });

  }



  const BATCH = 100;

  for (let i = 0; i < rows.length; i += BATCH) {

    await db.insert(employeeCertificationsTable).values(rows.slice(i, i + BATCH));

  }



  for (const emp of employees) {

    const pecExp = pecByEmployee.get(emp.id);

    if (!pecExp) continue;

    await db

      .update(fieldEmployeesTable)

      .set({

        pecExpirationDate: pecExp,

        pecCertification: true,

      })

      .where(eq(fieldEmployeesTable.id, emp.id));

  }



  const scope = vendorFilter ? vendorFilter.name : "all vendors";
  console.log(
    `${scope}: cleared ${cleared.length} old certs, inserted ${rows.length} rows (${certNames.length} cert types × ${employees.length} employees).`,
  );

  console.log("Cert types:", certNames.join(", "));

}



main()

  .then(() => process.exit(0))

  .catch((err) => {

    console.error(err);

    process.exit(1);

  });


