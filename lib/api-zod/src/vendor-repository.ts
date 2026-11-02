import { z } from "zod/v4";
export const RepositoryAudienceSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(5000).default([]),
  groupIds: z.array(z.string().min(1)).max(100).default([]),
  roles: z.array(z.string().min(1)).max(100).default([]),
});
export const FolderGrantSchema = RepositoryAudienceSchema.extend({
  read: z.boolean().default(false),
  write: z.boolean().default(false),
  edit: z.boolean().default(false),
});
export const RepositoryFolderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  parentId: z.uuid().nullable().default(null),
  grants: z.array(FolderGrantSchema).max(100).default([]),
  category: z.string().trim().max(100).default(""),
  protected: z.boolean().default(true),
});
export const TravelAuthorizationSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    origin: z.string().trim().min(1).max(300),
    destination: z.string().trim().min(1).max(300),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    purpose: z.string().trim().min(1).max(2000),
    siteId: z.number().int().positive().nullable().default(null),
    shiftId: z.string().max(100).nullable().default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    budgetCents: z.number().int().nonnegative().max(100_000_000).default(0),
    mileageRateCents: z
      .number()
      .nonnegative()
      .max(1000)
      .nullable()
      .default(null),
    perDiemCents: z.number().int().nonnegative().max(1_000_000).default(0),
    audience: RepositoryAudienceSchema,
    templateIds: z.array(z.string()).max(50).default([]),
  })
  .refine((v) => v.endDate >= v.startDate, "End date must follow start date");
export const TravelExpenseSchema = z.object({
  kind: z.enum([
    "receipt",
    "mileage",
    "per_diem",
    "lodging",
    "transportation",
    "advance",
    "other",
  ]),
  date: z.iso.date(),
  description: z.string().trim().min(1).max(1000),
  merchant: z.string().trim().max(200).default(""),
  amountCents: z.number().int().nonnegative().max(100_000_000).optional(),
  distance: z.number().nonnegative().max(100_000).optional(),
  odometerStart: z.number().nonnegative().optional(),
  odometerEnd: z.number().nonnegative().optional(),
  documentId: z.uuid().nullable().default(null),
  receiptId: z.uuid().nullable().default(null),
  reimbursable: z.boolean().default(true),
  missingReceiptReason: z.string().max(1000).default(""),
});
export type FolderGrant = z.infer<typeof FolderGrantSchema>;
export function folderPermission(
  grants: FolderGrant[],
  person: { userId: number; groups: string[]; roles: string[] },
  permission: "read" | "write" | "edit",
) {
  return grants.some(
    (g) =>
      g[permission] &&
      (g.userIds.includes(person.userId) ||
        g.groupIds.some((id) => person.groups.includes(id)) ||
        g.roles.some((role) => person.roles.includes(role))),
  );
}
export function expenseAmount(value: {
  kind: string;
  amountCents?: number;
  distance?: number;
  rateCents?: number;
  odometerStart?: number;
  odometerEnd?: number;
}) {
  if (value.kind !== "mileage") {
    if (!Number.isSafeInteger(value.amountCents) || value.amountCents! < 0)
      throw Error("Enter an amount in cents");
    return value.amountCents!;
  }
  const distance =
    value.distance ??
    (value.odometerEnd !== undefined && value.odometerStart !== undefined
      ? value.odometerEnd - value.odometerStart
      : NaN);
  if (
    !Number.isFinite(distance) ||
    distance < 0 ||
    distance > 100_000 ||
    value.rateCents == null ||
    !Number.isFinite(value.rateCents) ||
    value.rateCents < 0
  )
    throw Error("Enter valid mileage and an authorized mileage rate");
  return Math.round(distance * value.rateCents);
}
export function travelTransition(
  status: string,
  action: string,
  manager: boolean,
) {
  const moves: Record<string, Record<string, string>> = {
    authorized: { submit: "submitted", cancel: "cancelled" },
    returned: { submit: "submitted", cancel: "cancelled" },
    submitted: { approve: "approved", return: "returned" },
    approved: { close: "closed" },
  };
  if (["approve", "return", "close", "cancel"].includes(action) && !manager)
    throw Error("Assign Travel permission required");
  const next = moves[status]?.[action];
  if (!next) throw Error("Travel status changed; reopen this trip");
  return next;
}
export function certificationSteps(
  requirements: { courseId: string; version: number }[],
  completions: {
    courseId: string;
    version: number;
    completedAt: string;
    expiresAt: string | null;
  }[],
  now: Date,
) {
  return requirements.map((r) =>
    completions.some(
      (c) =>
        c.courseId === r.courseId &&
        c.version === r.version &&
        new Date(c.completedAt) <= now &&
        (!c.expiresAt || new Date(c.expiresAt) > now),
    ),
  );
}
export function vendorBonus(completed: number, required: number) {
  return required > 0
    ? Math.round(Math.min(1, Math.max(0, completed / required)) * 1000) / 100
    : 0;
}
export const TRAVEL_TEMPLATES = [
  {
    id: "authorization",
    name: "Travel authorization",
    fields: [
      "Business purpose",
      "Origin",
      "Destination",
      "Departure date",
      "Return date",
      "Assigned gate/site",
      "Assigned shift",
      "Approved budget",
      "Authorized by",
    ],
  },
  {
    id: "itinerary",
    name: "Itinerary and reservations",
    fields: [
      "Date/time",
      "Location",
      "Transportation",
      "Reservation reference",
      "Lodging",
      "Contact",
    ],
  },
  {
    id: "mileage",
    name: "Mileage report",
    fields: [
      "Date",
      "Origin",
      "Destination",
      "Business purpose",
      "Starting odometer",
      "Ending odometer",
      "Business miles",
      "Authorized rate",
      "Reimbursement",
    ],
  },
  {
    id: "receipts",
    name: "Receipt register",
    fields: [
      "Date",
      "Merchant",
      "Category",
      "Amount",
      "Currency",
      "Receipt attachment",
      "Reimbursable",
      "Missing receipt explanation",
    ],
  },
  {
    id: "expenses",
    name: "Expense report",
    fields: [
      "Date",
      "Category",
      "Description",
      "Amount",
      "Company paid / employee paid",
      "Receipt",
      "Reviewer notes",
    ],
  },
  {
    id: "per_diem",
    name: "Per diem worksheet",
    fields: [
      "Travel date",
      "Destination",
      "Authorized daily allowance",
      "Meals provided",
      "Claimed amount",
    ],
  },
  {
    id: "lodging",
    name: "Lodging and transportation",
    fields: [
      "Check-in",
      "Check-out",
      "Hotel",
      "Vehicle/flight",
      "Confirmation",
      "Company-paid amount",
    ],
  },
  {
    id: "advance",
    name: "Travel advance",
    fields: [
      "Requested amount",
      "Authorized amount",
      "Date received",
      "Amount applied",
      "Balance to reconcile",
    ],
  },
  {
    id: "emergency",
    name: "Emergency contacts and instructions",
    fields: [
      "Traveler contact",
      "Office contact",
      "Site contact",
      "Emergency instructions",
    ],
  },
  {
    id: "reconciliation",
    name: "Trip closeout checklist",
    fields: [
      "Mileage entered",
      "Receipts attached",
      "Expenses submitted",
      "Advance reconciled",
      "Office review complete",
    ],
  },
] as const;
export const RENEWAL_SOURCES = [
  {
    id: "osha-pit-evaluation",
    label: "Powered industrial truck performance evaluation",
    months: 36,
    url: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178",
    condition:
      "1910.178(l)(4)(iii): operator performance evaluation at least every three years; practical evaluation is separate from course completion.",
  },
  {
    id: "osha-hazcom",
    label: "Hazard communication",
    months: null,
    url: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1200",
    condition:
      "Initial assignment and new chemical hazards; no universal annual interval in 1910.1200(h)(1).",
  },
  {
    id: "osha-confined-space",
    label: "Permit-required confined spaces",
    months: null,
    url: "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146",
    condition:
      "1910.146(g): before duties, changed duties/hazards or demonstrated deficiencies; no universal annual course interval.",
  },
] as const;
