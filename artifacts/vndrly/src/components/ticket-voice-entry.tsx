import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter/use-browser-location";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PngPillButton } from "@/components/png-pill-rollover";
import { translateApiError } from "@/lib/api-error";
import {
  attachTicketPhoto, canEnterTicket, getEntryCoordinates, isTicketPhoto, mileageActionFor,
  mileageValue, parseTicketEntry, saveTicketMileage, uploadTicketPhoto,
  type EntryCoordinates, type EntryTicket, type TicketEntryKind,
} from "@/lib/ticket-voice-entry";

type Props = {
  ticket: EntryTicket;
  role?: string;
  accessAllowed: boolean;
  onLineItem: (kind: "parts" | "labor") => void;
  onSaved: () => void;
};

/** A voice deep link only opens an entry surface; saving always requires the user's confirmation. */
export function TicketVoiceEntry(props: Props) {
  const search = useSearch();
  const [request, setRequest] = useState<{ kind: TicketEntryKind; sequence: number } | null>(null);
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const kind = parseTicketEntry(new URLSearchParams(search).get("askvEntry"));
    if (!kind) { handled.current = null; return; }
    if (handled.current === search) return;
    handled.current = search;
    const url = new URL(window.location.href);
    url.searchParams.delete("askvEntry");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if ((kind === "parts" || kind === "labor") && props.accessAllowed && canEnterTicket(props.ticket, props.role)) {
      props.onLineItem(kind);
      setRequest(null);
    } else {
      setRequest((previous) => ({ kind, sequence: (previous?.sequence ?? 0) + 1 }));
    }
  }, [search, props.ticket, props.role, props.accessAllowed, props.onLineItem]);

  return request ? <TicketEntryDialog key={`${request.kind}:${request.sequence}`} {...props}
    kind={request.kind} onClose={() => setRequest(null)} /> : null;
}

export function TicketEntryDialog({ ticket, role, accessAllowed, kind, onClose, onSaved }: Omit<Props, "onLineItem"> & {
  kind: TicketEntryKind;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState("");
  const [review, setReview] = useState<{ reading: number; coordinates: EntryCoordinates } | "photo" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const uploadedPath = useRef<string | null>(null);
  const allowed = accessAllowed && canEnterTicket(ticket, role);
  const mileageAction = mileageActionFor(ticket);
  const available = allowed && (kind === "photo" || (kind === "mileage" && mileageAction !== null));
  const titleKey = kind === "photo" ? "photoTitle" : kind === "mileage" ? "mileageTitle" : "entryTitle";

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Refetched permissions or lifecycle changes invalidate a prepared confirmation.
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setReview(null);
  }, [available, mileageAction, ticket.status, ticket.startingMileage]);

  const begin = () => {
    if (controller.current) return null;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    setError(null);
    return operation;
  };
  const finish = (operation: AbortController) => {
    if (controller.current !== operation) return;
    controller.current = null;
    if (!operation.signal.aborted) setBusy(false);
  };
  const prepareReview = async () => {
    if (!available) return;
    setError(null);
    if (kind === "photo") {
      if (!file || !isTicketPhoto(file)) { setError(t("ticketVoiceEntry.invalidPhoto")); return; }
      setReview("photo");
      return;
    }
    if (!mileageAction) return;
    const value = mileageValue(reading, mileageAction, ticket.startingMileage);
    if (value === null) { setError(t("ticketVoiceEntry.invalidMileage")); return; }
    const operation = begin();
    if (!operation) return;
    try {
      const coordinates = await getEntryCoordinates(operation.signal);
      if (!operation.signal.aborted) setReview({ reading: value, coordinates });
    } catch {
      if (!operation.signal.aborted) setError(t("ticketVoiceEntry.gpsRequired"));
    } finally { finish(operation); }
  };
  const confirm = async () => {
    if (!available || !review) return;
    const operation = begin();
    if (!operation) return;
    try {
      if (review === "photo" && file) {
        // Retain the finalized path if attaching the note fails, so an explicit retry does not upload again.
        uploadedPath.current ??= await uploadTicketPhoto(file, operation.signal);
        await attachTicketPhoto(ticket.id, uploadedPath.current, operation.signal);
      } else if (review !== "photo" && mileageAction) {
        await saveTicketMileage(ticket.id, mileageAction, review.reading, review.coordinates, operation.signal);
      } else return;
      if (!operation.signal.aborted) { onSaved(); onClose(); }
    } catch (failure) {
      if (!operation.signal.aborted) setError(translateApiError(failure, t, t("ticketVoiceEntry.saveFailed")));
    } finally { finish(operation); }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-lg" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{t(`ticketVoiceEntry.${titleKey}`)}</DialogTitle>
        <DialogDescription>{t("ticketVoiceEntry.ticketLabel", { id: ticket.id })}</DialogDescription>
      </DialogHeader>
      {!available ? <p role="status">{t(allowed ? "ticketVoiceEntry.mileageUnavailable" : "ticketVoiceEntry.notAllowed")}</p> : <>
        {kind === "photo" ? <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("ticketVoiceEntry.photoHelp")}</p>
          {!review && <Input aria-label={t("ticketVoiceEntry.choosePhoto")} type="file" accept="image/*" capture="environment" disabled={busy}
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); uploadedPath.current = null; setError(null); }} />}
          {file && <p className="text-sm break-all">{file.name}</p>}
          {preview && <img src={preview} alt={t("ticketVoiceEntry.previewAlt")} className="max-h-64 w-full rounded object-contain" />}
        </div> : <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t(mileageAction === "en-route" ? "ticketVoiceEntry.startingHelp" : "ticketVoiceEntry.endingHelp")}</p>
          {ticket.startingMileage != null && <p className="text-sm">{t("ticketVoiceEntry.existingStarting", { reading: ticket.startingMileage })}</p>}
          {!review && <label className="block space-y-1 text-sm">
            <span>{t(mileageAction === "en-route" ? "ticketVoiceEntry.startingReading" : "ticketVoiceEntry.endingReading")}</span>
            <Input type="number" inputMode="decimal" min="0" max="999999999.9" step="0.1" value={reading} disabled={busy}
              onChange={(event) => { setReading(event.target.value); setError(null); }} autoFocus />
          </label>}
        </div>}
        {review && <div className="rounded border p-3 space-y-2" data-testid="ticket-entry-review">
          <p className="font-medium">{t("ticketVoiceEntry.reviewTitle")}</p>
          {review !== "photo" && <>
            <p>{t("ticketVoiceEntry.reviewReading", { reading: review.reading })}</p>
            <p className="text-sm">{t("ticketVoiceEntry.reviewLocation", { latitude: review.coordinates.latitude.toFixed(5), longitude: review.coordinates.longitude.toFixed(5) })}</p>
          </>}
          <p className="text-sm">{t(review === "photo" ? "ticketVoiceEntry.photoConfirmation" : mileageAction === "en-route" ? "ticketVoiceEntry.startingConfirmation" : "ticketVoiceEntry.endingConfirmation")}</p>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <PngPillButton onClick={onClose} disabled={busy}>{t("ticketVoiceEntry.cancel")}</PngPillButton>
        {available && (review ? <>
          <PngPillButton onClick={() => { setReview(null); setError(null); }} disabled={busy}>{t("ticketVoiceEntry.edit")}</PngPillButton>
          <PngPillButton color="green" onClick={() => void confirm()} disabled={busy}>
            {t(busy ? "ticketVoiceEntry.saving" : kind === "photo" ? "ticketVoiceEntry.savePhoto" : mileageAction === "en-route" ? "ticketVoiceEntry.confirmEnRoute" : "ticketVoiceEntry.confirmCheckOut")}
          </PngPillButton>
        </> : <PngPillButton color="blue" onClick={() => void prepareReview()} disabled={busy}>
          {t(busy ? "ticketVoiceEntry.gettingLocation" : "ticketVoiceEntry.review")}
        </PngPillButton>)}
      </div>
    </DialogContent>
  </Dialog>;
}
