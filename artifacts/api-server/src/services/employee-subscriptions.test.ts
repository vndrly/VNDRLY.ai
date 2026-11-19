import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), client: { query: vi.fn(), release: vi.fn() }, office: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock("../lib/vendor-people-management", () => ({ isVendorOfficeStaff: mocks.office }));
import { EmployeeSubscriptionFieldsSchema } from "@workspace/api-zod";
import { readEmployeeSubscriptions, readMyEmployeeSubscriptions, saveEmployeeSubscription } from "./employee-subscriptions";
const actor = { userId: 7, vendorId: 22, role: "vendor", membershipRole: "member" };
const fields = EmployeeSubscriptionFieldsSchema.parse({ name: "Mail", employeeKey: "person:5", amountCents: 1900, billingInterval: "year" });
const row = (key = "person:5") => ({ id: "12345678-1234-4234-9234-123456789abc", data: { fields: { ...fields, employeeKey: key }, version: 1, employeeName: "John", workerUserId: 7 }, created_at: new Date(), updated_at: new Date() });
beforeEach(() => { vi.clearAllMocks(); mocks.connect.mockResolvedValue(mocks.client); mocks.office.mockResolvedValue(true); });
it("inherits employee-management authority and refuses a write before opening a transaction otherwise", async () => {
  mocks.office.mockResolvedValue(false);
  await expect(saveEmployeeSubscription(actor, fields, { operationId: "12345678-1234-4234-9234-123456789abc" })).rejects.toMatchObject({ status: 403 });
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("refuses an employee outside the paying company without inserting a record", async () => {
  mocks.client.query.mockResolvedValue({ rows: [] });
  await expect(saveEmployeeSubscription(actor, fields, { operationId: "12345678-1234-4234-9234-123456789abc" })).rejects.toMatchObject({ code: "subscription.employee_not_found" });
  expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT"))).toBe(false);
  expect(mocks.client.query).toHaveBeenCalledWith("ROLLBACK");
});
it("makes a retried creation idempotent even though JSONB returns fields in another key order", async () => {
  const previous = row(); previous.data.fields = Object.fromEntries(Object.entries(fields).reverse()) as typeof fields;
  mocks.client.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT 'person:'") ? [{ key: "person:5", userId: 7, name: "John" }] : sql.includes("SELECT id,data") ? [previous] : sql.includes("SELECT name") ? [{ name: "Company" }] : [] }));
  expect(await saveEmployeeSubscription(actor, fields, { operationId: "12345678-1234-4234-9234-123456789abc" })).toMatchObject({ id: previous.id, version: 1 });
  expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT"))).toBe(false);
});
it("non-managers receive only their own assigned subscriptions and no employee directory", async () => {
  mocks.office.mockResolvedValue(false);
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT name") ? [{ name: "Company" }] : sql.includes("SELECT 'person:'") ? [{ key: "person:5", userId: 7, name: "John" }, { key: "person:6", userId: 8, name: "Other" }] : [row(), row("person:6")] }));
  const result = await readEmployeeSubscriptions(actor);
  expect(result.employees).toEqual([]); expect(result.subscriptions).toHaveLength(1); expect(result.subscriptions[0].employeeKey).toBe("person:5");
});
it("personal subscription lookup follows the live employee/account relationship", async () => {
  mocks.query.mockResolvedValue({ rows: [] }); await readMyEmployeeSubscriptions(7);
  expect(mocks.query.mock.calls[0][1]).toEqual(["employee_subscription", "7"]);
  expect(mocks.query.mock.calls[0][0]).toContain("e.vendor_id=r.org_id AND e.user_id=$2::int");
  expect(mocks.query.mock.calls[0][0]).not.toContain("r.data->>'workerUserId'");
});
