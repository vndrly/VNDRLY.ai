import { useEffect, useMemo } from "react";
import {
  useListSiteLocations,
  getListSiteLocationsQueryKey,
  useListPartners,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import VisitorQrPoster from "@/components/visitor-qr-poster";
import { getBrandColors } from "@/lib/brand-colors";

function parseIds(search: string): number[] {
  const params = new URLSearchParams(search);
  const raw = params.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(ids));
}

export default function PrintVisitorQrsPage() {
  const { user } = useAuth();
  const isPartner = user?.role === "partner" && !!user.partnerId;
  const siteParams = isPartner ? { partnerId: user!.partnerId! } : undefined;
  const ids = useMemo(() => parseIds(window.location.search), []);

  const { data: sites, isLoading, isError } = useListSiteLocations(siteParams, {
    query: { queryKey: getListSiteLocationsQueryKey(siteParams) },
  });

  const { data: partners, isLoading: partnersLoading } = useListPartners();

  const partnerColorsById = useMemo(() => {
    const map = new Map<number, ReturnType<typeof getBrandColors>>();
    if (partners) {
      for (const p of partners) {
        map.set(p.id, getBrandColors(p));
      }
    }
    return map;
  }, [partners]);

  const selectedSites = useMemo(() => {
    if (!sites) return [];
    const idSet = new Set(ids);
    const byId = new Map(sites.map((s) => [s.id, s]));
    return ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s && idSet.has(s.id));
  }, [sites, ids]);

  // Wait for partner data so brand colors are applied before auto-printing.
  const readyToPrint = selectedSites.length > 0 && !partnersLoading;

  useEffect(() => {
    if (!readyToPrint) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [readyToPrint]);

  if (ids.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-visitor-qrs-empty">
        <p className="text-lg font-semibold">No sites selected</p>
        <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100">Close</button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-visitor-qrs-error">
        <p className="text-lg font-semibold">Unable to load sites</p>
        <div className="flex gap-2">
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600">Retry</button>
          <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100">Close</button>
        </div>
      </div>
    );
  }

  if (isLoading || !sites) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (selectedSites.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-8 text-center" data-testid="print-visitor-qrs-none-found">
        <p className="text-lg font-semibold">No matching sites found</p>
        <button onClick={() => window.close()} className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100">Close</button>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-white text-black p-8 print:p-0"
      data-testid="print-visitor-qrs-page"
    >
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0.5in; }
          body { background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print w-full max-w-2xl mx-auto flex justify-between items-center mb-4 gap-2">
        <p className="text-sm text-muted-foreground" data-testid="text-selected-count">
          {selectedSites.length} poster{selectedSites.length === 1 ? "" : "s"} ready to print
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600"
            data-testid="button-trigger-print"
          >
            Print
          </button>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-100"
            data-testid="button-close"
          >
            Close
          </button>
        </div>
      </div>

      <div className="space-y-12 print:space-y-0">
        {selectedSites.map((s, i) => {
          const colors = partnerColorsById.get(s.partnerId) ?? getBrandColors(null);
          return (
            <VisitorQrPoster
              key={s.id}
              site={s}
              pageBreak={i > 0}
              primaryColor={colors.primary}
              accentColor={colors.accent}
            />
          );
        })}
      </div>
    </div>
  );
}
