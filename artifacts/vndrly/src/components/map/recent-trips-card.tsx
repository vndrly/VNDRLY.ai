import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";
import { RecentTripDetailDialog } from "./recent-trip-detail-dialog";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type RecentTrip = {
  ticketId: number;
  employeeId: number;
  employeeName: string;
  vendorId: number;
  vendorName: string | null;
  siteLocationId: number | null;
  siteName: string | null;
  siteCode: string | null;
  workTypeName: string | null;
  lifecycleState: string | null;
  status: string;
  enRouteAt: string | null;
  onLocationAt: string | null;
  arrivedAt: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  siteRadiusMeters: number | null;
  lastActivityAt: string | null;
  onSiteMinutes: number | null;
  travelMinutes: number | null;
  checkInDistanceMeters: number | null;
  replayDate: string;
  gpsPingCount: number;
};

type Props = {
  siteLocationId?: number | null;
  vendorId?: number | null;
  className?: string;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function RecentTripsCard({ siteLocationId, vendorId, className }: Props) {
  const { t } = useTranslation();
  const [trips, setTrips] = useState<RecentTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecentTrip | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (siteLocationId != null) params.set("siteLocationId", String(siteLocationId));
    if (vendorId != null) params.set("vendorId", String(vendorId));

    fetch(`${API_BASE}/api/map/recent-trips?${params}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          if (r.status === 403) throw new Error(t("crewMap.recentTrips.notAllowed"));
          throw new Error(`HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((json) => {
        if (!cancelled) {
          setTrips(json.trips ?? []);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setTrips([]);
          setError(e instanceof Error ? e.message : t("crewMap.recentTrips.failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [siteLocationId, vendorId, t]);

  function openTrip(trip: RecentTrip) {
    setSelected(trip);
    setDialogOpen(true);
  }

  return (
    <>
      <Card className={className ?? "mt-4"} data-testid="card-recent-trips">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-1.5">
            <History className="h-4 w-4" />
            {t("crewMap.recentTrips.title", "Recent trips")} ({trips.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[320px] overflow-y-auto">
          {loading ? (
            <div className="text-sm text-muted-foreground">{t("crewMap.recentTrips.loading")}</div>
          ) : error ? (
            <div className="text-sm text-muted-foreground">{error}</div>
          ) : trips.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-recent-trips-empty">
              {t("crewMap.recentTrips.empty")}
            </div>
          ) : (
            trips.map((trip) => (
              <button
                key={`${trip.ticketId}-${trip.lastActivityAt}`}
                type="button"
                className="w-full text-left border rounded p-2 text-sm hover:border-[var(--brand-primary)] hover:bg-muted/30 transition-colors"
                onClick={() => openTrip(trip)}
                data-testid={`recent-trip-row-${trip.ticketId}`}
              >
                <div className="font-medium">{trip.employeeName}</div>
                <div className="text-xs text-muted-foreground">
                  {trip.siteName ?? t("crewMap.recentTrips.unknownSite")}
                  {trip.siteCode ? ` · ${trip.siteCode}` : ""}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("crewMap.ticketLabel", { id: trip.ticketId })}
                  {trip.onSiteMinutes != null
                    ? ` · ${t("crewMap.recentTrips.onSiteShort", { min: trip.onSiteMinutes })}`
                    : ""}
                  {" · "}
                  {formatWhen(trip.lastActivityAt)}
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <RecentTripDetailDialog
        trip={selected}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
