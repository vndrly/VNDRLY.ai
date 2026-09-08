export function canViewVendorOfficeEmployees(
  role: string | null | undefined,
  isOwnVendor: boolean,
): boolean {
  return role === "admin" || (role === "vendor" && isOwnVendor);
}
