import { useState } from "react";
import { uploadOnboardingLogo } from "@/lib/onboarding-logo-upload";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { isForemanPersona } from "@/lib/portal-base";
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
  const cache=useQueryClient();
  const [coiBusy,setCoiBusy]=useState(false),[coiError,setCoiError]=useState("");
  const owner = ownerForUser(user);
  const identity = [user?.userId, user?.activeMembershipId, owner?.type, owner?.id];
  const fieldEmployee = user?.role === "field_employee" && !user.managedSubcontractor;
  const vendorAdmin = owner?.type === "vendor" && user?.role === "vendor" && isWorkHubAdmin(user);
  const accountEnabled = owner?.type === "vendor" && (vendorAdmin || fieldEmployee);
  const account = useQuery({
    queryKey: ["account-next-steps", ...identity],
    queryFn: () => read<{
      setup: NextAction[]; credentials: NextAction[]; coiUploadNeeded?: boolean;
      firstWatch: { complete: boolean; action: NextAction | null; message: string | null; context: {siteName: string; stationName: string} | null } | null;
    }>("/api/account-next-steps"),
    enabled: accountEnabled,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
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

  const workerAction = (action: NextAction): NextAction => isForemanPersona(user)
    ? { ...action, href: action.href.replace(/^\/field\//, "/foreman/") } : action;
  const setup = (account.data?.setup ?? []).map(workerAction);
  const credentials = (account.data?.credentials ?? []).map(workerAction);
  const firstWatch = account.data?.firstWatch;
  if (!accountEnabled && !compliance.length) return null;
  if (!setup.length && !credentials.length && !compliance.length && !firstWatch && !account.data?.coiUploadNeeded && !account.isPending && !account.isError) return null;

  const content = (
    <div className="space-y-3" data-testid="account-next-steps" data-state={account.isFetching || relationships.isFetching ? "loading" : account.isError || relationships.isError ? "error" : "settled"}>
      {!!setup.length && <section>
        <h3 className="mb-1 text-sm font-semibold">Recommended setup</h3>
        <NextStepLinks actions={setup} />
      </section>}
      {vendorAdmin && account.data?.coiUploadNeeded && <section id="coi-upload">
        <h3 className="mb-1 text-sm font-semibold">Certificate of Insurance (COI)</h3>
        <p className="text-sm text-muted-foreground">Upload your COI for features that require insurance. You can continue other setup without it.</p>
        <label className="block text-sm">Upload Certificate of Insurance (COI)
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={coiBusy} onChange={async event=>{
            const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file)return;
            setCoiBusy(true);setCoiError('');
            try{
              const uploaded=await uploadOnboardingLogo(file,'private');
              const objectPath=uploaded.slice(uploaded.indexOf('/objects/'));
              const response=await fetch('/api/account-next-steps/coi',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({objectPath,vendorId})});
              if(!response.ok)throw new Error('COI could not be saved. Please try again.');
              await cache.invalidateQueries({queryKey:['account-next-steps']});
            }catch(error){setCoiError(error instanceof Error?error.message:'COI could not be saved.');}
            finally{setCoiBusy(false);}
          }}/>
        </label>
        {coiBusy&&<p role="status" className="text-sm">Saving COI…</p>}
        {coiError&&<p role="alert" className="text-sm">{coiError}</p>}
      </section>}
      {!!compliance.length && <section>
        <h3 className="mb-1 text-sm font-semibold">Partner compliance</h3>
        <NextStepLinks actions={compliance} />
      </section>}
      {!!credentials.length && <section>
        <h3 className="mb-1 text-sm font-semibold">Worker credentials</h3>
        <NextStepLinks actions={credentials} />
      </section>}
      {firstWatch && !firstWatch.complete && <section aria-label="Start Your First Gate Watch">
        <h3 className="mb-1 text-sm font-semibold">Start Your First Gate Watch</h3>
        {firstWatch.context && <p className="text-sm text-muted-foreground">{firstWatch.context.siteName} · {firstWatch.context.stationName}</p>}
        {firstWatch.action && <NextStepLinks actions={[firstWatch.action]} />}
        {firstWatch.message && <p className="text-sm text-muted-foreground">{firstWatch.message}</p>}
      </section>}
      {account.isError && <p className="text-sm text-muted-foreground">Next Steps could not be refreshed.</p>}
    </div>
  );
  return surface === "dashboard" ? content : (
    <section className="work-hub-next-steps" aria-label="Next Steps">
      <CardHeader><CardTitle className="!text-inherit">Next Steps</CardTitle></CardHeader>
      <CardContent>{content}</CardContent>
    </section>
  );
}
