import { describe, expect, it } from "vitest";
import { buildPayrollDraft, midnight, payrollCsv, type PayrollDraftInput, type PayrollSession } from "./payroll-draft";

const policy: PayrollDraftInput = { from: "2026-09-07", to: "2026-09-14", timeZone: "UTC", weekStartsOn: 1, dailyOvertimeHours: null, weeklyOvertimeHours: 40, overtimeMultiplier: "1.5", rates: [{ employeeId: 1, hourlyWage: "20.00" }], confirmed: true };
function session(id: number, start: string, end: string | null): PayrollSession { return { id, ticketId: id, employeeId: 1, employeeName: "Worker", checkInAt: start, checkOutAt: end }; }
describe("gross-pay drafts", () => {
  it("calculates weekly overtime across tickets using preceding period context", () => {
    const sessions = Array.from({ length: 5 }, (_, i) => session(i + 1, `2026-09-${String(7 + i).padStart(2, "0")}T08:00:00Z`, `2026-09-${String(7 + i).padStart(2, "0")}T18:00:00Z`));
    const full = buildPayrollDraft(policy, sessions);
    expect(full.grossPay).toBe("1100.00");
    expect(full.exportable).toBe(true);
    const friday = buildPayrollDraft({ ...policy, from: "2026-09-11", to: "2026-09-12" }, sessions);
    expect(friday.grossPay).toBe("300.00");
    expect(friday.rows[0].overtimeHours).toBe("10.0000");
  });
  it("does not count daily overtime twice toward weekly overtime", () => {
    const sessions = Array.from({ length: 5 }, (_, i) => session(i + 1, `2026-09-${String(7 + i).padStart(2, "0")}T08:00:00Z`, `2026-09-${String(7 + i).padStart(2, "0")}T18:00:00Z`));
    expect(buildPayrollDraft({ ...policy, dailyOvertimeHours: 8 }, sessions).grossPay).toBe("1100.00");
  });
  it("uses actual elapsed time across daylight saving changes", () => {
    const from = midnight("2026-03-08", "America/Chicago");
    const to = midnight("2026-03-09", "America/Chicago");
    expect(to - from).toBe(23 * 3600000);
    const draft = buildPayrollDraft({ ...policy, from: "2026-03-08", to: "2026-03-09", timeZone: "America/Chicago" }, [session(1, new Date(from).toISOString(), new Date(to).toISOString())]);
    expect(draft.grossPay).toBe("460.00");
  });
  it.each([
    ["open", [session(1, "2026-09-07T08:00:00Z", null)]],
    ["overlap", [session(1, "2026-09-07T08:00:00Z", "2026-09-07T10:00:00Z"), session(2, "2026-09-07T09:00:00Z", "2026-09-07T11:00:00Z")]],
    ["reversed", [session(1, "2026-09-07T10:00:00Z", "2026-09-07T08:00:00Z")]],
  ] as const)("blocks export for %s time", (_, rows) => {
    const draft = buildPayrollDraft(policy, [...rows]);
    expect(draft.exportable).toBe(false);
    expect(() => payrollCsv(policy, draft)).toThrow();
  });
  it("requires explicit wages, detects duplicate source time, and changes review fingerprint", () => {
    const row = session(1, "2026-09-07T08:00:00Z", "2026-09-07T09:00:00Z");
    expect(buildPayrollDraft({ ...policy, rates: [] }, [row]).exportable).toBe(false);
    expect(buildPayrollDraft(policy, [row, row]).exportable).toBe(false);
    const draft = buildPayrollDraft(policy, [row]);
    const edited = buildPayrollDraft(policy, [{ ...row, checkOutAt: "2026-09-07T10:00:00Z" }]);
    expect(draft.fingerprint).not.toBe(edited.fingerprint);
    expect(payrollCsv(policy, draft)).toContain(draft.fingerprint);
    expect(draft.grossPay).toBe("20.00");
  });
  it("clips an overnight session to the selected local period and escapes CSV text", () => {
    const row = { ...session(1, "2026-09-06T23:00:00Z", "2026-09-07T02:00:00Z"), employeeName: "=SUM(A1:A9)" };
    const draft = buildPayrollDraft({ ...policy, to: "2026-09-08" }, [row]);
    expect(draft.grossPay).toBe("40.00");
    expect(draft.rows[0].start).toBe("2026-09-07T00:00:00.000Z");
    expect(payrollCsv(policy, draft)).toContain("'=SUM(A1:A9)");
  });
  it("rejects nonexistent dates and missing explicit confirmation", () => {
    expect(() => buildPayrollDraft({ ...policy, from: "2026-02-30" }, [])).toThrow();
    expect(() => buildPayrollDraft({ ...policy, confirmed: false } as unknown as PayrollDraftInput, [])).toThrow();
  });
  it.each(["+1+2", "+1+HYPERLINK(1)", "-1+2", "=1+2", "@SUM(A1)", "\tcommand", "\rcommand"])("neutralizes employee text %j without changing numeric pay", (employeeName) => {
    const draft = buildPayrollDraft(policy, [{ ...session(1, "2026-09-07T08:00:00Z", "2026-09-07T09:00:00Z"), employeeName }]);
    const csv = payrollCsv(policy, draft);
    expect(csv).toContain(`'${employeeName}`);
    expect(csv).toContain(",20.00,20.00,");
  });
});
