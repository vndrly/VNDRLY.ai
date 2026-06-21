import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import GreenV2Button from "@/components/green-v2-button";
import type { SafetyEventListItem } from "@/lib/safety-api";

export default function SiteSafetyReactivateDialog({
  open,
  onOpenChange,
  events,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: SafetyEventListItem[];
  busy: boolean;
  onConfirm: (resolutionNote: string) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) setNote("");
    onOpenChange(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("siteLocations.safetyReactivateTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("siteLocations.safetyReactivateDescription")}</AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="text-sm space-y-2 my-2" data-testid="safety-stop-work-event-list">
          {events.map((ev) => (
            <li key={ev.id} className="rounded border px-3 py-2">
              <div className="font-medium">{ev.eventNumber}</div>
              <div className="text-muted-foreground">{ev.title}</div>
              <Link
                href={`/safety/${ev.id}`}
                className="text-xs text-primary underline mt-1 inline-block"
                data-testid={`link-safety-event-${ev.id}`}
              >
                {t("siteLocations.viewSafetyIncident")}
              </Link>
            </li>
          ))}
        </ul>

        <div className="space-y-2">
          <label htmlFor="safety-reactivate-note" className="text-sm font-medium">
            {t("siteLocations.safetyReactivateNoteLabel")}
          </label>
          <Textarea
            id="safety-reactivate-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t("siteLocations.safetyReactivateNotePlaceholder")}
            data-testid="input-safety-reactivate-note"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("siteLocations.cancel")}</AlertDialogCancel>
          <GreenV2Button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => onConfirm(note.trim())}
            data-testid="button-close-and-activate-site"
          >
            {busy ? t("siteLocations.safetyReactivateBusy") : t("siteLocations.closeAndActivateSite")}
          </GreenV2Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
