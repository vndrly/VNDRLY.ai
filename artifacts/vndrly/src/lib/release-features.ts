// Re-enable tax reporting as a unit, including totals cards and FIRE exports.
export const TAX_REPORTING_ENABLED = import.meta.env.VITE_ENABLE_TAX_REPORTING === "true";
export const ACCOUNTING_ENABLED = import.meta.env.VITE_ENABLE_ACCOUNTING === "true";
export const PAYROLL_ENABLED = true;

export function reportEnabled(path: string): boolean {
  if (/1099|fire|tax/i.test(path)) return TAX_REPORTING_ENABLED;
  if (/crew-cost|payroll/.test(path)) return PAYROLL_ENABLED;
  return ACCOUNTING_ENABLED;
}
