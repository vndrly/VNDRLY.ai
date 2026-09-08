export type CredentialHealth = "green" | "amber" | "red";

const ROLE_REQUIREMENTS: Record<string, string[]> = {
  driver: ["CDL"],
  "field worker": ["PEC"],
  field: ["PEC"],
  foreman: ["PEC"],
};

export function requiredCredentialsForRoles(roles: readonly string[]): string[] {
  const required = new Set<string>();
  for (const role of roles) {
    for (const credential of ROLE_REQUIREMENTS[role.trim().toLowerCase()] ?? []) {
      required.add(credential);
    }
  }
  return [...required].sort();
}

export function credentialHealth(
  required: readonly string[],
  records: readonly { name: string; expiresOn: string | null }[],
  now = new Date(),
): CredentialHealth {
  if (required.length === 0) return "green";
  const warningBoundary = new Date(now);
  warningBoundary.setUTCDate(warningBoundary.getUTCDate() + 90);

  let warning = false;
  for (const name of required) {
    const record = records.find((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!record?.expiresOn) return "red";
    const expires = new Date(`${record.expiresOn}T00:00:00.000Z`);
    if (!Number.isFinite(expires.getTime()) || expires < now) return "red";
    if (expires <= warningBoundary) warning = true;
  }
  return warning ? "amber" : "green";
}
