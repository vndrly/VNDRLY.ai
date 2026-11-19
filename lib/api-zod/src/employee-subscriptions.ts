import { z } from "zod/v4";

export const EmployeeSubscriptionFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  employeeKey: z.string().regex(/^(person|account):[1-9]\d*$/),
  amountCents: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  billingInterval: z.enum(["week", "month", "quarter", "year", "one_time"]),
  category: z.string().trim().max(80).default(""),
  purpose: z.string().trim().max(2000).default(""),
  renewalDate: z.iso.date().nullable().default(null),
  status: z.enum(["active", "paused", "cancelled"]).default("active"),
}).strict();
export const CreateEmployeeSubscriptionSchema = EmployeeSubscriptionFieldsSchema.extend({ operationId: z.uuid() });
export const UpdateEmployeeSubscriptionSchema = EmployeeSubscriptionFieldsSchema.extend({ expectedVersion: z.number().int().positive() });
export type EmployeeSubscriptionFields = z.infer<typeof EmployeeSubscriptionFieldsSchema>;
export type SubscriptionEmployee = { key: string; userId: number | null; name: string; email: string | null };
export type EmployeeSubscription = EmployeeSubscriptionFields & {
  id: string; version: number; employeeName: string; workerUserId: number | null;
  companyName: string; createdAt: string; updatedAt: string;
};
export type EmployeeSubscriptionsResponse = {
  canManage: boolean; companyName: string; employees: SubscriptionEmployee[]; subscriptions: EmployeeSubscription[];
};

/** Budget comparison only; never represents a payment or a posted invoice. */
export function subscriptionMonthlyEquivalent(row: Pick<EmployeeSubscriptionFields, "amountCents" | "billingInterval" | "status">) {
  if (row.status !== "active") return 0;
  const multiplier = { week: 52 / 12, month: 1, quarter: 1 / 3, year: 1 / 12, one_time: 0 }[row.billingInterval];
  return row.amountCents * multiplier;
}
