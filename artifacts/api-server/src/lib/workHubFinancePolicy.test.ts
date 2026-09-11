import { describe, expect, it } from "vitest";
import {
  financePermissions,
  outsidePaymentFee,
  platformFee,
  refundedPlatformFee,
  financeCsvCell,
} from "./workHubFinancePolicy";

describe("Work Hub finance policy", () => {
  it("evaluates 0.5 percent only on the amount collected with an optional cap", () => {
    expect(platformFee(100000)).toBe(500);
    expect(platformFee(100000, 50, 200)).toBe(200);
    expect(platformFee(25000)).toBe(125);
    expect(platformFee(75000)).toBe(375);
    expect(outsidePaymentFee(100000)).toBe(0);
  });
  it("fully returns fees across partial refunds without rounding drift", () => {
    expect(
      refundedPlatformFee(300, 2, 0, 100) +
        refundedPlatformFee(300, 2, 100, 100) +
        refundedPlatformFee(300, 2, 200, 100),
    ).toBe(2);
    expect(() => refundedPlatformFee(100, 1, 80, 30)).toThrow();
  });
  it("requires explicit payroll grants even for company administrators", () => {
    expect(financePermissions(true, [])).toEqual({
      administer: true,
      billing: true,
      refund: true,
      payrollView: false,
      payrollPrepare: false,
      payrollApprove: false,
    });
    expect(financePermissions(false, ["payroll_preparer"]).payrollApprove).toBe(
      false,
    );
    expect(financePermissions(false, ["billing_manager"]).refund).toBe(false);
    expect(financePermissions(false, ["payroll_approver"]).payrollApprove).toBe(
      true,
    );
  });
  it("rejects unsafe monetary values and protects CSV formulas", () => {
    expect(() => platformFee(-1)).toThrow();
    expect(() => platformFee(1.5)).toThrow();
    expect(() => platformFee(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(financeCsvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
  });
});
