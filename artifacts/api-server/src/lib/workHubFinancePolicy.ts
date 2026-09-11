/** All monetary inputs are integer cents. Never calculate tax or net pay here. */
export function cents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Amount must be non-negative integer cents");
  return value;
}

export function platformFee(
  amount: number,
  basisPoints = 50,
  capCents: number | null = null,
): number {
  cents(amount);
  if (
    !Number.isSafeInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  )
    throw new Error("Invalid fee percentage");
  if (capCents !== null) cents(capCents);
  const fee = Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
  return Math.min(fee, capCents ?? fee);
}

/** Cumulative allocation prevents rounding drift across several partial refunds. */
export function refundedPlatformFee(
  paymentCents: number,
  originalFeeCents: number,
  previouslyRefundedCents: number,
  newRefundCents: number,
): number {
  [
    paymentCents,
    originalFeeCents,
    previouslyRefundedCents,
    newRefundCents,
  ].forEach(cents);
  if (
    !paymentCents ||
    originalFeeCents > paymentCents ||
    previouslyRefundedCents + newRefundCents > paymentCents
  )
    throw new Error("Refund exceeds original payment");
  const roundedShare = (refunded: number) =>
    Number(
      (BigInt(originalFeeCents) * BigInt(refunded) * 2n +
        BigInt(paymentCents)) /
        (BigInt(paymentCents) * 2n),
    );
  return (
    roundedShare(previouslyRefundedCents + newRefundCents) -
    roundedShare(previouslyRefundedCents)
  );
}

export type FinanceRole =
  | "billing_manager"
  | "payroll_viewer"
  | "payroll_preparer"
  | "payroll_approver";
export function financePermissions(
  companyAdmin: boolean,
  grants: readonly FinanceRole[],
) {
  return {
    administer: companyAdmin,
    billing: companyAdmin || grants.includes("billing_manager"),
    refund: companyAdmin,
    payrollView: grants.some((role) => role.startsWith("payroll_")),
    payrollPrepare: grants.includes("payroll_preparer"),
    payrollApprove: grants.includes("payroll_approver"),
  };
}

export function outsidePaymentFee(amount: number): number {
  cents(amount);
  return 0;
}

/** Spreadsheet exports must not interpret user text as formulas. */
export function financeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
