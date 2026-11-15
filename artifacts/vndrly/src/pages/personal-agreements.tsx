import { PLATFORM_EULA_TEXT, PLATFORM_EULA_VERSION } from "@workspace/platform-eula";
import { brandStyleVars, useBrand } from "@/hooks/use-brand";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { PublicLegalView } from "@/components/public-legal-view";

const documents = [
  ["eula", "EULA", "/legal/eula"],
  ["privacy", "Privacy Policy", "/legal/privacy/"],
  ["terms", "Terms & Conditions", "/legal/terms/"],
] as const;

export default function PersonalAgreements() {
  const { user } = useAuth();
  const brand = useBrand();
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = ["personal-agreements", user?.userId] as const;
  const agreements = useQuery({
    queryKey: key,
    enabled: Boolean(user),
    queryFn: async () => {
      const response = await fetch("/api/personal-agreements");
      if (!response.ok) throw new Error("Could not load agreements.");
      return response.json() as Promise<{ versions: Record<string, string>; accepted: { document: string; version: string; acceptedAt: string }[] }>;
    },
  });
  async function accept(document: string, title: string, version: string) {
    if (document !== "eula" && !window.confirm(`Accept the VNDRLY ${title} (${version})?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/personal-agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, version }),
      });
      if (!response.ok) throw new Error();
      const saved = await response.json();
      cache.setQueryData<typeof agreements.data>(key, previous =>
        previous && { ...previous, accepted: [saved, ...previous.accepted] },
      );
    } catch {
      setError("Could not save your agreement.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-4 p-4" style={brandStyleVars(brand)}>
    <h1 className="text-xl font-bold">Policies and agreements</h1>
    {agreements.isError && <p role="alert">{agreements.error.message}</p>}
    {error && <p role="alert">{error}</p>}
    {documents.map(([id, title, href]) => {
      const version = agreements.data?.versions[id];
      const accepted = agreements.data?.accepted.some(row => row.document === id && row.version === version);
      if (id === "eula") return (
        <details key={id} open={new URLSearchParams(window.location.search).get("section") === "eula"}
          className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-[#242426] text-gray-100">
          <summary className="cursor-pointer px-4 py-3 font-semibold">EULA</summary>
          <div className="space-y-4 border-t border-white/15 p-4">
            {brand.name && <h2 className="font-bold text-[color:var(--brand-primary)]">{brand.name}</h2>}
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{PLATFORM_EULA_TEXT}</div>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-[var(--brand-primary)]" checked={Boolean(accepted)}
                disabled={busy || accepted || version !== PLATFORM_EULA_VERSION}
                onChange={event => { if (event.target.checked && version) void accept(id, title, version); }} />
              I agree
            </label>
          </div>
        </details>
      );
      return <div key={id} className="flex flex-wrap items-center gap-3">
        <a className="underline" href={href} target="_blank" rel="noreferrer">{title}</a>
        {accepted ? <span>Accepted</span> : version && <button type="button" className="vendor-mini-card-button" disabled={busy} onClick={() => void accept(id, title, version)}>Accept {title}</button>}
      </div>;
    })}
    <section className="public-legal messaging"><PublicLegalView kind="messaging" embedded /></section>
  </div>;
}
