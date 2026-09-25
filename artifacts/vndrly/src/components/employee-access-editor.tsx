import BrandPill from "@/components/brand-pill";
import { BrandedCheckbox } from "@/components/branded-checkbox";
import { Label } from "@/components/ui/label";

export type EmployeeOperationalRole =
  | "office"
  | "field_employee"
  | "foreman"
  | "gatekeeper"
  | "gate_supervisor";

const ROLE_OPTIONS: Array<{ value: EmployeeOperationalRole; label: string }> = [
  { value: "office", label: "Office" },
  { value: "field_employee", label: "Field Employee" },
  { value: "foreman", label: "Foreman" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "gate_supervisor", label: "Gate Supervisor" },
];

export default function EmployeeAccessEditor({
  isAdmin,
  operationalRoles,
  siteLocationIds,
  eligibleSites,
  onChange,
}: {
  isAdmin: boolean;
  operationalRoles: EmployeeOperationalRole[];
  siteLocationIds: number[];
  eligibleSites: Array<{ id: number; name: string }>;
  onChange: (next: {
    operationalRoles: EmployeeOperationalRole[];
    siteLocationIds: number[];
  }) => void;
}) {
  const toggleRole = (role: EmployeeOperationalRole) => {
    const next = operationalRoles.includes(role)
      ? operationalRoles.filter((current) => current !== role)
      : [...operationalRoles, role];
    onChange({ operationalRoles: next, siteLocationIds });
  };
  const toggleSite = (siteId: number) => {
    const next = siteLocationIds.includes(siteId)
      ? siteLocationIds.filter((current) => current !== siteId)
      : [...siteLocationIds, siteId].sort((a, b) => a - b);
    onChange({ operationalRoles, siteLocationIds: next });
  };

  return (
    <div className="space-y-4" data-testid="employee-access-editor">
      <div>
        <Label>Access roles</Label>
        <p className="mb-2 text-xs text-muted-foreground">
          Select every role this employee may perform.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {ROLE_OPTIONS.map((role) => (
            <BrandPill
              key={role.value}
              active={operationalRoles.includes(role.value)}
              onClick={() => toggleRole(role.value)}
              testId={`access-role-${role.value}`}
            >
              {role.label}
            </BrandPill>
          ))}
        </div>
      </div>

      <div>
        <Label>Site access</Label>
        {isAdmin ? (
          <p className="mt-2 text-sm font-medium text-[color:var(--brand-primary)]">
            All authorized sites
          </p>
        ) : eligibleSites.length > 0 ? (
          <div className="mt-2 grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
            {eligibleSites.map((site) => {
              const id = `employee-site-${site.id}`;
              return (
                <div key={site.id} className="flex items-center gap-2">
                  <BrandedCheckbox
                    id={id}
                    checked={siteLocationIds.includes(site.id)}
                    onCheckedChange={() => toggleSite(site.id)}
                  />
                  <Label htmlFor={id} className="cursor-pointer text-sm">
                    {site.name}
                  </Label>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No authorized sites are available.</p>
        )}
      </div>
    </div>
  );
}
