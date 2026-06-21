import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import SphereBackButton from "@/components/sphere-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EVENT_TYPES = [
  "near_miss",
  "unsafe_condition",
  "unsafe_act",
  "injury",
  "property_damage",
  "observation",
] as const;

function readSearchParams(): { siteLocationId?: string; ticketId?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    siteLocationId: params.get("siteLocationId") ?? params.get("siteId") ?? undefined,
    ticketId: params.get("ticketId") ?? undefined,
  };
}

export default function SafetyReportPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const initial = readSearchParams();
  const [eventType, setEventType] = useState<(typeof EVENT_TYPES)[number]>("near_miss");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [siteLocationId, setSiteLocationId] = useState(initial.siteLocationId ?? "");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isStopWork, setIsStopWork] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim() || !siteLocationId) {
      toast({ title: t("safety.reportErrorTitle"), description: t("safety.reportRequired"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/safety/events`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          title: title.trim(),
          description: description.trim() || undefined,
          siteLocationId: Number(siteLocationId),
          ticketId: initial.ticketId ? Number(initial.ticketId) : undefined,
          isAnonymous,
          isStopWork,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? t("safety.reportErrorTitle"));
      }
      toast({ title: t("safety.reportSuccessTitle"), description: t("safety.reportSuccessBody") });
      navigate("/safety");
    } catch (err) {
      toast({
        title: t("safety.reportErrorTitle"),
        description: translateApiError(err, t, String(err)),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl" data-testid="safety-report-page">
      <div className="flex items-center gap-4">
        <Link href="/safety" className="group inline-flex items-center" aria-label="Back">
          <SphereBackButton size={40} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("safety.reportTitle")}</h1>
          <p className="text-muted-foreground text-sm">{t("safety.reportSubtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("safety.reportTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-id">{t("safety.siteIdPlaceholder")}</Label>
            <Input
              id="site-id"
              value={siteLocationId}
              onChange={(e) => setSiteLocationId(e.target.value)}
              data-testid="input-safety-site-id"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPES.map((type) => (
              <PngPillButton
                key={type}
                type="button"
                color={eventType === type ? "blue" : "image"}
                onClick={() => setEventType(type)}
                data-testid={`button-event-type-${type}`}
              >
                {t(`safety.eventType.${type}`, { defaultValue: type })}
              </PngPillButton>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="safety-title">{t("safety.titlePlaceholder")}</Label>
            <Input
              id="safety-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-safety-title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="safety-description">{t("safety.descriptionPlaceholder")}</Label>
            <Input
              id="safety-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-safety-description"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="safety-anonymous"
              checked={isAnonymous}
              onCheckedChange={(v) => setIsAnonymous(v === true)}
              data-testid="checkbox-safety-anonymous"
            />
            <Label htmlFor="safety-anonymous">{t("safety.anonymous")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="safety-stop-work"
              checked={isStopWork}
              onCheckedChange={(v) => setIsStopWork(v === true)}
              data-testid="checkbox-safety-stop-work"
            />
            <Label htmlFor="safety-stop-work">{t("safety.stopWork")}</Label>
          </div>
          <PngPillButton
            type="button"
            color="blue"
            onClick={() => void submit()}
            disabled={submitting}
            data-testid="button-submit-safety-report"
          >
            {submitting ? t("common.saving", { defaultValue: "Saving…" }) : t("safety.submit")}
          </PngPillButton>
        </CardContent>
      </Card>
    </div>
  );
}
