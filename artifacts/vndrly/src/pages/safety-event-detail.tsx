import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SafetyEventDetailPage() {
  const { t } = useTranslation();
  const [, params] = useRoute("/safety/:id");
  const id = Number(params?.id);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["safety-event", id],
    enabled: Number.isFinite(id),
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/safety/events/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    },
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/safety/events/${id}/notes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note }),
      });
      if (!r.ok) throw new Error("note failed");
      return r.json();
    },
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["safety-event", id] });
      toast({ title: t("safety.noteAdded") });
    },
  });

  const closeEvent = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/safety/events/${id}/close`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message ?? "close failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["safety-event", id] });
      qc.invalidateQueries({ queryKey: ["safety-events"] });
      toast({ title: t("safety.eventClosed") });
    },
    onError: (e: Error) => {
      toast({ title: e.message, variant: "destructive" });
    },
  });

  const event = data?.data?.event;
  const notes = data?.data?.notes ?? [];

  if (isLoading || !event) {
    return <p className="p-6 text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl mx-auto">
      <Link href="/safety" className="text-sm text-primary">
        ← {t("safety.backToInbox")}
      </Link>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <ShieldAlert className="h-6 w-6 text-red-600" />
        {event.eventNumber}
      </h1>
      <p className="text-muted-foreground">{event.title}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("safety.details")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>{t("safety.type")}: {event.eventType}</div>
          <div>{t("safety.status")}: {event.status}</div>
          <div>{t("safety.site")}: {event.siteName}</div>
          {event.description ? <p className="whitespace-pre-wrap">{event.description}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("safety.resolutionNotes")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("safety.noNotes")}</p>
          ) : (
            notes.map((n: { id: number; body: string; authorOrgSide: string; createdAt: string }) => (
              <div key={n.id} className="border rounded p-2 text-sm">
                <div className="text-xs text-muted-foreground mb-1">
                  {n.authorOrgSide} · {new Date(n.createdAt).toLocaleString()}
                </div>
                {n.body}
              </div>
            ))
          )}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          <Button disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
            {t("safety.addNote")}
          </Button>
          {event.status !== "closed" ? (
            <Button variant="destructive" disabled={closeEvent.isPending} onClick={() => closeEvent.mutate()}>
              {t("safety.closeEvent")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
