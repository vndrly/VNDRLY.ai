import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { isForemanPersona } from "@/lib/portal-base";
import { trainingProgressOptions } from "@/lib/training-progress-query";
import { isWorkHubAdmin, ownerForUser } from "@/lib/work-hub-client";
import "./workday-controls.css";

const expiredDocuments: Record<string, string> = {
  coi_expired: "Certificate of insurance",
  wc_expired: "Workers’ compensation insurance",
  gl_expired: "General liability insurance",
  auto_liability_expired: "Auto liability insurance",
};

type NextAction = { title: string; href: string };

export function NextStepLinks({ actions }: { actions: NextAction[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {actions.map(({ title, href }) => (
        <li key={href + title} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Link className="underline underline-offset-4" href={href}>{title}</Link>
          <Link
            href="/work-hub/askv"
            aria-label={`Ask V for help with ${title}`}
            className="text-muted-foreground hover:underline"
            onClick={() => sessionStorage.setItem(
              "vndrly.askv.prefill",
              `Help me with this Next Steps item: "${title}". Explain where to go and what to do using my current access.`,
            )}
          >
            Ask V
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw new Error("Next Steps source unavailable");
  return response.json();
}

export function AccountNextSteps({ surface }: { surface: "dashboard" | "work-hub" }) {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const identity = [user?.userId, user?.activeMembershipId, owner?.type, owner?.id];
  const fieldEmployee = user?.role === "field_employee" && !user.managedSubcontractor;
  const vendorAdmin = owner?.type === "vendor" && user?.role === "vendor" && isWorkHubAdmin(user);
  const options = trainingProgressOptions(user, owner);
  const training = useQuery({ ...options, enabled: options.enabled && surface === "work-hub" });
  const profile = useQuery({
    queryKey: ["next-steps-profile", ...identity],
    queryFn: () => read<{ employeeId: number | null; photoUrl?: string | null; profilePhotoPath?: string | null }>("/api/field/me"),
    enabled: fieldEmployee && surface === "work-hub",
    staleTime: 0,
    retry: false,
  });
  const operations = useQuery({
    queryKey: ["work-hub-home-operations", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId],
    queryFn: () => read<{ categories: string[] }>("/api/company-operations"),
    enabled: vendorAdmin && surface === "dashboard",
    retry: false,
  });

  const vendorId = owner?.type === "vendor" ? owner.id : null;
  const relationships = useQuery({
    queryKey: ["next-steps-partner-relationships", ...identity],
    queryFn: () => read<{ items: { partnerName: string; status: string; lastStatusReason: string | null }[] }>(
      `/api/vendors/${vendorId}/partner-relationships`,
    ),
    enabled: vendorAdmin && surface === "dashboard",
    retry: false,
  });
  const compliance: NextAction[] = [];
  if (vendorAdmin && surface === "dashboard") {
    for (const item of relationships.data?.items ?? []) {
      const document = expiredDocuments[item.lastStatusReason ?? ""];
      if (item.status === "auto_unapproved" && document) {
        compliance.push({
          title: `${item.partnerName} approval: ${document} expired`,
          href: `/vendors/${vendorId}#partner-approvals`,
        });
      }
    }
  }

  const setup: NextAction[] = [];
  if (surface === "dashboard" && vendorAdmin && operations.data?.categories.includes("gate")) {
    setup.push(
      { title: "Add employees", href: "/field-employees" },
      { title: "Set up gate sites", href: "/gate-locations" },
      { title: "Create shifts", href: "/work-hub/calendar" },
      { title: "Assign employees to shifts", href: "/work-hub/coverage" },
      { title: "Assign training", href: "/work-hub/library" },
    );
  }
  if (fieldEmployee && profile.data?.employeeId) {
    const portal = isForemanPersona(user) ? "/foreman" : "/field";
    if (!profile.data.photoUrl && !profile.data.profilePhotoPath) {
      setup.push({ title: "Add a profile photo", href: `${portal}/profile/edit` });
    }
    setup.push({ title: "Add or update your certifications", href: `${portal}/compliance` });
  }

  const assignments = new Map<string, NextAction>();
  for (const item of surface === "work-hub" ? training.data?.certifications ?? [] : []) {
    if (item.userId !== user?.userId || item.complete) continue;
    for (const step of item.steps) {
      if (!step.complete && step.href.startsWith("/") && !step.href.startsWith("//")) {
        assignments.set(step.href, { title: step.title, href: step.href });
      }
    }
  }
  const trainingUnavailable = surface === "work-hub" && training.isError;
  if (!setup.length && !assignments.size && !compliance.length && !trainingUnavailable) return null;

  const content = (
    <div className="space-y-3">
      {!!setup.length && <section>
        <h3 className="mb-1 text-sm font-semibold">Recommended setup</h3>
        <NextStepLinks actions={setup} />
      </section>}
      {!!compliance.length && <section>
        <h3 className="mb-1 text-sm font-semibold">Partner compliance</h3>
        <NextStepLinks actions={compliance} />
      </section>}
      {!!assignments.size && <section>
        <h3 className="mb-1 text-sm font-semibold">Assigned training</h3>
        <NextStepLinks actions={[...assignments.values()]} />
      </section>}
      {trainingUnavailable && <p className="text-sm text-muted-foreground">Assigned training could not be refreshed.</p>}
    </div>
  );
  return surface === "dashboard" ? content : (
    <section className="work-hub-next-steps" aria-label="Next Steps">
      <CardHeader><CardTitle className="!text-inherit">Next Steps</CardTitle></CardHeader>
      <CardContent>{content}</CardContent>
    </section>
  );
}
