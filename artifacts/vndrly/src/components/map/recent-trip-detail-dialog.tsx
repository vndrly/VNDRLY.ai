import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation, Clock, Route, FileText } from "lucide-react";
import { resolveGeofenceRadiusMeters } from "@workspace/map-utils";
import type { RecentTrip } from "./recent-trips-card";

function fmtTime(iso: string | null, locale?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale);
  } catch {
    return iso;
  }
}

function fmtMinutes(min: number | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (min == null) return "—";
  if (min < 60) return t("crewMap.recentTrips.minutes", { min });
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return t("crewMap.recentTrips.hoursMinutes", { hr, min: rem });
}

type Props = {
  trip: RecentTrip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RecentTripDetailDialog({ trip, open, onOpenChange }: Props) {
  const { t, i18n } = useTranslation();
  if (!trip) return null;

  const geofence = resolveGeofenceRadiusMeters(trip.siteRadiusMeters);
  const insideGeofence =
    trip.checkInDistanceMeters != null && trip.checkInDistanceMeters <= geofence;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-recent-trip">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug">
            {trip.employeeName}
            {trip.siteName ? (
              <span className="block text-sm font-normal text-muted-foreground mt-1">
                {trip.siteName}
                {trip.siteCode ? ` · ${trip.siteCode}` : ""}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">{t("crewMap.recentTrips.onSite")}</div>
              <div className="font-medium">{fmtMinutes(trip.onSiteMinutes, t)}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">{t("crewMap.recentTrips.travel")}</div>
              <div className="font-medium">{fmtMinutes(trip.travelMinutes, t)}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">{t("crewMap.recentTrips.gpsPings")}</div>
              <div className="font-medium">{trip.gpsPingCount}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-xs text-muted-foreground">{t("crewMap.recentTrips.checkInDistance")}</div>
              <div className="font-medium">
                {trip.checkInDistanceMeters != null
                  ? t("crewMap.recentTrips.metersFromSite", { m: trip.checkInDistanceMeters })
                  : "—"}
                {trip.checkInDistanceMeters != null && (
                  <span className={`block text-xs ${insideGeofence ? "text-emerald-600" : "text-amber-700"}`}>
                    {insideGeofence
                      ? t("crewMap.recentTrips.insideGeofence", { m: geofence })
                      : t("crewMap.recentTrips.outsideGeofence", { m: geofence })}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {t("crewMap.recentTrips.timeline")}
            </div>
            <ul className="space-y-1 text-xs">
              <li>{t("crewMap.recentTrips.enRoute")}: {fmtTime(trip.enRouteAt, i18n.language)}</li>
              <li>{t("crewMap.recentTrips.onLocation")}: {fmtTime(trip.onLocationAt, i18n.language)}</li>
              <li>{t("crewMap.recentTrips.arrived")}: {fmtTime(trip.arrivedAt, i18n.language)}</li>
              <li>{t("crewMap.recentTrips.checkIn")}: {fmtTime(trip.checkInTime, i18n.language)}</li>
              <li>{t("crewMap.recentTrips.checkOut")}: {fmtTime(trip.checkOutTime, i18n.language)}</li>
            </ul>
          </div>

          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>
              {t("crewMap.ticketLabel", { id: trip.ticketId })}
              {trip.workTypeName ? ` · ${trip.workTypeName}` : ""}
            </div>
            {trip.vendorName ? (
              <div>{t("crewMap.recentTrips.vendor")}: {trip.vendorName}</div>
            ) : null}
            <div>
              {t("crewMap.recentTrips.status")}: {trip.status}
              {trip.lifecycleState ? ` · ${trip.lifecycleState.replace(/_/g, " ")}` : ""}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm" variant="default">
              <Link
                href={`/crew-map/${trip.employeeId}?date=${trip.replayDate}`}
                data-testid="button-recent-trip-replay"
              >
                <Route className="h-3.5 w-3.5 mr-1" />
                {t("crewMap.recentTrips.routeReplay")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/tickets/${trip.ticketId}`} data-testid="button-recent-trip-ticket">
                <FileText className="h-3.5 w-3.5 mr-1" />
                {t("crewMap.recentTrips.openTicket")}
              </Link>
            </Button>
            {trip.checkInLatitude != null && trip.checkInLongitude != null && (
              <Button asChild size="sm" variant="outline">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${trip.checkInLatitude},${trip.checkInLongitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-3.5 w-3.5 mr-1" />
                  {t("crewMap.recentTrips.checkInPin")}
                </a>
              </Button>
            )}
            {trip.siteLatitude != null && trip.siteLongitude != null && (
              <Button asChild size="sm" variant="ghost">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${trip.siteLatitude},${trip.siteLongitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation className="h-3.5 w-3.5 mr-1" />
                  {t("crewMap.directions")}
                </a>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
